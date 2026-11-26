from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from unittest.mock import patch

from django.core.cache import cache
from django.db import close_old_connections
from django.test import RequestFactory, TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from plane.db.models import Project, ProjectMember, RosterPlayer, Session, User, Workspace, WorkspaceMember


class PlayerPasswordResetTests(TestCase):
    def setUp(self):
        cache.clear()
        self.coach = User.objects.create_user(username="reset-coach", email="coach@reset.test")
        self.player = User.objects.create_user(
            username="reset-athlete", email="athlete@reset.test", password="Original-Password-fixture!67"
        )
        self.school = Workspace.objects.create(name="School", slug="reset-school", owner=self.coach)
        self.team = Project.objects.create(name="Team", workspace=self.school, identifier="TEAM")
        WorkspaceMember.objects.create(workspace=self.school, member=self.coach, role=20)
        WorkspaceMember.objects.create(workspace=self.school, member=self.player, role=1)
        ProjectMember.objects.create(project=self.team, member=self.coach, role=15)
        ProjectMember.objects.create(project=self.team, member=self.player, role=1)
        self.row = RosterPlayer.objects.create(project=self.team, player_name="Athlete", user=self.player)
        self.staff = APIClient()
        self.staff.force_authenticate(self.coach)
        self.anonymous = APIClient()
        self.issue_url = (
            f"/api/workspaces/{self.school.slug}/projects/{self.team.pk}/roster/{self.row.pk}/password-reset/"
        )
        self.new_password = "Stronger-Novel-Phrase-fixture!724"

    def issue(self):
        response = self.staff.post(self.issue_url, {"expected_user_id": str(self.player.id)}, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertIn("no-store", response.headers["Cache-Control"])
        return response.json()

    def redeem(self, code, *, password=None):
        password = password or self.new_password
        return self.anonymous.post(
            "/auth/player/password-reset/",
            {"email": self.player.email, "code": code, "password": password, "password_confirm": password},
            format="json",
        )

    def test_reissue_invalidates_previous_and_redeem_destroys_sessions_once(self):
        signed_in = APIClient()
        signed_in.force_login(self.player)
        self.assertTrue(Session.objects.filter(user_id=str(self.player.id)).exists())
        first = self.issue()
        second = self.issue()
        self.assertNotEqual(first["code"], second["code"])
        self.assertEqual(self.staff.get(self.issue_url).status_code, 405)
        self.assertEqual(self.redeem(first["code"]).status_code, 400)
        result = self.redeem(second["code"].lower().replace("-", ""))
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json(), {"reset": True})
        self.assertEqual(self.redeem(second["code"]).status_code, 400)
        self.player.refresh_from_db()
        self.assertTrue(self.player.check_password(self.new_password))
        self.assertFalse(Session.objects.filter(user_id=str(self.player.id)).exists())

    def test_player_can_sign_in_with_only_the_new_password_after_recovery(self):
        from plane.license.models import Instance

        Instance.objects.create(
            instance_name="Recovery test",
            instance_id="recovery-test",
            current_version="test",
            last_checked_at=timezone.now(),
            is_setup_done=True,
        )

        def sign_in(password):
            client = APIClient(enforce_csrf_checks=True)
            token = client.get("/auth/get-csrf-token/").json()["csrf_token"]
            response = client.post(
                "/auth/sign-in/",
                {"email": self.player.email, "password": password, "next_path": "/"},
                HTTP_X_CSRFTOKEN=token,
            )
            self.assertEqual(response.status_code, 302)
            return client

        old_password = "Original-Password-fixture!67"
        signed_in = sign_in(old_password)
        self.assertEqual(signed_in.get("/api/users/me/").status_code, 200)

        code = self.issue()["code"]
        self.anonymous = APIClient(enforce_csrf_checks=True)
        token = self.anonymous.get("/auth/get-csrf-token/").json()["csrf_token"]
        self.anonymous.credentials(HTTP_X_CSRFTOKEN=token)
        self.assertEqual(self.redeem(code).status_code, 200)
        for client in (signed_in, self.anonymous, sign_in(old_password)):
            self.assertIn(client.get("/api/users/me/").status_code, (401, 403))
        self.assertEqual(sign_in(self.new_password).get("/api/users/me/").status_code, 200)

    def test_code_is_hashed_expires_and_has_a_temporary_attempt_limit(self):
        from plane.db.models import PlayerPasswordReset

        data = self.issue()
        saved = PlayerPasswordReset.objects.get(user=self.player)
        self.assertNotEqual(saved.digest, data["code"])
        self.assertEqual(len(saved.digest), 64)
        self.assertLess(abs((saved.expires_at - timezone.now() - timedelta(hours=24)).total_seconds()), 5)
        for _ in range(8):
            self.assertEqual(self.redeem("2222-2222-2222-2222").status_code, 400)
        self.assertEqual(self.redeem(data["code"]).status_code, 429)
        cache.clear()
        self.assertEqual(self.redeem(data["code"]).status_code, 200)
        data = self.issue()
        PlayerPasswordReset.objects.filter(user=self.player).update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.redeem(data["code"]).status_code, 400)

    def test_other_school_and_privileged_accounts_cannot_be_reset(self):
        outsider = Workspace.objects.create(name="Other", slug="reset-other", owner=self.coach)
        outside = WorkspaceMember.objects.create(workspace=outsider, member=self.player, role=1)
        payload = {"expected_user_id": str(self.player.id)}
        self.assertEqual(self.staff.post(self.issue_url, payload, format="json").status_code, 403)
        outside.delete(soft=False)
        self.player.is_staff = True
        self.player.save()
        self.assertEqual(self.staff.post(self.issue_url, payload, format="json").status_code, 403)

    def test_redemption_rechecks_permissions_roster_and_password_policy(self):
        code = self.issue()["code"]
        denied = self.redeem(code, password="12345678")
        self.assertEqual(denied.json()["code"], "weak_password")
        self.assertEqual(denied.status_code, 400)
        RosterPlayer.objects.filter(pk=self.row.pk).update(status="inactive")
        self.assertEqual(self.redeem(code).status_code, 400)

    def test_unrelated_issuer_and_changed_roster_account_are_denied(self):
        self.assertEqual(
            self.staff.post(self.issue_url, {"expected_user_id": str(self.coach.id)}, format="json").status_code, 409
        )
        ProjectMember.objects.filter(project=self.team, member=self.coach).update(role=5)
        self.assertEqual(
            self.staff.post(self.issue_url, {"expected_user_id": str(self.player.id)}, format="json").status_code, 403
        )

    def test_redeem_requires_csrf(self):
        code = self.issue()["code"]
        self.anonymous = APIClient(enforce_csrf_checks=True)
        self.assertEqual(self.redeem(code).status_code, 403)

    def test_issue_requires_csrf_for_cookie_authenticated_coach(self):
        browser = APIClient(enforce_csrf_checks=True)
        browser.force_login(self.coach)
        payload = {"expected_user_id": str(self.player.pk)}
        self.assertEqual(browser.post(self.issue_url, payload, format="json").status_code, 403)
        token = browser.get("/auth/get-csrf-token/").json()["csrf_token"]
        self.assertEqual(
            browser.post(self.issue_url, payload, format="json", HTTP_X_CSRFTOKEN=token).status_code, 201
        )

    def test_old_password_checked_during_reset_cannot_create_a_fresh_session(self):
        from plane.authentication.adapter.error import AuthenticationException
        from plane.authentication.provider.credentials.email import EmailProvider

        code = self.issue()["code"]
        provider = EmailProvider(
            RequestFactory().post("/auth/sign-in/"),
            key=self.player.email,
            code="Original-Password-fixture!67",
        )
        verify = provider.set_user_data

        def verify_before_reset():
            verify()
            self.assertEqual(self.redeem(code).status_code, 200)

        with patch.object(provider, "set_user_data", side_effect=verify_before_reset):
            with self.assertRaises(AuthenticationException):
                provider.authenticate()
        self.player.refresh_from_db()
        self.assertTrue(self.player.check_password(self.new_password))

    def test_another_password_change_invalidates_existing_reset_code(self):
        code = self.issue()["code"]
        self.player.set_password("Changed-separately-by-athlete!12")
        self.player.save(update_fields=["password"])
        self.assertEqual(self.redeem(code).status_code, 400)
        self.player.refresh_from_db()
        self.assertTrue(self.player.check_password("Changed-separately-by-athlete!12"))

    def test_reset_is_not_transferrable_to_another_account(self):
        code = self.issue()["code"]
        payload = {
            "email": self.coach.email,
            "code": code,
            "password": self.new_password,
            "password_confirm": self.new_password,
        }
        response = self.anonymous.post("/auth/player/password-reset/", payload, format="json")
        self.assertEqual(response.json(), {"code": "reset_unavailable"})
        self.assertEqual(self.redeem(code).status_code, 200)

    def test_disabled_password_sign_in_blocks_issue_and_redeem(self):
        code = self.issue()["code"]
        with patch.dict("os.environ", {"ENABLE_EMAIL_PASSWORD": "0"}), override_settings(SKIP_ENV_VAR=False):
            response = self.staff.post(
                self.issue_url, {"expected_user_id": str(self.player.id)}, format="json"
            )
            self.assertEqual(response.status_code, 403)
            self.assertEqual(self.redeem(code).json(), {"code": "reset_unavailable"})

    def test_reset_cannot_establish_a_password_for_sso_only_account(self):
        self.player.is_password_autoset = True
        self.player.save(update_fields=["is_password_autoset"])
        response = self.staff.post(self.issue_url, {"expected_user_id": str(self.player.id)}, format="json")
        self.assertEqual(response.status_code, 403)


