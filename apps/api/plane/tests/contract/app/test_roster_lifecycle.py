"""Roster participation, historical cards and account deletion are separate."""

from copy import deepcopy
from unittest.mock import patch
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from plane.db.models import (
    User,
    Workspace,
    Project,
    WorkspaceMember,
    ProjectMember,
    RosterPlayer,
    Issue,
    State,
)
from plane.utils.player_activity_access import player_activities, player_programs
from plane.utils.user_role_access import user_readonly_projects


@override_settings(CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}})
class RosterLifecycleTests(TestCase):
    def setUp(self):
        self.coach = User.objects.create(email="lifecycle-admin@fixture.test", username="lc-admin")
        self.athlete = User.objects.create(
            email="lifecycle-athlete@fixture.test", username="lc-athlete", avatar="https://fixture.invalid/photo.png"
        )
        self.workspace = Workspace.objects.create(name="School", slug="lifecycle-school", owner=self.coach)
        self.project = Project.objects.create(workspace=self.workspace, name="Team", identifier="LC")
        for user, role in [(self.coach, 20), (self.athlete, 1)]:
            WorkspaceMember.objects.create(workspace=self.workspace, member=user, role=role)
            ProjectMember.objects.create(project=self.project, member=user, role=role)
        self.player = RosterPlayer.objects.create(
            project=self.project,
            user=self.athlete,
            email=self.athlete.email,
            player_name="Athlete Name",
            jersey_number="12",
        )
        self.state = State.objects.create(project=self.project, name="Published", group="started")
        self.data = {
            "recipient_ids": [str(self.player.id)],
            "recipients": [{"id": str(self.player.id), "name": "Athlete Name"}],
            "playlists": [
                {"id": "playlist", "clips": [{"id": "tag", "source_url": "https://fixture.invalid/video.mp4"}]}
            ],
        }
        self.card = Issue.objects.create(
            project=self.project,
            state=self.state,
            category="Coaching Card",
            name="Own card",
            roster_player=self.player,
            coaching_card_data=deepcopy(self.data),
        )
        self.client = APIClient()
        self.client.force_authenticate(self.coach)
        self.root = f"/api/workspaces/{self.workspace.slug}/projects/{self.project.id}/roster/"
        self.url = self.root + str(self.player.id) + "/"
        self.enterContext(patch("plane.db.mixins.soft_delete_related_objects.delay"))

    def test_inactive_keeps_own_cards_but_revokes_team_access_and_frees_jersey(self):
        response = self.client.patch(self.url, {"status": "inactive"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.player.refresh_from_db()
        self.assertIsNone(self.player.jersey_number)
        self.assertTrue(player_activities(self.athlete).filter(pk=self.card.id).exists())
        self.assertFalse(player_programs(self.athlete).exists())
        self.assertFalse(user_readonly_projects(self.athlete).exists())
        self.card.refresh_from_db()
        self.assertEqual(self.card.coaching_card_data, self.data)
        self.assertEqual(self.card.roster_player_id, self.player.id)
        reused = self.client.post(self.root, {"player_name": "New athlete", "jersey_number": "12"}, format="json")
        self.assertEqual(reused.status_code, 201, reused.data)
        self.assertEqual(
            self.client.patch(self.url, {"status": "active", "jersey_number": "12"}, format="json").status_code, 400
        )
        self.assertEqual(
            self.client.patch(self.url, {"status": "active", "jersey_number": "13"}, format="json").status_code, 200
        )

    def test_remove_preserves_card_kanban_identity_and_historical_access(self):
        response = self.client.delete(self.url)
        self.assertEqual(response.status_code, 200, response.data)
        self.player.refresh_from_db()
        self.assertEqual(self.player.status, "removed")
        self.assertIsNone(self.player.deleted_at)
        self.assertIsNone(self.player.jersey_number)
        self.assertNotIn(str(self.player.id), [row["id"] for row in self.client.get(self.root).data])
        self.assertTrue(player_activities(self.athlete).filter(pk=self.card.id).exists())
        self.assertFalse(player_programs(self.athlete).exists())
        self.card.refresh_from_db()
        self.assertEqual(self.card.coaching_card_data, self.data)
        self.assertEqual(self.card.roster_player_id, self.player.id)
        self.assertEqual(self.card.state_id, self.state.id)
        events = self.client.get(self.root + "events/")
        self.assertEqual(events.status_code, 200, events.data)
        self.assertEqual(events.data[0]["action"], "removed")
        self.assertNotIn("reason", events.data[0])
        self.assertTrue(User.objects.filter(pk=self.athlete.id).exists())

    def test_unused_mistake_is_deleted_and_event_survives(self):
        mistake = RosterPlayer.objects.create(project=self.project, player_name="Mistake")
        self.assertEqual(self.client.delete(self.root + str(mistake.id) + "/").status_code, 200)
        self.assertFalse(RosterPlayer.all_objects.filter(pk=mistake.id).exists())
        self.assertEqual(self.client.get(self.root + "events/").data[0]["player_name"], "Mistake")

    def test_member_can_remove_but_cannot_delete_an_account(self):
        member = User.objects.create(email="lifecycle-coach@fixture.test", username="lc-coach")
        WorkspaceMember.objects.create(workspace=self.workspace, member=member, role=15)
        ProjectMember.objects.create(project=self.project, member=member, role=15)
        self.client.force_authenticate(member)
        self.assertEqual(self.client.delete(self.url + "account/").status_code, 403)
        self.assertEqual(self.client.delete(self.url).status_code, 200)
        self.assertTrue(User.objects.filter(pk=self.athlete.id).exists())

    def test_admin_deletes_account_globally_but_preserves_tags_and_shared_cards(self):
        other = User.objects.create(email="lc-other@fixture.test", username="lc-other")
        other_roster = RosterPlayer.objects.create(project=self.project, user=other, player_name="Other")
        shared = Issue.objects.create(
            project=self.project,
            category="Coaching Card",
            name="Shared",
            coaching_card_data={
                "recipient_ids": [str(self.player.id), str(other_roster.id)],
                "recipients": [
                    {"id": str(self.player.id), "name": "Athlete Name"},
                    {"id": str(other_roster.id), "name": "Other"},
                ],
            },
        )
        game = Issue.objects.create(
            project=self.project,
            category="Game",
            name="Team film",
            description={"tag": {"roster_player_id": str(self.player.id)}},
        )
        before = deepcopy(game.description)
        second = Project.objects.create(workspace=self.workspace, name="Other team", identifier="OT")
        second_player = RosterPlayer.objects.create(
            project=second, user=self.athlete, player_name="Athlete Name", jersey_number="5"
        )
        response = self.client.delete(self.url + "account/")
        self.assertEqual(response.status_code, 204, getattr(response, "data", None))
        self.assertFalse(User.objects.filter(pk=self.athlete.id).exists())
        self.assertFalse(Issue.all_objects.filter(pk=self.card.id).exists())
        for roster in [self.player, second_player]:
            roster.refresh_from_db()
            self.assertEqual(roster.player_name, "Former player")
            self.assertIsNone(roster.user_id)
            self.assertEqual(roster.email, "")
            self.assertEqual(roster.status, "removed")
        game.refresh_from_db()
        self.assertEqual(game.description, before)
        shared.refresh_from_db()
        self.assertEqual(shared.coaching_card_data["recipient_ids"], [str(other_roster.id)])
        self.assertTrue(User.objects.filter(pk=other.id).exists())
        self.assertTrue(User.objects.filter(pk=self.coach.id).exists())

    def test_cannot_delete_admin_or_account_in_another_workspace(self):
        protected = RosterPlayer.objects.create(project=self.project, user=self.coach, player_name="Admin")
        self.assertEqual(self.client.delete(self.root + str(protected.id) + "/account/").status_code, 400)
        self.assertTrue(User.objects.filter(pk=self.coach.id).exists())
        self.assertEqual(
            self.client.post(self.root, {"player_name": "Removed", "status": "removed"}, format="json").status_code, 400
        )

    def test_legacy_injured_status_is_normalized_to_active(self):
        response = self.client.patch(self.url, {"status": "injured"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["status"], "active")

    def test_tag_preflight_preserves_identity_after_inactive_frees_jersey(self):
        response = self.client.post(self.root + "tag-references/", {"roster_ids": [str(self.player.id)]}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.player.refresh_from_db()
        self.assertIsNotNone(self.player.first_tagged_at)
        self.client.patch(self.url, {"status": "inactive"}, format="json")
        self.assertEqual(
            self.client.post(
                self.root + "tag-references/", {"roster_ids": [str(self.player.id)]}, format="json"
            ).status_code,
            400,
        )
        Issue.all_objects.filter(pk=self.card.id).delete()
        self.assertEqual(self.client.delete(self.url).status_code, 200)
        self.player.refresh_from_db()
        self.assertEqual(self.player.status, "removed")
        identities = self.client.get(self.root + "identities/")
        self.assertEqual(identities.status_code, 200)
        self.assertIn(str(self.player.id), [str(r["id"]) for r in identities.data])
        self.client.force_authenticate(self.athlete)
        self.assertEqual(self.client.get(self.root + "identities/").status_code, 403)
        self.assertEqual(
            self.client.post(self.root + "tag-references/", {"roster_ids": []}, format="json").status_code, 403
        )

    def test_account_deletion_removes_photo_access_but_preserves_team_upload_and_tagged_identity(self):
        from plane.db.models import FileAsset, Session
        from django.utils import timezone
        from datetime import timedelta

        photo = FileAsset.objects.create(user=self.athlete, entity_type="USER_AVATAR", asset="fixture-photo.png")
        film = FileAsset.objects.create(
            user=self.athlete, project=self.project, entity_type="ISSUE_ATTACHMENT", asset="fixture-team-film.mp4"
        )
        self.athlete.avatar_asset = photo
        self.athlete.save()
        Session.objects.create(
            session_key="lifecycle-fixture-session",
            user_id=str(self.athlete.id),
            session_data="",
            expire_date=timezone.now() + timedelta(hours=1),
        )
        self.player.first_tagged_at = timezone.now()
        self.player.save()
        self.assertEqual(self.client.delete(self.url + "account/").status_code, 204)
        photo.refresh_from_db()
        self.assertTrue(photo.is_deleted)
        self.assertIsNotNone(photo.deleted_at)
        film.refresh_from_db()
        self.assertIsNone(film.user_id)
        self.assertFalse(film.is_deleted)
        self.assertFalse(Session.objects.filter(session_key="lifecycle-fixture-session").exists())
        self.player.refresh_from_db()
        self.assertEqual(self.player.player_name, "Former player")
        self.assertIsNotNone(self.player.first_tagged_at)

    def test_inactive_cannot_use_assigned_team_issue_as_backdoor(self):
        from plane.db.models import IssueAssignee

        game = Issue.objects.create(project=self.project, name="Team-only game", category="Game")
        IssueAssignee.objects.create(project=self.project, issue=game, assignee=self.athlete)
        self.assertTrue(player_activities(self.athlete).filter(pk=game.id).exists())
        self.client.patch(self.url, {"status": "inactive"}, format="json")
        self.assertFalse(player_activities(self.athlete).filter(pk=game.id).exists())
        self.assertTrue(player_activities(self.athlete).filter(pk=self.card.id).exists())

    def test_deleting_account_preserves_shared_comment_upload(self):
        from plane.db.models import FileAsset, IssueComment

        game = Issue.objects.create(project=self.project, name="Team game", category="Game")
        comment = IssueComment.objects.create(
            project=self.project, issue=game, actor=self.athlete, comment_html="<p>Film</p>"
        )
        film = FileAsset.objects.create(
            project=self.project,
            issue=game,
            comment=comment,
            user=self.athlete,
            entity_type="COMMENT_DESCRIPTION",
            asset="shared-film.mp4",
        )
        self.assertEqual(self.client.delete(self.url + "account/").status_code, 204)
        self.assertTrue(FileAsset.all_objects.filter(pk=film.pk).exists())
        comment.refresh_from_db()
        self.assertIsNone(comment.actor_id)

    def test_migration_preserves_legacy_inactive_jersey_identity(self):
        import importlib
        from django.apps import apps

        old = RosterPlayer.objects.create(
            project=self.project, player_name="Legacy inactive", jersey_number="8", status="inactive"
        )
        importlib.import_module("plane.db.migrations.0140_roster_lifecycle").normalize_statuses(apps, None)
        old.refresh_from_db()
        self.assertIsNone(old.jersey_number)
        self.assertEqual(self.client.delete(self.root + str(old.pk) + "/").status_code, 200)
        self.assertTrue(RosterPlayer.all_objects.filter(pk=old.pk).exists())

    def test_stale_form_cannot_resurrect_removed_roster(self):
        from types import SimpleNamespace
        from rest_framework.exceptions import ValidationError
        from plane.app.serializers.roster import RosterPlayerSerializer

        form = RosterPlayerSerializer(
            self.player,
            data={"status": "active"},
            partial=True,
            context={"project": self.project, "request": SimpleNamespace(user=self.coach)},
        )
        self.assertTrue(form.is_valid(), form.errors)
        self.assertEqual(self.client.delete(self.url).status_code, 200)
        with self.assertRaises(ValidationError):
            form.save()
        self.player.refresh_from_db()
        self.assertEqual(self.player.status, "removed")

    def test_stale_roster_instance_cannot_delete_unlinked_account(self):
        from rest_framework.exceptions import ValidationError
        from plane.utils.roster_lifecycle import delete_athlete_account

        RosterPlayer.objects.filter(pk=self.player.id).update(user=None)
        with self.assertRaises(ValidationError):
            delete_athlete_account(self.player, self.coach)
        self.assertTrue(User.objects.filter(pk=self.athlete.id).exists())

    def test_former_player_can_discover_own_card_program_on_web_and_mobile(self):
        self.client.delete(self.url)
        self.client.force_authenticate(self.athlete)
        mobile = self.client.get("/api/player/programs/")
        self.assertEqual(mobile.status_code, 200)
        self.assertEqual([p["id"] for p in mobile.data["results"]], [str(self.project.id)])
        web = self.client.get("/api/player/assignments/")
        self.assertEqual(web.status_code, 200)
        self.assertEqual([p["id"] for p in web.data], [str(self.project.id)])
