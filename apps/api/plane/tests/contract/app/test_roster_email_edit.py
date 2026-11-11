"""Roster email edits use workspace invitations without creating accounts."""

from unittest.mock import patch

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from plane.db.models import (
    Project,
    ProjectMember,
    RosterPlayer,
    User,
    Workspace,
    WorkspaceMember,
    WorkspaceMemberInvite,
)


@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
    WEB_URL="http://localhost:3000",
    APP_BASE_URL="http://localhost:3000",
)
class RosterEmailEditTests(TestCase):
    def setUp(self):
        self.coach = User.objects.create(email="coach@fixture.test", username="email-edit-coach")
        self.workspace = Workspace.objects.create(name="School", slug="roster-email-edit", owner=self.coach)
        self.membership = WorkspaceMember.objects.create(workspace=self.workspace, member=self.coach, role=20)
        self.project = Project.objects.create(workspace=self.workspace, name="Football", identifier="FB")
        ProjectMember.objects.create(project=self.project, member=self.coach, role=20)
        self.player = RosterPlayer.objects.create(project=self.project, player_name="Player")
        self.client = APIClient()
        self.client.force_authenticate(self.coach)
        self.url = f"/api/workspaces/{self.workspace.slug}/projects/{self.project.id}/roster/"
        self.mail = self.enterContext(patch("plane.bgtasks.workspace_invitation_task.workspace_invitation.delay"))
        self.enterContext(patch("plane.utils.cache.invalidate_cache_directly"))
        self.enterContext(patch("plane.db.mixins.soft_delete_related_objects.delay"))

    def edit(self, **payload):
        with self.captureOnCommitCallbacks(execute=True):
            return self.client.patch(f"{self.url}{self.player.id}/", payload, format="json")

    def member(self, email="member@fixture.test"):
        user = User.objects.create(email=email, username=email)
        WorkspaceMember.objects.create(workspace=self.workspace, member=user, role=1)
        return user

    def test_patch_normalizes_email_and_invites_only_after_commit(self):
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.patch(f"{self.url}{self.player.id}/", {"email": " NEW@fixture.test "}, format="json")
            self.assertEqual(response.status_code, 200, response.data)
            self.assertEqual(response.data["email"], "new@fixture.test")
            self.assertEqual(response.data["account_status"], "invitation_pending")
            self.mail.assert_not_called()
        self.player.refresh_from_db()
        self.assertEqual(self.player.email, "new@fixture.test")
        self.assertIsNone(self.player.user_id)
        invitation = WorkspaceMemberInvite.objects.get(workspace=self.workspace)
        self.assertEqual(invitation.role, 1)
        self.assertFalse(User.objects.filter(email=invitation.email).exists())
        self.mail.assert_called_once()

    def test_patch_links_existing_member_without_project_access(self):
        member = self.member()
        response = self.edit(email=" MEMBER@fixture.test ")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["user"], member.id)
        self.assertEqual(response.data["account_status"], "linked")
        self.assertFalse(ProjectMember.objects.filter(project=self.project, member=member).exists())
        self.assertFalse(WorkspaceMemberInvite.objects.exists())
        self.mail.assert_not_called()

    def test_create_with_email_invites(self):
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(self.url, {"player_name": "New", "email": " NEW@fixture.test "}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["email"], "new@fixture.test")
        self.assertEqual(response.data["account_status"], "invitation_pending")
        self.assertTrue(WorkspaceMemberInvite.objects.filter(email="new@fixture.test", role=1).exists())
        self.mail.assert_called_once()

    def test_invalid_and_duplicate_email_leave_player_unchanged(self):
        RosterPlayer.objects.create(project=self.project, player_name="Other", email="taken@fixture.test")
        for email in ["not-an-email", " TAKEN@fixture.test "]:
            with self.subTest(email=email):
                response = self.edit(email=email, player_name="Changed")
                self.assertEqual(response.status_code, 400, response.data)
                self.player.refresh_from_db()
                self.assertEqual(self.player.email, "")
                self.assertEqual(self.player.player_name, "Player")
        self.assertFalse(WorkspaceMemberInvite.objects.exists())
        self.mail.assert_not_called()

    def test_workspace_guest_cannot_invite_even_as_project_admin(self):
        self.membership.role = 5
        self.membership.save()
        response = self.edit(email="new@fixture.test", player_name="Changed")
        self.assertEqual(response.status_code, 403, response.data)
        self.player.refresh_from_db()
        self.assertEqual(self.player.email, "")
        self.assertEqual(self.player.player_name, "Player")
        self.assertFalse(WorkspaceMemberInvite.objects.exists())

    def test_workspace_guest_can_still_edit_non_email_fields(self):
        self.membership.role = 5
        self.membership.save()
        response = self.edit(notes="Recovery")
        self.assertEqual(response.status_code, 200, response.data)
        self.player.refresh_from_db()
        self.assertEqual(self.player.notes, "Recovery")

    def test_linked_email_cannot_change_even_with_simultaneous_unlink(self):
        member = self.member()
        self.player.user = member
        self.player.email = member.email
        self.player.save()
        for email in ["new@fixture.test", ""]:
            with self.subTest(email=email):
                response = self.edit(email=email, user=None, player_name="Changed")
                self.assertEqual(response.status_code, 400, response.data)
                self.player.refresh_from_db()
                self.assertEqual(self.player.email, member.email)
                self.assertEqual(self.player.user_id, member.id)
                self.assertEqual(self.player.player_name, "Player")
        self.mail.assert_not_called()

    def test_unchanged_linked_email_allows_details_edit_after_account_email_changes(self):
        member = self.member()
        self.player.user = member
        self.player.email = "previous@fixture.test"
        self.player.save()
        response = self.edit(email="previous@fixture.test", notes="Recovery")
        self.assertEqual(response.status_code, 200, response.data)
        self.player.refresh_from_db()
        self.assertEqual(self.player.email, "previous@fixture.test")
        self.assertEqual(self.player.user_id, member.id)
        self.assertEqual(self.player.notes, "Recovery")
        self.mail.assert_not_called()

    def test_displayed_account_email_is_read_only_and_does_not_fill_roster_email(self):
        member = self.member()
        self.player.user = member
        self.player.save()
        response = self.edit(email="", account_email="replacement@fixture.test", notes="Recovery")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data.get("account_email"), "member@fixture.test")
        self.player.refresh_from_db()
        member.refresh_from_db()
        self.assertEqual(member.email, "member@fixture.test")
        self.assertEqual(self.player.email, "")
        self.assertEqual(self.player.user_id, member.id)
        self.assertEqual(self.player.notes, "Recovery")
        self.mail.assert_not_called()

    def test_repeated_save_and_existing_pending_invite_do_not_resend(self):
        invite = WorkspaceMemberInvite.objects.create(
            workspace=self.workspace, email="new@fixture.test", role=15, token="existing"
        )
        for _ in range(2):
            response = self.edit(email="NEW@fixture.test")
            self.assertEqual(response.status_code, 200, response.data)
            self.assertEqual(response.data["account_status"], "invitation_pending")
        invite.refresh_from_db()
        self.assertEqual(invite.role, 15)
        self.assertEqual(WorkspaceMemberInvite.objects.count(), 1)
        self.mail.assert_not_called()

    def test_blank_email_clears_status_but_preserves_shared_invitation(self):
        self.assertEqual(self.edit(email="new@fixture.test").status_code, 200)
        response = self.edit(email="")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["email"], "")
        self.assertEqual(response.data["account_status"], "email_missing")
        self.assertTrue(WorkspaceMemberInvite.objects.filter(email="new@fixture.test").exists())
        self.mail.assert_called_once()

    def test_changed_email_cannot_link_through_old_invitation(self):
        self.assertEqual(self.edit(email="old@fixture.test").status_code, 200)
        self.assertEqual(self.edit(email="new@fixture.test").status_code, 200)
        old_member = self.member("old@fixture.test")
        from plane.utils.roster_membership import link_roster_memberships

        link_roster_memberships(old_member, [self.workspace.id])
        self.player.refresh_from_db()
        self.assertEqual(self.player.email, "new@fixture.test")
        self.assertIsNone(self.player.user_id)
        self.assertTrue(WorkspaceMemberInvite.objects.filter(email=old_member.email).exists())

    def test_already_linked_member_conflict_rolls_back_edit(self):
        member = self.member()
        RosterPlayer.objects.create(project=self.project, player_name="Linked", user=member)
        response = self.edit(email=member.email, player_name="Changed")
        self.assertEqual(response.status_code, 400, response.data)
        self.player.refresh_from_db()
        self.assertEqual(self.player.email, "")
        self.assertEqual(self.player.player_name, "Player")
        self.assertFalse(WorkspaceMemberInvite.objects.exists())

    def test_selected_member_email_mismatch_rolls_back_edit(self):
        member = self.member()
        response = self.edit(email="other@fixture.test", user=str(member.id), player_name="Changed")
        self.assertEqual(response.status_code, 400, response.data)
        self.player.refresh_from_db()
        self.assertEqual(self.player.email, "")
        self.assertIsNone(self.player.user_id)
        self.assertFalse(WorkspaceMemberInvite.objects.exists())

    def test_declined_invitation_rolls_back_edit(self):
        WorkspaceMemberInvite.objects.create(
            workspace=self.workspace, email="declined@fixture.test", token="declined", responded_at=timezone.now()
        )
        response = self.edit(email="declined@fixture.test", player_name="Changed")
        self.assertEqual(response.status_code, 400, response.data)
        self.player.refresh_from_db()
        self.assertEqual(self.player.email, "")
        self.assertEqual(self.player.player_name, "Player")
        self.mail.assert_not_called()

    def test_save_rechecks_duplicate_inserted_after_initial_validation(self):
        from rest_framework.exceptions import ValidationError
        from plane.app.serializers.roster import RosterPlayerSerializer

        serializer = RosterPlayerSerializer(
            self.player,
            data={"email": "new@fixture.test", "player_name": "Changed"},
            partial=True,
            context={"project": self.project, "request": type("Request", (), {"user": self.coach})()},
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        RosterPlayer.objects.create(project=self.project, player_name="Other", email="new@fixture.test")
        with self.assertRaises(ValidationError):
            serializer.save()
        self.player.refresh_from_db()
        self.assertEqual(self.player.email, "")
        self.assertEqual(self.player.player_name, "Player")

    def test_save_rechecks_link_created_after_initial_validation(self):
        from rest_framework.exceptions import ValidationError
        from plane.app.serializers.roster import RosterPlayerSerializer

        serializer = RosterPlayerSerializer(
            self.player,
            data={"email": "new@fixture.test", "player_name": "Changed"},
            partial=True,
            context={"project": self.project, "request": type("Request", (), {"user": self.coach})()},
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        member = self.member()
        RosterPlayer.objects.filter(pk=self.player.pk).update(user=member)
        with self.assertRaises(ValidationError):
            serializer.save()
        self.player.refresh_from_db()
        self.assertEqual(self.player.email, "")
        self.assertEqual(self.player.user_id, member.id)
        self.assertEqual(self.player.player_name, "Player")
