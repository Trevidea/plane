"""Shared QR enrollment is scoped, revocable, and distinct from email invitations."""

from datetime import timedelta
from unittest.mock import patch

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from plane.db.models import PlayerRegistrationSession, Project, ProjectMember, RosterPlayer, User, Workspace, WorkspaceMember


@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
    PLAYER_APP_API_URL="http://192.168.1.207:8000",
    WEB_URL="http://testserver",
)
class PlayerRegistrationTests(TestCase):
    def setUp(self):
        cache.clear()
        self.coach = User.objects.create(email="qr-coach@fixture.test", username="qr-coach")
        self.workspace = Workspace.objects.create(name="School", slug="qr-school", owner=self.coach)
        self.project = Project.objects.create(workspace=self.workspace, name="Varsity", identifier="QR")
        WorkspaceMember.objects.create(workspace=self.workspace, member=self.coach, role=20)
        ProjectMember.objects.create(project=self.project, member=self.coach, role=20)
        self.management_url = f"/api/workspaces/{self.workspace.slug}/projects/{self.project.id}/roster/registration/"
        self.client = APIClient()
        self.client.force_login(self.coach)
        self.public = APIClient()
        self.password = "Qr-fixture-password-827!"
        self.enterContext(patch("plane.db.mixins.soft_delete_related_objects.delay"))

    def generate(self):
        response = self.client.post(self.management_url, {}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()

    def accept(self, ticket, **overrides):
        return self.public.post(
            "/auth/player-registration/accept/",
            {
                "token": ticket["token"],
                "name": "Alex Player",
                "email": "qr-player@fixture.test",
                "password": self.password,
                "password_confirm": self.password,
                "mode": "signup",
                **overrides,
            },
        )

    def existing(self):
        user = User.objects.create(email="qr-player@fixture.test", username="qr-player", first_name="Original")
        user.set_password(self.password)
        user.save()
        return user

    def test_coach_can_generate_preview_and_close(self):
        ticket = self.generate()
        self.assertIn("/auth/player-registration/?token=", ticket["url"])
        self.assertEqual(ticket["program_name"], "Varsity")
        preview = self.public.post("/api/player/registration/preview/", {"token": ticket["token"]}, format="json")
        self.assertEqual(preview.status_code, 200, preview.content)
        self.assertEqual(set(preview.json()), {"program_name", "workspace_name", "expires_at"})
        self.assertIn("no-store", preview.headers["Cache-Control"])
        self.assertEqual(self.client.delete(self.management_url).status_code, 204)
        self.assertEqual(self.accept(ticket).status_code, 400)

    def test_team_code_resolves_to_a_ticket_for_the_same_program(self):
        ticket = self.generate()
        code = ticket["join_code"]
        self.assertRegex(code, r"^[A-Z2-9]{4}-[A-Z2-9]{4}$")
        self.assertEqual(self.client.get(self.management_url).json()["join_code"], code)
        preview = self.public.post(
            "/api/player/registration/preview/", {"code": code.replace("-", "").lower()}, format="json"
        )
        self.assertEqual(preview.status_code, 200, preview.content)
        self.assertEqual(preview.json()["program_name"], "Varsity")
        self.assertEqual(self.accept(preview.json()).status_code, 200)

    def test_replacing_or_closing_registration_invalidates_team_codes(self):
        original = self.generate()
        replacement = self.generate()
        self.assertNotEqual(original["join_code"], replacement["join_code"])
        preview_url = "/api/player/registration/preview/"
        self.assertEqual(
            self.public.post(preview_url, {"code": original["join_code"]}, format="json").status_code, 400
        )
        self.assertEqual(self.client.delete(self.management_url).status_code, 204)
        self.assertEqual(
            self.public.post(preview_url, {"code": replacement["join_code"]}, format="json").status_code, 400
        )

    def test_existing_qr_gets_a_team_code_with_the_original_expiry(self):
        ticket = self.generate()
        session = PlayerRegistrationSession.objects.get(project=self.project)
        PlayerRegistrationSession.objects.filter(pk=session.pk).update(join_code=None)
        response = self.client.get(self.management_url)
        self.assertEqual(response.status_code, 200)
        code = response.json()["join_code"]
        preview_url = "/api/player/registration/preview/"
        preview = self.public.post(preview_url, {"token": ticket["token"]}, format="json")
        self.assertEqual(preview.status_code, 200)
        self.assertEqual(preview.json()["expires_at"], response.json()["expires_at"])
        PlayerRegistrationSession.objects.filter(pk=session.pk).update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.public.post(preview_url, {"code": code}, format="json").status_code, 400)

    def test_signup_waits_for_approval_without_memberships_or_roster_link(self):
        response = self.accept(self.generate())
        self.assertEqual(response.status_code, 200, response.content)
        user = User.objects.get(email="qr-player@fixture.test")
        self.assertFalse(user.is_email_verified)
        self.assertTrue(user.check_password(self.password))
        self.assertFalse(WorkspaceMember.objects.filter(workspace=self.workspace, member=user).exists())
        self.assertFalse(ProjectMember.objects.filter(project=self.project, member=user).exists())
        player = RosterPlayer.objects.get(project=self.project, email=user.email)
        self.assertEqual(player.player_name, "Alex Player")
        self.assertEqual(player.status, "pending")
        self.assertIsNone(player.user_id)
        self.assertEqual(self.public.get("/api/users/me/").status_code, 200)
        self.assertEqual(self.public.get("/api/player/programs/").json()["results"], [])
        pending = self.public.get("/api/player/registration/requests/")
        self.assertEqual(pending.status_code, 200, pending.content)
        self.assertEqual(pending.json()["results"][0]["program_name"], self.project.name)

    def approve(self, player):
        return self.client.post(
            f"/api/workspaces/{self.workspace.slug}/projects/{self.project.id}/roster/{player.id}/approve/",
            {},
            format="json",
        )

    def test_one_coach_approval_creates_memberships_and_links_the_roster(self):
        ticket = self.generate()
        self.assertEqual(self.accept(ticket).status_code, 200)
        user = User.objects.get(email="qr-player@fixture.test")
        player = RosterPlayer.objects.get(project=self.project, email=user.email)
        listing = self.client.get(f"/api/workspaces/{self.workspace.slug}/projects/{self.project.id}/roster/")
        self.assertEqual(listing.json()[0]["registration_status"], "pending")
        self.assertEqual(self.approve(player).status_code, 200)
        player.refresh_from_db()
        self.assertEqual(player.user_id, user.id)
        self.assertEqual(player.status, "active")
        self.assertEqual(WorkspaceMember.objects.get(workspace=self.workspace, member=user).role, 1)
        self.assertEqual(ProjectMember.objects.get(project=self.project, member=user).role, 1)
        self.assertEqual(self.public.get("/api/player/programs/").json()["results"][0]["id"], str(self.project.id))
        self.assertEqual(self.public.get("/api/player/registration/requests/").json()["results"], [])
        self.assertEqual(self.approve(player).status_code, 200)
        self.assertEqual(ProjectMember.objects.filter(project=self.project, member=user).count(), 1)

    def test_pending_registration_can_be_approved_after_qr_closes(self):
        self.accept(self.generate())
        self.client.delete(self.management_url)
        self.assertEqual(self.approve(RosterPlayer.objects.get(project=self.project)).status_code, 200)

    def test_coach_can_approve_legacy_link_without_program_membership(self):
        from plane.db.models import PlayerRegistrationRequest

        user = self.existing()
        WorkspaceMember.objects.create(workspace=self.workspace, member=user, role=1)
        player = RosterPlayer.objects.create(
            project=self.project, user=user, email=user.email, player_name="Legacy", jersey_number="17"
        )
        listing_url = self.management_url.removesuffix("registration/")
        self.assertEqual(self.client.get(listing_url).json()[0]["registration_status"], "pending")
        self.assertEqual(self.approve(player).status_code, 200)
        player.refresh_from_db()
        self.assertEqual(player.user_id, user.pk)
        self.assertEqual(player.jersey_number, "17")
        self.assertEqual(ProjectMember.objects.get(project=self.project, member=user).role, 1)
        approval = PlayerRegistrationRequest.objects.get(roster_player=player)
        self.assertEqual(approval.approved_by_id, self.coach.pk)
        self.assertIsNotNone(approval.approved_at)
        self.assertIsNone(self.client.get(listing_url).json()[0]["registration_status"])
        self.assertEqual(self.approve(player).status_code, 200)
        self.assertEqual(ProjectMember.objects.filter(project=self.project, member=user).count(), 1)

    def test_legacy_approval_cannot_restore_removed_program_membership(self):
        user = self.existing()
        WorkspaceMember.objects.create(workspace=self.workspace, member=user, role=1)
        player = RosterPlayer.objects.create(project=self.project, user=user, email=user.email, player_name="Legacy")
        ProjectMember.objects.create(project=self.project, member=user, role=1, deleted_at=timezone.now())
        self.assertNotEqual(self.approve(player).status_code, 200)
        self.assertFalse(ProjectMember.objects.filter(project=self.project, member=user).exists())

    def test_legacy_player_cannot_approve_their_own_membership(self):
        user = self.existing()
        WorkspaceMember.objects.create(workspace=self.workspace, member=user, role=1)
        player = RosterPlayer.objects.create(project=self.project, user=user, email=user.email, player_name="Legacy")
        self.client.force_login(user)
        self.assertEqual(self.approve(player).status_code, 403)
        self.assertFalse(ProjectMember.objects.filter(project=self.project, member=user).exists())

    def test_existing_workspace_account_requires_approval_in_another_program(self):
        user = self.existing()
        WorkspaceMember.objects.create(workspace=self.workspace, member=user, role=1)
        other = Project.objects.create(workspace=self.workspace, name="Previous team", identifier="PREV")
        ProjectMember.objects.create(project=other, member=user, role=1)
        previous = RosterPlayer.objects.create(project=other, user=user, player_name="Original", email=user.email)
        roster_url = self.management_url.removesuffix("registration/")
        response = self.client.post(roster_url, {"player_name": "Alex", "email": user.email}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        player = RosterPlayer.objects.get(pk=response.json()["id"])
        self.assertIsNone(player.user_id)
        self.assertEqual(player.status, "active")  # Available for live tagging before joining.
        self.assertFalse(ProjectMember.objects.filter(project=self.project, member=user).exists())
        ticket = self.generate()
        self.assertEqual(self.accept(ticket, mode="login").status_code, 200)
        self.assertEqual(self.accept(ticket, mode="join").status_code, 200)
        player.refresh_from_db()
        self.assertIsNone(player.user_id)
        self.assertEqual(RosterPlayer.objects.filter(project=self.project).count(), 1)
        visible_programs = self.public.get("/api/player/programs/").json()["results"]
        self.assertNotIn(str(self.project.id), [p["id"] for p in visible_programs])
        self.assertEqual(self.client.get(roster_url).json()[0]["registration_status"], "pending")
        self.assertEqual(self.approve(player).status_code, 200)
        self.assertEqual(self.approve(player).status_code, 200)
        previous.refresh_from_db()
        self.assertEqual(previous.user_id, user.pk)
        self.assertEqual(ProjectMember.objects.filter(project=self.project, member=user).count(), 1)
        self.assertEqual(len(self.public.get("/api/player/programs/").json()["results"]), 2)

    def test_import_matching_email_does_not_grant_player_access(self):
        user = self.existing()
        WorkspaceMember.objects.create(workspace=self.workspace, member=user, role=1)
        response = self.client.post(
            self.management_url.removesuffix("registration/") + "import/",
            {"players": [{"player_name": "Alex", "email": user.email, "jersey_number": "12"}]}, format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertIsNone(RosterPlayer.objects.get(project=self.project).user_id)

    def test_explicit_roster_link_cannot_bypass_approval(self):
        user = self.existing()
        WorkspaceMember.objects.create(workspace=self.workspace, member=user, role=1)
        url = self.management_url.removesuffix("registration/")
        response = self.client.post(url, {"player_name": "Alex", "user": str(user.pk)}, format="json")
        self.assertEqual(response.status_code, 400, response.content)
        player = RosterPlayer.objects.create(project=self.project, player_name="Alex")
        response = self.client.patch(f"{url}{player.pk}/", {"user": str(user.pk)}, format="json")
        self.assertEqual(response.status_code, 400, response.content)
        player.refresh_from_db()
        self.assertIsNone(player.user_id)

    def test_invitation_membership_does_not_automatically_link_roster(self):
        from plane.utils.roster_membership import link_roster_memberships

        user = self.existing()
        WorkspaceMember.objects.create(workspace=self.workspace, member=user, role=1)
        player = RosterPlayer.objects.create(project=self.project, player_name="Alex", email=user.email)
        link_roster_memberships(user, [self.workspace.pk])
        player.refresh_from_db()
        self.assertIsNone(player.user_id)

    def test_approved_player_is_in_program_member_response_with_role_and_join_date(self):
        self.assertEqual(self.accept(self.generate()).status_code, 200)
        player = RosterPlayer.objects.get(project=self.project)
        self.assertEqual(self.approve(player).status_code, 200)
        player.refresh_from_db()
        response = self.client.get(self.management_url.removesuffix("roster/registration/") + "members/")
        self.assertEqual(response.status_code, 200, response.content)
        member = next(row for row in response.json() if row["member"] == str(player.user_id))
        self.assertEqual(member["role"], 1)
        self.assertEqual(member["original_role"], 1)
        self.assertTrue(member["created_at"])

    def test_pending_athlete_cannot_approve_their_own_registration(self):
        self.accept(self.generate())
        self.client.force_login(User.objects.get(email="qr-player@fixture.test"))
        self.assertEqual(self.approve(RosterPlayer.objects.get(project=self.project)).status_code, 403)

    def test_pending_registration_cannot_be_linked_by_normal_roster_edit(self):
        self.accept(self.generate())
        user = User.objects.get(email="qr-player@fixture.test")
        player = RosterPlayer.objects.get(project=self.project)
        url = f"/api/workspaces/{self.workspace.slug}/projects/{self.project.id}/roster/{player.id}/"
        self.assertEqual(
            self.client.patch(url, {"user": str(user.id), "status": "active"}, format="json").status_code, 400
        )
        self.assertEqual(self.client.patch(url, {"status": "active"}, format="json").status_code, 400)
        player.refresh_from_db()
        self.assertIsNone(player.user_id)

    def test_email_auto_linking_does_not_bypass_approval_for_workspace_member(self):
        from plane.utils.roster_membership import link_roster_memberships

        user = self.existing()
        WorkspaceMember.objects.create(workspace=self.workspace, member=user, role=1)
        self.assertEqual(self.accept(self.generate(), mode="login").status_code, 200)
        link_roster_memberships(user, [self.workspace.id])
        player = RosterPlayer.objects.get(project=self.project)
        self.assertIsNone(player.user_id)
        self.assertFalse(ProjectMember.objects.filter(project=self.project, member=user).exists())

    def test_single_member_coach_approval_records_the_approver(self):
        from plane.db.models import PlayerRegistrationRequest

        self.accept(self.generate())
        coach = User.objects.create(email="assistant@fixture.test", username="assistant")
        WorkspaceMember.objects.create(workspace=self.workspace, member=coach, role=15)
        ProjectMember.objects.create(project=self.project, member=coach, role=15)
        self.client.force_login(coach)
        player = RosterPlayer.objects.get(project=self.project)
        self.assertEqual(self.approve(player).status_code, 200)
        approval = PlayerRegistrationRequest.objects.get(roster_player=player)
        self.assertEqual(approval.approved_by_id, coach.pk)
        self.assertIsNotNone(approval.approved_at)
        self.client.force_login(self.coach)
        self.assertEqual(self.approve(player).status_code, 200)
        approval.refresh_from_db()
        self.assertEqual(approval.approved_by_id, coach.pk)

    def test_other_program_coach_cannot_approve_registration(self):
        self.accept(self.generate())
        player = RosterPlayer.objects.get(project=self.project)
        other = Project.objects.create(workspace=self.workspace, name="Other team", identifier="OTHER")
        ProjectMember.objects.create(project=other, member=self.coach, role=20)
        url = f"/api/workspaces/{self.workspace.slug}/projects/{other.pk}/roster/{player.pk}/approve/"
        self.assertEqual(self.client.post(url, {}, format="json").status_code, 404)
        player.refresh_from_db()
        self.assertIsNone(player.user_id)

    def test_pending_requests_are_visible_only_to_the_requesting_account(self):
        self.accept(self.generate())
        other = User.objects.create(email="other@fixture.test", username="other")
        self.public.force_login(other)
        self.assertEqual(self.public.get("/api/player/registration/requests/").json()["results"], [])

    def test_deleted_pending_roster_can_submit_a_fresh_request(self):
        ticket = self.generate()
        self.accept(ticket)
        player = RosterPlayer.objects.get(project=self.project)
        url = f"/api/workspaces/{self.workspace.slug}/projects/{self.project.id}/roster/{player.pk}/"
        self.assertEqual(self.client.delete(url).status_code, 200)
        self.assertEqual(self.accept(ticket, mode="join", password="", password_confirm="").status_code, 200)
        self.assertEqual(RosterPlayer.objects.filter(project=self.project).count(), 1)

    def test_regenerating_invalidates_previous_qr(self):
        old = self.generate()
        new = self.generate()
        self.assertEqual(self.accept(old).status_code, 400)
        self.assertFalse(User.objects.filter(email="qr-player@fixture.test").exists())
        self.assertEqual(self.accept(new).status_code, 200)

    def test_expired_qr_creates_nothing(self):
        ticket = self.generate()
        from plane.db.models import PlayerRegistrationSession

        PlayerRegistrationSession.objects.filter(project=self.project).update(
            expires_at=timezone.now() - timedelta(seconds=1)
        )
        self.assertEqual(self.accept(ticket).status_code, 400)
        self.assertFalse(User.objects.filter(email="qr-player@fixture.test").exists())

    def test_existing_account_requires_login_and_preserves_name_and_role(self):
        user = self.existing()
        WorkspaceMember.objects.create(workspace=self.workspace, member=user, role=15)
        ProjectMember.objects.create(project=self.project, member=user, role=15)
        ticket = self.generate()
        conflict = self.accept(ticket)
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(conflict.json()["code"], "account_exists")
        self.assertEqual(self.accept(ticket, mode="login", password="wrong").status_code, 400)
        self.assertEqual(self.accept(ticket, mode="login").status_code, 200)
        user.refresh_from_db()
        self.assertEqual(user.first_name, "Original")
        self.assertEqual(WorkspaceMember.objects.get(workspace=self.workspace, member=user).role, 15)

    def test_authenticated_preview_reports_own_program_registration(self):
        user = self.existing()
        ticket = self.generate()
        self.public.force_login(user)

        def status():
            return self.public.post(
                "/api/player/registration/preview/", {"token": ticket["token"]}, format="json"
            ).json()["enrollment_status"]

        self.assertEqual(status(), "new")
        self.assertEqual(self.accept(ticket, mode="join", name="Roster Name").status_code, 200)
        self.assertEqual(status(), "pending")
        self.approve(RosterPlayer.objects.get(project=self.project))
        self.assertEqual(status(), "member")

    def test_first_program_join_requires_full_name_without_changing_account_profile(self):
        user = self.existing()
        self.public.force_login(user)
        ticket = self.generate()
        self.assertEqual(self.accept(ticket, mode="join", name="  ").status_code, 400)
        self.assertFalse(RosterPlayer.objects.filter(project=self.project).exists())
        self.assertEqual(self.accept(ticket, mode="join", name="  Program Full Name  ").status_code, 200)
        player = RosterPlayer.objects.get(project=self.project)
        self.assertEqual(player.player_name, "Program Full Name")
        user.refresh_from_db()
        self.assertEqual(user.first_name, "Original")
        self.assertEqual(self.accept(ticket, mode="join", name="").status_code, 200)
        player.refresh_from_db()
        self.assertEqual(player.player_name, "Program Full Name")

    def test_repeated_join_is_idempotent(self):
        ticket = self.generate()
        self.assertEqual(self.accept(ticket).status_code, 200)
        self.assertEqual(self.accept(ticket, mode="join", password="", password_confirm="").status_code, 200)
        self.assertEqual(RosterPlayer.objects.filter(project=self.project, email="qr-player@fixture.test").count(), 1)

    def test_matching_email_uses_existing_roster_and_links_only_after_approval(self):
        from plane.db.models import PlayerRegistrationRequest, WorkspaceMemberInvite
        from plane.utils.player_invitations import invitation_roster

        email = "qr-player@fixture.test"
        player = RosterPlayer.objects.create(
            project=self.project, player_name="Imported Athlete", jersey_number="17", email=email.upper()
        )
        invite = WorkspaceMemberInvite.objects.create(workspace=self.workspace, email=email, role=1, token="fixture")
        other_invite = WorkspaceMemberInvite.objects.create(
            workspace=self.workspace, email="another-athlete@fixture.test", role=1, token="other-fixture"
        )
        invitations_url = f"/api/workspaces/{self.workspace.slug}/invitations/"
        ticket = self.generate()
        response = self.accept(ticket)
        self.assertEqual(response.status_code, 200, response.content)
        user = User.objects.get(email=email)
        self.assertFalse(user.is_email_verified)
        self.assertEqual(RosterPlayer.objects.filter(project=self.project).count(), 1)
        player.refresh_from_db()
        self.assertIsNone(player.user_id)
        self.assertEqual(player.status, "active")
        self.assertFalse(WorkspaceMember.objects.filter(workspace=self.workspace, member=user).exists())
        self.assertFalse(ProjectMember.objects.filter(project=self.project, member=user).exists())
        self.assertFalse(invitation_roster(invite).filter(pk=player.pk).exists())
        self.assertTrue(WorkspaceMemberInvite.objects.filter(pk=invite.pk).exists())
        self.assertEqual(self.accept(ticket, mode="join", password="", name="").status_code, 200)
        self.assertEqual(PlayerRegistrationRequest.objects.filter(roster_player=player, user=user).count(), 1)

        listing = self.client.get(f"/api/workspaces/{self.workspace.slug}/projects/{self.project.id}/roster/")
        self.assertEqual(listing.json()[0]["registration_status"], "pending")
        self.assertEqual(self.approve(player).status_code, 200)
        self.assertFalse(WorkspaceMemberInvite.objects.filter(pk=invite.pk).exists())
        self.assertEqual([row["id"] for row in self.client.get(invitations_url).json()], [str(other_invite.pk)])
        player.refresh_from_db()
        self.assertEqual(player.user_id, user.pk)
        self.assertEqual(player.player_name, "Imported Athlete")
        self.assertEqual(player.jersey_number, "17")
        self.assertEqual(WorkspaceMember.objects.get(workspace=self.workspace, member=user).role, 1)
        self.assertEqual(ProjectMember.objects.get(project=self.project, member=user).role, 1)

    def test_matching_inactive_or_removed_player_cannot_be_claimed(self):
        player = RosterPlayer.objects.create(
            project=self.project, player_name="Former Athlete", email="qr-player@fixture.test", status="inactive"
        )
        ticket = self.generate()
        for roster_status in ("inactive", "removed"):
            with self.subTest(status=roster_status):
                RosterPlayer.objects.filter(pk=player.pk).update(status=roster_status)
                self.assertEqual(self.accept(ticket).status_code, 400)
                self.assertFalse(User.objects.filter(email=player.email).exists())

    def test_inactive_memberships_are_not_reactivated(self):
        user = self.existing()
        WorkspaceMember.objects.create(workspace=self.workspace, member=user, role=20, is_active=False)
        self.assertEqual(self.accept(self.generate(), mode="login").status_code, 400)
        self.assertFalse(WorkspaceMember.objects.get(workspace=self.workspace, member=user).is_active)
        self.assertFalse(ProjectMember.objects.filter(project=self.project, member=user).exists())

    def test_client_cannot_supply_role_or_foreign_program(self):
        self.assertEqual(self.accept(self.generate(), role="20").status_code, 400)
        self.assertFalse(User.objects.filter(email="qr-player@fixture.test").exists())

    def test_athlete_cannot_generate_qr(self):
        user = self.existing()
        WorkspaceMember.objects.create(workspace=self.workspace, member=user, role=1)
        ProjectMember.objects.create(project=self.project, member=user, role=1)
        self.client.force_login(user)
        self.assertEqual(self.client.post(self.management_url, {}, format="json").status_code, 403)

    def test_archived_program_rejects_qr(self):
        ticket = self.generate()
        self.project.archived_at = timezone.now()
        self.project.save()
        self.assertEqual(self.accept(ticket).status_code, 400)

    def test_signup_password_confirmation_is_required(self):
        self.assertEqual(self.accept(self.generate(), password_confirm="different").status_code, 400)

    def test_signup_reports_password_validation_without_exposing_credentials(self):
        ticket = self.generate()
        for password in ["password", "Aaaa123!"]:
            with self.subTest(password_case="weak"):
                response = self.accept(ticket, password=password, password_confirm=password, account_only="1")
                self.assertEqual(response.status_code, 400, response.content)
                self.assertEqual(response.json()["code"], "weak_password")
                self.assertNotIn("qr-player@fixture.test", response.content.decode())
                self.assertFalse(User.objects.filter(email="qr-player@fixture.test").exists())

    def test_expired_signup_reports_that_a_new_qr_is_required(self):
        from plane.db.models import PlayerRegistrationSession
        ticket = self.generate()
        PlayerRegistrationSession.objects.filter(project=self.project).update(
            expires_at=timezone.now() - timedelta(seconds=1)
        )
        response = self.accept(ticket, account_only="1")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "registration_unavailable")
        self.assertFalse(User.objects.filter(email="qr-player@fixture.test").exists())

    def test_acceptance_is_csrf_protected(self):
        self.public = APIClient(enforce_csrf_checks=True)
        self.assertEqual(self.accept(self.generate()).status_code, 403)

    def test_group_registration_does_not_share_a_ten_athlete_limit(self):
        ticket = self.generate()
        for index in range(11):
            self.public = APIClient()
            response = self.accept(ticket, email=f"group-{index}@fixture.test")
            self.assertEqual(response.status_code, 200, response.content)

    def test_repeated_bad_password_attempts_for_one_account_are_limited(self):
        self.existing()
        ticket = self.generate()
        for _ in range(10):
            self.assertEqual(self.accept(ticket, mode="login", password="incorrect").status_code, 400)
        self.assertEqual(self.accept(ticket, mode="login", password="incorrect").status_code, 429)

    def test_existing_account_email_is_case_insensitive(self):
        user = self.existing()
        user.email = "Qr-Player@Fixture.test"
        user.save(update_fields=["email"])
        self.assertEqual(self.accept(self.generate(), mode="login").status_code, 200)

    def test_active_membership_is_preserved_when_older_membership_was_deleted(self):
        user = self.existing()
        WorkspaceMember.objects.create(workspace=self.workspace, member=user, role=1, deleted_at=timezone.now())
        WorkspaceMember.objects.create(workspace=self.workspace, member=user, role=15)
        ProjectMember.objects.create(project=self.project, member=user, role=1, deleted_at=timezone.now())
        ProjectMember.objects.create(project=self.project, member=user, role=15)
        self.assertEqual(self.accept(self.generate(), mode="login").status_code, 200)
        self.assertEqual(WorkspaceMember.objects.get(workspace=self.workspace, member=user).role, 15)
