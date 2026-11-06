"""Invitation onboarding uses fixture accounts and never contacts real SMTP."""

from datetime import timedelta
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
from plane.utils.player_invitations import create_player_ticket


@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
    PLAYER_APP_API_URL="https://api.fixture.test",
    APP_BASE_URL="https://web.fixture.test",
    WEB_URL="https://api.fixture.test",
)
class PlayerAppInvitationTests(TestCase):
    def setUp(self):
        self.coach = User.objects.create(email="app-coach@fixture.test", username="app-coach")
        self.workspace = Workspace.objects.create(name="School", slug="app-school", owner=self.coach)
        self.project = Project.objects.create(workspace=self.workspace, name="Football", identifier="FB")
        self.player = RosterPlayer.objects.create(
            project=self.project, player_name="Player", email="app-player@fixture.test"
        )
        self.invite = WorkspaceMemberInvite.objects.create(
            workspace=self.workspace, email=self.player.email, token="fixture-nonce", role=1
        )
        self.ticket = create_player_ticket(self.invite)
        self.password = "Fixture-player-password-827!"
        self.client = APIClient()
        self.accept_url = "/auth/player-invitation/accept/"
        self.preview_url = "/api/player/invitations/preview/"
        self.enterContext(patch("plane.db.mixins.soft_delete_related_objects.delay"))

    def accept(self, **kwargs):
        return self.client.post(
            self.accept_url, {"token": self.ticket, "name": "Player", "password": self.password, **kwargs}
        )

    def existing_user(self):
        user = User.objects.create(email=self.player.email, username="existing-app-player")
        user.set_password(self.password)
        user.save()
        return user

    def test_preview_has_fixed_email_and_no_side_effects(self):
        response = self.client.post(self.preview_url, {"token": self.ticket}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["email"], self.player.email)
        self.assertFalse(response.json()["account_exists"])
        self.assertEqual(response.json()["program_name"], "Football")
        self.assertFalse(User.objects.filter(email=self.player.email).exists())
        self.invite.refresh_from_db()
        self.assertFalse(self.invite.accepted)
        self.assertIn("no-store", response.headers["Cache-Control"])

    def test_new_account_gets_session_roster_and_user_program_membership(self):
        response = self.accept()
        self.assertEqual(response.status_code, 200, response.content)
        user = User.objects.get(email=self.player.email)
        self.assertTrue(user.check_password(self.password))
        self.assertEqual(self.client.get("/api/users/me/").status_code, 200)
        self.player.refresh_from_db()
        self.assertEqual(self.player.user_id, user.id)
        self.assertEqual(WorkspaceMember.objects.get(workspace=self.workspace, member=user).role, 1)
        self.assertEqual(ProjectMember.objects.get(project=self.project, member=user).role, 1)
        self.invite.refresh_from_db()
        self.assertTrue(self.invite.accepted)

    def test_existing_account_logs_in_without_replacing_password(self):
        user = self.existing_user()
        response = self.accept()
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(User.objects.filter(email=self.player.email).count(), 1)
        self.player.refresh_from_db()
        self.assertEqual(self.player.user_id, user.id)
        self.assertEqual(self.client.get("/api/users/me/").status_code, 200)

    def test_wrong_password_creates_no_memberships(self):
        self.existing_user()
        self.assertEqual(self.accept(password="wrong").status_code, 400)
        self.assertFalse(ProjectMember.objects.filter(project=self.project).exists())
        self.player.refresh_from_db()
        self.assertIsNone(self.player.user_id)

    def test_expired_ticket_is_rejected(self):
        with patch("django.core.signing.time.time", return_value=(timezone.now() - timedelta(days=8)).timestamp()):
            self.ticket = create_player_ticket(self.invite)
        self.assertEqual(self.accept().status_code, 400)
        self.assertFalse(User.objects.filter(email=self.player.email).exists())

    def test_used_ticket_cannot_be_replayed(self):
        self.assertEqual(self.accept().status_code, 200)
        self.assertEqual(self.accept().status_code, 400)

    def test_revoked_or_changed_invitation_cannot_be_used(self):
        self.invite.token = "rotated"
        self.invite.save()
        self.assertEqual(self.accept().status_code, 400)

    def test_role_and_email_cannot_be_supplied_by_client(self):
        self.assertEqual(self.accept(email="other@fixture.test", role="20").status_code, 400)
        self.assertFalse(User.objects.filter(email=self.player.email).exists())

    def test_changed_email_invalidates_the_ticket(self):
        self.invite.email = "different@fixture.test"
        self.invite.save()
        self.assertEqual(self.accept().status_code, 400)

    def test_inactive_account_is_not_reactivated(self):
        user = self.existing_user()
        user.is_active = False
        user.save()
        self.assertEqual(self.accept().status_code, 400)
        user.refresh_from_db()
        self.assertFalse(user.is_active)

    def test_removed_membership_is_reactivated_at_user_role(self):
        user = self.existing_user()
        WorkspaceMember.objects.create(workspace=self.workspace, member=user, role=20, is_active=False)
        ProjectMember.objects.create(project=self.project, member=user, role=20, is_active=False)
        self.assertEqual(self.accept().status_code, 200)
        self.assertEqual(WorkspaceMember.objects.get(workspace=self.workspace, member=user).role, 1)
        self.assertEqual(ProjectMember.objects.get(project=self.project, member=user).role, 1)

    def test_inactive_program_rejects_acceptance(self):
        self.project.archived_at = timezone.now()
        self.project.save()
        self.assertEqual(self.accept().status_code, 400)

    def test_another_accounts_roster_link_cannot_be_replaced(self):
        self.player.user = self.coach
        self.player.save()
        self.assertEqual(self.accept().status_code, 400)
        self.player.refresh_from_db()
        self.assertEqual(self.player.user_id, self.coach.id)

    def test_wrong_authenticated_account_is_rejected(self):
        self.client.force_login(self.coach)
        self.assertEqual(self.accept().status_code, 400)

    def test_all_matching_programs_are_linked_but_other_workspaces_are_not(self):
        second = Project.objects.create(workspace=self.workspace, name="Basketball", identifier="BB")
        other = RosterPlayer.objects.create(project=second, player_name="Player", email=self.player.email)
        foreign_workspace = Workspace.objects.create(name="Other", slug="app-other", owner=self.coach)
        foreign_project = Project.objects.create(workspace=foreign_workspace, name="Other", identifier="OT")
        foreign = RosterPlayer.objects.create(project=foreign_project, player_name="Player", email=self.player.email)
        self.assertEqual(self.accept().status_code, 200)
        other.refresh_from_db()
        foreign.refresh_from_db()
        self.assertIsNotNone(other.user_id)
        self.assertIsNone(foreign.user_id)
        self.assertEqual(ProjectMember.objects.filter(member_id=other.user_id).count(), 2)

    def test_program_summary_stays_within_the_mobile_wire_contract(self):
        self.project.name = "Football " * 20
        self.project.save()
        second = Project.objects.create(workspace=self.workspace, name="Basketball " * 20, identifier="BB")
        RosterPlayer.objects.create(project=second, player_name="Player", email=self.player.email)
        response = self.client.post(self.preview_url, {"token": self.ticket}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertLessEqual(len(response.json()["program_name"]), 255)
        self.assertEqual(self.accept().status_code, 200)

    def test_landing_has_app_link_and_csrf_browser_fallback(self):
        response = self.client.get("/auth/player-invitation/", {"token": self.ticket})
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "kanavioplayerapp://signup?")
        self.assertContains(response, "csrfmiddlewaretoken")
        self.assertContains(response, self.player.email)
        self.assertEqual("same-origin", response.headers["Referrer-Policy"])
        self.assertContains(response, 'name="referrer" content="same-origin"')

    def test_acceptance_requires_csrf(self):
        self.client = APIClient(enforce_csrf_checks=True)
        self.assertEqual(self.accept().status_code, 403)
        self.assertFalse(User.objects.filter(email=self.player.email).exists())

    def test_browser_fallback_accepts_with_csrf_and_confirmation(self):
        self.client = APIClient(enforce_csrf_checks=True)
        self.client.get("/auth/player-invitation/", {"token": self.ticket})
        csrf = self.client.cookies["csrftoken"].value
        response = self.client.post(
            self.accept_url,
            {
                "token": self.ticket,
                "name": "Player",
                "password": self.password,
                "password_confirm": self.password,
                "browser": "1",
                "csrfmiddlewaretoken": csrf,
            },
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertContains(response, "Your account is ready")
        self.player.refresh_from_db()
        self.assertIsNotNone(self.player.user_id)

    def test_weak_password_does_not_create_an_account(self):
        self.assertEqual(self.accept(password="12345678").status_code, 400)
        self.assertFalse(User.objects.filter(email=self.player.email).exists())

    def test_wrong_invitation_role_cannot_create_a_player_account(self):
        self.invite.role = 20
        self.invite.save()
        self.assertEqual(self.accept().status_code, 400)

    def test_inactive_roster_cannot_accept(self):
        self.player.status = "inactive"
        self.player.save()
        self.assertEqual(self.accept().status_code, 400)

    def test_request_logger_does_not_log_the_invitation_ticket(self):
        with patch("plane.middleware.logger.api_logger.info") as logger:
            self.client.get("/auth/player-invitation/", {"token": self.ticket})
        self.assertTrue(logger.called)
        self.assertNotIn(self.ticket, str(logger.call_args_list))

    def test_existing_staff_roles_are_preserved(self):
        user = self.existing_user()
        WorkspaceMember.objects.create(workspace=self.workspace, member=user, role=20)
        ProjectMember.objects.create(project=self.project, member=user, role=20)
        self.assertEqual(self.accept().status_code, 200)
        self.assertEqual(WorkspaceMember.objects.get(workspace=self.workspace, member=user).role, 20)
        self.assertEqual(ProjectMember.objects.get(project=self.project, member=user).role, 20)

    def test_landing_explains_different_signed_in_account(self):
        self.client.force_login(self.coach)
        response = self.client.get("/auth/player-invitation/", {"token": self.ticket})
        self.assertEqual(response.status_code, 400)
        self.assertContains(response, "private browser window", status_code=400)
        self.assertNotContains(response, 'name="password"', status_code=400)

    def test_browser_can_refresh_stale_csrf_before_acceptance(self):
        self.client = APIClient(enforce_csrf_checks=True)
        page = self.client.get("/auth/player-invitation/", {"token": self.ticket})
        self.assertContains(page, "fetch('/auth/get-csrf-token/'")
        self.assertIn("connect-src 'self'", page.headers["Content-Security-Policy"])
        old_token = self.client.cookies["csrftoken"].value
        from django.middleware.csrf import _get_new_csrf_string

        self.client.cookies["csrftoken"] = _get_new_csrf_string()
        payload = {
            "token": self.ticket,
            "password": self.password,
            "password_confirm": self.password,
            "browser": "1",
            "csrfmiddlewaretoken": old_token,
        }
        self.assertEqual(self.client.post(self.accept_url, payload).status_code, 403)
        fresh = self.client.get("/auth/get-csrf-token/").json()["csrf_token"]
        payload["csrfmiddlewaretoken"] = fresh
        response = self.client.post(self.accept_url, payload)
        self.assertEqual(response.status_code, 200, response.content)

    def test_workspace_pending_list_excludes_accepted_and_declined_invitations(self):
        WorkspaceMember.objects.create(workspace=self.workspace, member=self.coach, role=20)
        self.client.force_authenticate(self.coach)
        url = f"/api/workspaces/{self.workspace.slug}/invitations/"
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, self.player.email)
        self.invite.accepted = True
        self.invite.responded_at = timezone.now()
        self.invite.save()
        response = self.client.get(url)
        self.assertNotContains(response, self.player.email)
        self.invite.accepted = False
        self.invite.save()
        response = self.client.get(url)
        self.assertNotContains(response, self.player.email)
