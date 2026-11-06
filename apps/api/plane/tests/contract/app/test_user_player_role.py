from unittest.mock import patch

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from plane.db.models import (
    APIToken,
    Issue,
    IssueAssignee,
    IssueComment,
    Project,
    ProjectMember,
    RosterPlayer,
    State,
    User,
    Workspace,
    WorkspaceMember,
)


@override_settings(CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}})
class UserPlayerRoleTests(TestCase):
    def setUp(self):
        self.coach = User.objects.create(email="coach@role.test", username="role-coach")
        self.user = User.objects.create(email="player@role.test", username="role-player")
        self.peer = User.objects.create(email="peer@role.test", username="role-peer")
        self.workspace = Workspace.objects.create(name="School", slug="user-role-school", owner=self.coach)
        self.membership = WorkspaceMember.objects.create(workspace=self.workspace, member=self.user, role=1)
        WorkspaceMember.objects.create(workspace=self.workspace, member=self.coach, role=20)
        WorkspaceMember.objects.create(workspace=self.workspace, member=self.peer, role=1)
        self.project = Project.objects.create(workspace=self.workspace, name="Football", identifier="FB")
        self.project_member = ProjectMember.objects.create(project=self.project, member=self.user, role=1)
        ProjectMember.objects.create(project=self.project, member=self.coach, role=20)
        self.state = State.objects.create(project=self.project, name="Assigned", group="started")
        self.own = Issue.objects.create(project=self.project, state=self.state, name="Own activity")
        IssueAssignee.objects.create(project=self.project, issue=self.own, assignee=self.user)
        self.other = Issue.objects.create(project=self.project, state=self.state, name="Private peer activity")
        IssueAssignee.objects.create(project=self.project, issue=self.other, assignee=self.peer)
        self.player = RosterPlayer.objects.create(project=self.project, user=self.user, player_name="Player")
        self.card = Issue.objects.create(
            project=self.project,
            state=self.state,
            name="Personal feedback",
            category="Coaching Card",
            roster_player=self.player,
            coaching_card_data={
                "feedback": "Keep practicing",
                "recipient_ids": [str(self.player.id)],
                "recipients": [{"email": "private@role.test"}],
            },
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.base = f"/api/player/workspaces/{self.workspace.slug}/projects/{self.project.id}/activities/"
        self.generic = f"/api/workspaces/{self.workspace.slug}/projects/{self.project.id}/"
        self.enterContext(patch("plane.db.mixins.soft_delete_related_objects.delay"))
        self.enterContext(patch("plane.utils.cache.invalidate_cache_directly"))

    def test_lists_only_assigned_activities_and_personal_feedback(self):
        response = self.client.get("/api/player/activities/")
        self.assertEqual(response.status_code, 200, response.json())
        self.assertEqual(response["Cache-Control"], "private, no-store")
        self.assertEqual({row["id"] for row in response.json()["results"]}, {str(self.own.id), str(self.card.id)})
        self.assertNotIn("recipients", str(response.json()))
        self.assertNotIn("private@role.test", str(response.json()))

    def test_other_activity_detail_and_progress_are_hidden(self):
        for method in ("get", "patch"):
            path = f"{self.base}{self.other.id}/" + ("progress/" if method == "patch" else "")
            response = getattr(self.client, method)(path, {"percent": 100}, format="json")
            self.assertEqual(response.status_code, 404, response.json())

    def test_completion_changes_only_personal_progress(self):
        response = self.client.patch(
            f"{self.base}{self.own.id}/progress/", {"percent": 100, "note": "Practiced"}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.json())
        self.assertEqual(response.json()["percent"], 100)
        self.assertIsNotNone(response.json()["completed_at"])
        self.own.refresh_from_db()
        self.assertEqual(self.own.state_id, self.state.id)
        self.assertIsNone(self.own.completed_at)

    def test_progress_rejects_work_item_edits_and_invalid_values(self):
        for payload in (
            {"percent": 101},
            {"percent": -1},
            {"name": "Changed"},
            {"percent": 50, "user": str(self.peer.id)},
        ):
            response = self.client.patch(f"{self.base}{self.own.id}/progress/", payload, format="json")
            self.assertEqual(response.status_code, 400, response.json())

    def test_reading_progress_returns_only_the_current_users_record(self):
        self.client.patch(f"{self.base}{self.own.id}/progress/", {"percent": 40}, format="json")
        response = self.client.get(f"{self.base}{self.own.id}/")
        self.assertEqual(response.status_code, 200, response.json())
        self.assertEqual(response.json()["progress"]["percent"], 40)

    def test_can_comment_edit_and_delete_own_comment(self):
        path = f"{self.base}{self.own.id}/comments/"
        response = self.client.post(path, {"text": "My progress"}, format="json")
        self.assertEqual(response.status_code, 201, response.json())
        comment_id = response.json()["id"]
        response = self.client.patch(f"{path}{comment_id}/", {"text": "Updated"}, format="json")
        self.assertEqual(response.status_code, 200, response.json())
        self.assertEqual(response.json()["text"], "Updated")
        self.assertEqual(self.client.delete(f"{path}{comment_id}/").status_code, 204)

    def test_cannot_edit_coach_or_peer_comments(self):
        for actor in (self.coach, self.peer):
            comment = IssueComment.objects.create(
                project=self.project, issue=self.own, actor=actor, comment_html="<p>Existing</p>", access="EXTERNAL"
            )
            path = f"{self.base}{self.own.id}/comments/{comment.id}/"
            self.assertEqual(self.client.patch(path, {"text": "Changed"}, format="json").status_code, 404)
            self.assertEqual(self.client.delete(path).status_code, 404)

    def test_peer_comments_and_private_coach_notes_are_not_exposed(self):
        IssueComment.objects.create(
            project=self.project, issue=self.own, actor=self.peer, comment_html="<p>Peer secret</p>", access="EXTERNAL"
        )
        IssueComment.objects.create(
            project=self.project,
            issue=self.own,
            actor=self.coach,
            comment_html="<p>Coach private note</p>",
            access="INTERNAL",
        )
        IssueComment.objects.create(
            project=self.project,
            issue=self.own,
            actor=self.coach,
            comment_html="<p>Shared feedback</p>",
            access="EXTERNAL",
        )
        response = self.client.get(f"{self.base}{self.own.id}/comments/")
        self.assertEqual(response.status_code, 200, response.json())
        self.assertEqual([row["text"] for row in response.json()], ["Shared feedback"])
        self.assertNotIn(self.peer.email, str(response.json()))

    def test_reactions_are_scoped_to_owned_activity_and_visible_comment(self):
        response = self.client.post(f"{self.base}{self.own.id}/reactions/", {"reaction": "thumbsup"}, format="json")
        self.assertEqual(response.status_code, 201, response.json())
        response = self.client.post(f"{self.base}{self.other.id}/reactions/", {"reaction": "thumbsup"}, format="json")
        self.assertEqual(response.status_code, 404, response.json())
        peer_comment = IssueComment.objects.create(
            project=self.project, issue=self.own, actor=self.peer, access="EXTERNAL", comment_html="<p>Peer</p>"
        )
        response = self.client.post(
            f"{self.base}{self.own.id}/comments/{peer_comment.id}/reactions/", {"reaction": "thumbsup"}, format="json"
        )
        self.assertEqual(response.status_code, 404, response.json())

    def test_generic_project_endpoints_fail_closed(self):
        for suffix in (
            "issues/",
            f"issues/{self.other.id}/",
            "roster/",
            "members/",
            "states/",
            "media-library/packages/",
            "cycles/",
            "modules/",
        ):
            response = self.client.get(self.generic + suffix)
            self.assertIn(response.status_code, (403, 404), (suffix, response.status_code))

    def test_cannot_create_edit_delete_or_bypass_with_creator_exception(self):
        self.other.created_by = self.user
        self.other.save()
        for method, suffix, payload in (
            ("post", "issues/", {"name": "Forbidden"}),
            ("patch", f"issues/{self.other.id}/", {"name": "Forbidden"}),
            ("delete", f"issues/{self.other.id}/", {}),
        ):
            response = getattr(self.client, method)(self.generic + suffix, payload, format="json")
            self.assertEqual(response.status_code, 403, response.json())

    def test_workspace_user_role_is_a_ceiling_over_elevated_project_role(self):
        self.project_member.role = 20
        self.project_member.save()
        response = self.client.get(self.generic + "issues/")
        self.assertEqual(response.status_code, 403, response.json())

    def test_project_user_role_restricts_workspace_member(self):
        self.membership.role = 15
        self.membership.save()
        response = self.client.get(self.generic + "issues/")
        self.assertEqual(response.status_code, 403, response.json())

    def test_unscoped_workspace_search_and_member_listing_are_blocked(self):
        for path in (
            f"/api/workspaces/{self.workspace.slug}/members/",
            f"/api/workspaces/{self.workspace.slug}/search/",
            "/api/users/me/activities/",
        ):
            response = self.client.get(path)
            self.assertIn(response.status_code, (403, 404), response.json() if hasattr(response, "data") else path)

    def test_api_key_cannot_bypass_user_access(self):
        token = APIToken.objects.create(user=self.user, label="Player test", token="player-role-token")
        client = APIClient()
        response = client.get(
            f"/api/v1/workspaces/{self.workspace.slug}/projects/{self.project.id}/issues/", HTTP_X_API_KEY=token.token
        )
        self.assertEqual(response.status_code, 403, getattr(response, "data", None))

    def test_generic_card_detail_is_blocked_but_personal_detail_is_available(self):
        response = self.client.get(f"{self.generic}coaching-cards/{self.card.id}/")
        self.assertEqual(response.status_code, 403, response.json())
        response = self.client.get(f"{self.base}{self.card.id}/")
        self.assertEqual(response.status_code, 200, response.json())
        self.assertEqual(response.json()["feedback"], "Keep practicing")

    def test_programs_exclude_public_unassigned_projects(self):
        Project.objects.create(workspace=self.workspace, name="Unassigned public", identifier="UP", network=2)
        response = self.client.get("/api/player/assignments/")
        self.assertEqual(response.status_code, 200, response.json())
        self.assertEqual([row["id"] for row in response.json()], [str(self.project.id)])

    def test_deactivated_membership_revokes_access(self):
        self.membership.is_active = False
        self.membership.save()
        response = self.client.get(f"{self.base}{self.own.id}/")
        self.assertEqual(response.status_code, 404, response.json())

    def test_peer_coaching_card_is_not_authorized_by_an_issue_assignee(self):
        peer_player = RosterPlayer.objects.create(project=self.project, user=self.peer, player_name="Peer")
        peer_card = Issue.objects.create(
            project=self.project,
            state=self.state,
            name="Peer private feedback",
            category="Coaching Card",
            roster_player=peer_player,
            coaching_card_data={"feedback": "Peer secret", "recipient_ids": [str(peer_player.id)]},
        )
        IssueAssignee.objects.create(project=self.project, issue=peer_card, assignee=self.user)
        response = self.client.get(f"{self.base}{peer_card.id}/")
        self.assertEqual(response.status_code, 404, response.json())

    def test_mobile_review_acknowledgement_does_not_advance_shared_state_for_user(self):
        with patch("plane.app.views.issue.coaching_card.advance_card_after_review") as advance:
            response = self.client.post(
                f"{self.generic}coaching-cards/{self.card.id}/review-complete/", {}, format="json"
            )
        self.assertEqual(response.status_code, 200, response.json())
        advance.assert_not_called()

    def test_inactive_roster_revokes_mobile_mine_and_review_access(self):
        self.player.status = "inactive"
        self.player.save()
        self.assertEqual(self.client.get(f"{self.generic}coaching-cards/mine/").status_code, 404)
        self.assertEqual(
            self.client.post(
                f"{self.generic}coaching-cards/{self.card.id}/review-complete/", {}, format="json"
            ).status_code,
            404,
        )

    def test_mobile_mine_uses_sanitized_card_payload(self):
        data = dict(self.card.coaching_card_data)
        data["player"] = {"id": "another-player", "name": "Peer private name", "email": "peer-private@test.local"}
        data["metadata"] = {"author": {"email": "private-author@test.local"}}
        self.card.coaching_card_data = data
        self.card.save()
        response = self.client.get(f"{self.generic}coaching-cards/mine/")
        self.assertEqual(response.status_code, 200, response.json())
        self.assertNotIn("Peer private name", str(response.json()))
        self.assertNotIn("private-author@test.local", str(response.json()))

    def test_assigned_media_cannot_read_unassigned_sibling_file(self):
        from pathlib import Path
        from tempfile import TemporaryDirectory

        with TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "assigned.bin").write_bytes(b"assigned")
            (root / "peer.bin").write_bytes(b"private peer file")
            self.card.coaching_card_data = {
                **self.card.coaching_card_data,
                "source_media": {"package_id": "package", "artifact_id": "assigned"},
            }
            self.card.save()
            manifest = {"artifacts": [{"name": "assigned", "path": str(root / "assigned.bin"), "format": "bin"}]}
            with (
                patch("plane.app.views.media_library.read_manifest", return_value=manifest),
                patch("plane.app.views.media_library.manifest_path", return_value=root / "manifest.json"),
                patch("plane.app.views.media_library.media_library_root", return_value=root),
            ):
                (root / "manifest.json").write_text("{}")
                path = f"{self.base}{self.card.id}/media/package/assigned/"
                response = self.client.get(path + "peer.bin/")
                self.assertEqual(response.status_code, 404)
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(b"".join(response.streaming_content), b"assigned")

    def test_explicit_user_project_invitation_assigns_the_correct_program(self):
        from plane.db.models import ProjectMemberInvite

        other = Project.objects.create(workspace=self.workspace, name="Assigned team", identifier="AT")
        invitation = ProjectMemberInvite.objects.create(
            project=other, workspace=self.workspace, email=self.user.email, role=1, token="assigned-team"
        )
        response = self.client.post(
            f"/api/workspaces/{self.workspace.slug}/projects/{other.id}/join/{invitation.id}/",
            {"email": self.user.email, "accepted": True},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.json())
        self.assertTrue(ProjectMember.objects.filter(project=other, member=self.user, role=1, is_active=True).exists())
        self.assertEqual(ProjectMember.objects.filter(project=self.project, member=self.user).get().role, 1)

    def test_coach_can_invite_existing_workspace_user_to_program_as_user(self):
        with patch("plane.bgtasks.project_invitation_task.project_invitation.delay") as email:
            self.client.force_authenticate(self.coach)
            response = self.client.post(
                self.generic + "invitations/", {"emails": [{"email": self.user.email, "role": 1}]}, format="json"
            )
        self.assertEqual(response.status_code, 200, response.json())
        email.assert_called_once()

    def test_guest_and_member_keep_their_existing_issue_list_access(self):
        with patch("plane.app.views.issue.base.recent_visited_task.delay"):
            for role in (5, 15):
                WorkspaceMember.objects.filter(pk=self.membership.pk).update(role=role)
                ProjectMember.objects.filter(pk=self.project_member.pk).update(role=role)
                response = self.client.get(self.generic + "issues/")
                self.assertEqual(response.status_code, 200, response.json())

    def test_user_mobile_acknowledgement_does_not_write_shared_review(self):
        before = dict(self.card.coaching_card_data)
        response = self.client.post(f"{self.generic}coaching-cards/{self.card.id}/review-complete/", {}, format="json")
        self.assertEqual(response.status_code, 200, response.json())
        self.card.refresh_from_db()
        self.assertEqual(self.card.coaching_card_data, before)
        self.assertIsNotNone(response.json()["review"]["viewed_at"])

    def test_stale_workspace_invitation_cannot_promote_user_through_either_acceptance_path(self):
        from plane.db.models import WorkspaceMemberInvite

        self.enterContext(patch("plane.app.views.workspace.invite.workspace_invite_event.delay"))
        self.enterContext(patch("plane.app.views.workspace.invite.invalidate_cache_directly"))
        for in_app in (True, False):
            invitation = WorkspaceMemberInvite.objects.create(
                workspace=self.workspace, email=self.user.email, role=20, token=f"stale-{in_app}"
            )
            if in_app:
                response = self.client.post(
                    "/api/users/me/workspaces/invitations/", {"invitations": [str(invitation.id)]}, format="json"
                )
                self.assertEqual(response.status_code, 204, response.json() if response.content else None)
            else:
                response = self.client.post(
                    f"/api/workspaces/{self.workspace.slug}/invitations/{invitation.id}/join/",
                    {"email": self.user.email, "accepted": True},
                    format="json",
                )
                self.assertEqual(response.status_code, 200, response.json())
            self.membership.refresh_from_db()
            self.assertEqual(self.membership.role, 1)

    def test_user_cannot_read_another_players_invitation(self):
        from plane.db.models import WorkspaceMemberInvite

        invitation = WorkspaceMemberInvite.objects.create(
            workspace=self.workspace, email=self.peer.email, role=1, token="peer-invite"
        )
        response = self.client.get(f"/api/workspaces/{self.workspace.slug}/invitations/{invitation.id}/join/")
        self.assertEqual(response.status_code, 404)

    def test_hls_access_allows_only_manifest_resources_and_supports_ranges(self):
        from pathlib import Path
        from tempfile import TemporaryDirectory

        with TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "master.m3u8").write_text("#EXTM3U\n1080p/index.m3u8\n")
            (root / "1080p").mkdir()
            (root / "1080p/index.m3u8").write_text("#EXTM3U\n#EXTINF:1,\nsegment.ts\n")
            (root / "1080p/segment.ts").write_bytes(b"segment")
            (root / "peer.bin").write_bytes(b"private")
            (root / "manifest.json").write_text("{}")
            self.card.coaching_card_data = {
                **self.card.coaching_card_data,
                "source_media": {"package_id": "package", "artifact_id": "assigned"},
                "playlists": [{"id": "film", "clips": [{"id": "assigned", "title": "Film"}]}],
            }
            self.card.save()
            manifest = {"artifacts": [{"name": "assigned", "path": str(root / "master.m3u8"), "format": "m3u8"}]}
            with (
                patch("plane.app.views.media_library.read_manifest", return_value=manifest),
                patch("plane.app.views.media_library.manifest_path", return_value=root / "manifest.json"),
                patch("plane.app.views.media_library.media_library_root", return_value=root),
            ):
                detail = self.client.get(f"{self.base}{self.card.id}/").json()
                self.assertTrue(detail["clips"][0]["sourceUrl"].endswith("#video.m3u8"))
                base = f"{self.base}{self.card.id}/media/package/assigned/"
                response = self.client.get(base + "1080p/index.m3u8")
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response["Content-Type"], "application/vnd.apple.mpegurl")
                self.assertIn(b"segment.ts", b"".join(response.streaming_content))
                response = self.client.get(base + "1080p/segment.ts", HTTP_RANGE="bytes=0-2")
                self.assertEqual(response.status_code, 206)
                self.assertEqual(b"".join(response.streaming_content), b"seg")
                self.assertEqual(self.client.get(base + "peer.bin").status_code, 404)

    def test_accepted_before_signup_project_invitation_creates_user_program_assignment(self):
        from plane.db.models import ProjectMemberInvite
        from plane.authentication.utils.workspace_project_join import process_workspace_project_invitations

        account = User.objects.create(email="new-user@role.test", username="new-player-user")
        ProjectMemberInvite.objects.create(
            project=self.project,
            workspace=self.workspace,
            email=account.email,
            role=1,
            token="signup-project",
            accepted=True,
        )
        process_workspace_project_invitations(account)
        self.assertTrue(WorkspaceMember.objects.filter(workspace=self.workspace, member=account, role=1).exists())
        self.assertTrue(ProjectMember.objects.filter(project=self.project, member=account, role=1).exists())

    def test_stale_project_invitation_cannot_promote_existing_project_user(self):
        from plane.db.models import ProjectMemberInvite

        self.membership.role = 15
        self.membership.save()
        invitation = ProjectMemberInvite.objects.create(
            project=self.project, workspace=self.workspace, email=self.user.email, role=20, token="stale-project"
        )
        response = self.client.post(
            f"/api/workspaces/{self.workspace.slug}/projects/{self.project.id}/join/{invitation.id}/",
            {"email": self.user.email, "accepted": True},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.json())
        self.project_member.refresh_from_db()
        self.assertEqual(self.project_member.role, 1)

    def test_admin_can_assign_workspace_user_and_cannot_raise_its_project_role(self):
        self.membership.role = 15
        self.membership.save()
        self.project_member.role = 15
        self.project_member.save()
        self.client.force_authenticate(self.coach)
        path = f"/api/workspaces/{self.workspace.slug}/members/{self.membership.id}/"
        response = self.client.patch(path, {"role": 1}, format="json")
        self.assertEqual(response.status_code, 200, response.json())
        self.membership.refresh_from_db()
        self.project_member.refresh_from_db()
        self.assertEqual(self.membership.role, 1)
        self.assertEqual(self.project_member.role, 1)
        response = self.client.patch(f"{self.generic}members/{self.project_member.id}/", {"role": 15}, format="json")
        self.assertEqual(response.status_code, 400, response.json())

    def test_user_cannot_self_join_public_program(self):
        public = Project.objects.create(workspace=self.workspace, name="Public", identifier="PUB", network=2)
        response = self.client.post(
            f"/api/users/me/workspaces/{self.workspace.slug}/projects/invitations/",
            {"project_ids": [str(public.id)]},
            format="json",
        )
        self.assertEqual(response.status_code, 403, response.json())
        self.assertFalse(ProjectMember.objects.filter(project=public, member=self.user).exists())

    def test_missing_upload_manifest_does_not_hide_other_assigned_activities(self):
        from rest_framework.exceptions import ValidationError

        self.card.coaching_card_data = {
            **self.card.coaching_card_data,
            "source_media": {"package_id": "missing", "artifact_id": "video"},
            "playlists": [{"id": "film", "clips": [{"id": "video", "title": "Unavailable upload"}]}],
        }
        self.card.save()
        with patch("plane.app.views.media_library.read_manifest", side_effect=ValidationError("Manifest unavailable")):
            response = self.client.get("/api/player/activities/")
        self.assertEqual(response.status_code, 200, response.json())
        self.assertEqual({row["id"] for row in response.json()["results"]}, {str(self.own.id), str(self.card.id)})

    def test_guest_can_still_comment_and_react(self):
        WorkspaceMember.objects.filter(pk=self.membership.pk).update(role=5)
        ProjectMember.objects.filter(pk=self.project_member.pk).update(role=5)
        self.project.guest_view_all_features = True
        self.project.save()
        with (
            patch("plane.app.views.issue.comment.issue_activity.delay"),
            patch("plane.app.views.issue.comment.model_activity.delay"),
        ):
            response = self.client.post(
                f"{self.generic}issues/{self.own.id}/comments/", {"comment_html": "<p>Guest comment</p>"}, format="json"
            )
        self.assertEqual(response.status_code, 201, response.json())
        with patch("plane.app.views.issue.reaction.issue_activity.delay"):
            response = self.client.post(
                f"{self.generic}issues/{self.own.id}/reactions/", {"reaction": "thumbsup"}, format="json"
            )
        self.assertEqual(response.status_code, 201, response.json())

    def test_guest_mobile_review_keeps_existing_shared_lifecycle_behavior(self):
        WorkspaceMember.objects.filter(pk=self.membership.pk).update(role=5)
        ProjectMember.objects.filter(pk=self.project_member.pk).update(role=5)
        with patch("plane.app.views.issue.coaching_card.advance_card_after_review") as advance:
            response = self.client.post(
                f"{self.generic}coaching-cards/{self.card.id}/review-complete/", {}, format="json"
            )
        self.assertEqual(response.status_code, 200, response.json())
        advance.assert_called_once()
        self.card.refresh_from_db()
        self.assertIn(str(self.player.id), self.card.coaching_card_data["review"]["viewed_by"])

    def test_explicit_peer_recipient_overrides_stale_legacy_roster_link(self):
        peer_player = RosterPlayer.objects.create(project=self.project, user=self.peer, player_name="Peer")
        self.card.coaching_card_data = {**self.card.coaching_card_data, "recipient_ids": [str(peer_player.id)]}
        self.card.save()
        self.assertEqual(self.client.get(f"{self.base}{self.card.id}/").status_code, 404)
        response = self.client.get(f"{self.generic}coaching-cards/mine/")
        self.assertEqual(response.status_code, 200, response.json())
        self.assertEqual(response.json()["total_count"], 0)
