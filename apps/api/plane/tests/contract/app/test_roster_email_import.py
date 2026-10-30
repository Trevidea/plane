"""Email roster imports never create accounts or send email during verification."""

from unittest.mock import patch

from django.test import TestCase, TransactionTestCase, override_settings
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
class RosterEmailImportTests(TestCase):
    def setUp(self):
        self.coach = User.objects.create(email="coach@fixture.test", username="roster-coach")
        self.workspace = Workspace.objects.create(name="School", slug="roster-email-school", owner=self.coach)
        self.membership = WorkspaceMember.objects.create(workspace=self.workspace, member=self.coach, role=20)
        self.project = Project.objects.create(workspace=self.workspace, name="Football", identifier="FB")
        ProjectMember.objects.create(project=self.project, member=self.coach, role=20)
        self.client = APIClient()
        self.client.force_authenticate(self.coach)
        self.url = f"/api/workspaces/{self.workspace.slug}/projects/{self.project.id}/roster/import/"
        self.mail = self.enterContext(patch("plane.bgtasks.workspace_invitation_task.workspace_invitation.delay"))
        self.enterContext(patch("plane.app.views.workspace.invite.workspace_invite_event.delay"))
        self.enterContext(patch("plane.db.mixins.soft_delete_related_objects.delay"))
        self.enterContext(patch("plane.utils.cache.invalidate_cache_directly"))
        self.enterContext(patch("plane.app.views.workspace.invite.invalidate_cache_directly"))
        self.enterContext(patch("plane.authentication.utils.workspace_project_join.invalidate_cache_directly"))

    def import_rows(self, rows):
        with self.captureOnCommitCallbacks(execute=True):
            return self.client.post(self.url, {"players": rows}, format="json")

    def player_row(self, email="player@fixture.test", **extra):
        return {"player_name": "Player", "jersey_number": "17", "email": email, **extra}

    def account(self, email="player@fixture.test", member=True):
        user = User.objects.create(email=email, username=email)
        if member:
            WorkspaceMember.objects.create(workspace=self.workspace, member=user, role=5)
        return user

    def test_email_less_import_remains_supported(self):
        response = self.import_rows([{"player_name": "Player", "jersey_number": "17"}])
        self.assertEqual(response.status_code, 201, response.data)
        self.assertIsNone(RosterPlayer.objects.get(project=self.project).user_id)
        self.mail.assert_not_called()

    def test_existing_member_matches_case_insensitively_without_invite(self):
        user = self.account()
        response = self.import_rows([self.player_row(" PLAYER@fixture.test ")])
        self.assertEqual(response.status_code, 201, response.data)
        player = RosterPlayer.objects.get(project=self.project)
        self.assertEqual(player.user_id, user.id)
        self.assertEqual(player.email, "player@fixture.test")
        self.assertEqual(response.data["data"][0]["email"], "player@fixture.test")
        self.assertFalse(WorkspaceMemberInvite.objects.exists())
        self.mail.assert_not_called()

    def test_new_email_creates_user_invite_only_after_commit(self):
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(self.url, {"players": [self.player_row()]}, format="json")
            self.assertEqual(response.status_code, 201, response.data)
            self.mail.assert_not_called()
        invitation = WorkspaceMemberInvite.objects.get(workspace=self.workspace)
        self.assertEqual(invitation.role, 1)
        self.assertFalse(User.objects.filter(email=invitation.email).exists())
        self.assertIsNone(RosterPlayer.objects.get(project=self.project).user_id)
        self.mail.assert_called_once()
        self.assertEqual(self.mail.call_args.args[0], "player@fixture.test")

    def test_account_outside_workspace_must_accept_invitation(self):
        user = self.account(member=False)
        response = self.import_rows([self.player_row()])
        self.assertEqual(response.status_code, 201, response.data)
        self.assertIsNone(RosterPlayer.objects.get(project=self.project).user_id)
        self.assertFalse(WorkspaceMember.objects.filter(workspace=self.workspace, member=user).exists())
        self.assertTrue(WorkspaceMemberInvite.objects.filter(email=user.email).exists())

    def test_pending_invitation_is_reused_without_changing_role_or_sending_again(self):
        invitation = WorkspaceMemberInvite.objects.create(
            workspace=self.workspace, email="player@fixture.test", role=15, token="pending"
        )
        response = self.import_rows([self.player_row()])
        self.assertEqual(response.status_code, 201, response.data)
        invitation.refresh_from_db()
        self.assertEqual(invitation.role, 15)
        self.assertEqual(WorkspaceMemberInvite.objects.count(), 1)
        self.mail.assert_not_called()

    def test_invalid_email_rolls_back_entire_import(self):
        response = self.import_rows([self.player_row(), self.player_row("not-email", jersey_number="18")])
        self.assertEqual(response.status_code, 400, response.data)
        self.assertFalse(RosterPlayer.objects.exists())
        self.assertFalse(WorkspaceMemberInvite.objects.exists())
        self.mail.assert_not_called()

    def test_duplicate_email_in_file_is_rejected_case_insensitively(self):
        response = self.import_rows([self.player_row(), self.player_row("PLAYER@fixture.test", jersey_number="18")])
        self.assertEqual(response.status_code, 400, response.data)
        self.assertFalse(RosterPlayer.objects.exists())
        self.mail.assert_not_called()

    def test_existing_link_cannot_be_claimed_by_second_roster_record(self):
        user = self.account()
        existing = RosterPlayer.objects.create(project=self.project, user=user, player_name="Existing")
        response = self.import_rows([self.player_row()])
        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(RosterPlayer.objects.count(), 1)
        existing.refresh_from_db()
        self.assertEqual(existing.user_id, user.id)

    def test_link_conflict_rolls_back_prior_rows_and_invitation_callbacks(self):
        user = self.account()
        existing = RosterPlayer.objects.create(project=self.project, user=user, player_name="Existing")
        response = self.import_rows(
            [
                self.player_row("new@fixture.test"),
                self.player_row(jersey_number="18"),
            ]
        )
        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(list(RosterPlayer.objects.values_list("id", flat=True)), [existing.id])
        self.assertFalse(WorkspaceMemberInvite.objects.exists())
        self.mail.assert_not_called()

    def test_guest_workspace_member_cannot_send_invites_through_project_admin_role(self):
        self.membership.role = 5
        self.membership.save()
        response = self.import_rows([self.player_row()])
        self.assertEqual(response.status_code, 403, response.data)
        self.assertFalse(WorkspaceMemberInvite.objects.exists())
        self.assertFalse(RosterPlayer.objects.exists())

    def test_in_app_acceptance_links_pending_player(self):
        user = self.account(member=False)
        self.import_rows([self.player_row()])
        invitation = WorkspaceMemberInvite.objects.get(email=user.email)
        self.client.force_authenticate(user)
        response = self.client.post(
            "/api/users/me/workspaces/invitations/", {"invitations": [str(invitation.id)]}, format="json"
        )
        self.assertEqual(response.status_code, 204, response.data)
        self.assertEqual(RosterPlayer.objects.get(project=self.project).user_id, user.id)
        self.assertEqual(WorkspaceMember.objects.get(workspace=self.workspace, member=user).role, 1)
        self.assertFalse(ProjectMember.objects.filter(project=self.project, member=user).exists())

    def test_email_acceptance_links_pending_player(self):
        user = self.account(member=False)
        self.import_rows([self.player_row()])
        invitation = WorkspaceMemberInvite.objects.get(email=user.email)
        response = self.client.post(
            f"/api/workspaces/{self.workspace.slug}/invitations/{invitation.id}/join/",
            {"accepted": True, "email": user.email},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(RosterPlayer.objects.get(project=self.project).user_id, user.id)

    def test_signup_after_acceptance_links_pending_player(self):
        self.import_rows([self.player_row()])
        WorkspaceMemberInvite.objects.filter(workspace=self.workspace).update(accepted=True)
        user = self.account(member=False)
        from plane.authentication.utils.workspace_project_join import process_workspace_project_invitations

        process_workspace_project_invitations(user)
        self.assertEqual(RosterPlayer.objects.get(project=self.project).user_id, user.id)

    def test_pending_link_is_scoped_to_accepted_workspace(self):
        self.import_rows([self.player_row()])
        user = self.account(member=False)
        other = Workspace.objects.create(name="Other", slug="other-roster-email", owner=self.coach)
        other_program = Project.objects.create(workspace=other, name="Other Football", identifier="OF")
        other_player = RosterPlayer.objects.create(project=other_program, player_name="Other", email=user.email)
        invitation = WorkspaceMemberInvite.objects.get(workspace=self.workspace)
        self.client.force_authenticate(user)
        self.client.post("/api/users/me/workspaces/invitations/", {"invitations": [str(invitation.id)]}, format="json")
        other_player.refresh_from_db()
        self.assertIsNone(other_player.user_id)

    def test_reimport_cannot_duplicate_a_pending_email(self):
        self.assertEqual(self.import_rows([self.player_row()]).status_code, 201)
        response = self.import_rows([self.player_row(jersey_number="18")])
        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(RosterPlayer.objects.count(), 1)
        self.mail.assert_called_once()

    def test_acceptance_does_not_overwrite_an_existing_account_link(self):
        self.import_rows([self.player_row()])
        user = self.account(member=False)
        other = RosterPlayer.objects.create(project=self.project, user=user, player_name="Already linked")
        invitation = WorkspaceMemberInvite.objects.get(email=user.email)
        self.client.force_authenticate(user)
        response = self.client.post(
            "/api/users/me/workspaces/invitations/", {"invitations": [str(invitation.id)]}, format="json"
        )
        self.assertEqual(response.status_code, 204, response.data)
        self.assertEqual(RosterPlayer.objects.filter(project=self.project, user=user).get().id, other.id)
        self.assertIsNone(RosterPlayer.objects.get(project=self.project, jersey_number="17").user_id)


class RosterEmailConcurrencyTests(TransactionTestCase):
    # Cascade the test flush to the legacy unmanaged tables referencing users.
    available_apps = ["plane.db"]

    def test_acceptance_waits_for_uncommitted_email_import(self):
        from concurrent.futures import ThreadPoolExecutor, TimeoutError
        from threading import Event
        from django.db import close_old_connections, transaction
        from plane.utils.roster_membership import link_roster_memberships

        from uuid import uuid4

        key = uuid4().hex
        user = User.objects.create(email=f"{key}@fixture.test", username=key)
        workspace = Workspace.objects.create(name="Concurrent", slug=f"concurrent-{key}", owner=user)
        project = Project.objects.create(workspace=workspace, name="Football", identifier="CF")
        WorkspaceMember.objects.create(workspace=workspace, member=user, role=5)
        inserted, release_import = Event(), Event()

        def importing():
            try:
                with transaction.atomic():
                    Workspace.objects.select_for_update().get(pk=workspace.pk)
                    RosterPlayer.objects.create(project=project, player_name="Concurrent", email=user.email)
                    inserted.set()
                    if not release_import.wait(10):
                        raise AssertionError("Import synchronization timed out")
            finally:
                close_old_connections()

        def accepting():
            try:
                link_roster_memberships(user, [workspace.id])
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as executor:
            importer = executor.submit(importing)
            self.assertTrue(inserted.wait(10))
            acceptance = executor.submit(accepting)
            try:
                with self.assertRaises(TimeoutError):
                    acceptance.result(timeout=0.2)
            finally:
                release_import.set()
                importer.result(timeout=10)
                acceptance.result(timeout=10)
        self.assertEqual(RosterPlayer.objects.get(project=project).user_id, user.id)