class ConcurrentPlayerPasswordResetTests(TransactionTestCase):
    available_apps = ["plane.db", "plane.license"]

    def test_concurrent_redemption_has_only_one_winner(self):
        from plane.utils.player_password_reset import issue_player_reset, redeem_player_reset

        coach = User.objects.create_user(username="concurrent-coach", email="coach@concurrent.test")
        athlete = User.objects.create_user(
            username="concurrent-player", email="player@concurrent.test", password="Original Password Fixture!67"
        )
        school = Workspace.objects.create(name="School", slug="concurrent-reset", owner=coach)
        team = Project.objects.create(name="Team", workspace=school, identifier="TEAM")
        WorkspaceMember.objects.create(workspace=school, member=coach, role=20)
        WorkspaceMember.objects.create(workspace=school, member=athlete, role=1)
        ProjectMember.objects.create(project=team, member=coach, role=15)
        ProjectMember.objects.create(project=team, member=athlete, role=1)
        row = RosterPlayer.objects.create(project=team, player_name="Athlete", user=athlete)
        code = issue_player_reset(team, row.pk, coach, athlete.pk)["code"]
        start = Barrier(2, timeout=5)

        def redeem(password):
            try:
                start.wait()
                return redeem_player_reset(athlete.email, code, password)
            finally:
                close_old_connections()

        passwords = ["Pine-Lake-Strong-fixture!67", "Ocean-River-Strong-fixture!42"]
        with ThreadPoolExecutor(2) as workers:
            futures = [workers.submit(redeem, password) for password in passwords]
            results = [future.result(timeout=10) for future in futures]
        self.assertCountEqual(results, ["reset", "reset_unavailable"])
        athlete.refresh_from_db()
        self.assertTrue(athlete.check_password(passwords[results.index("reset")]))
