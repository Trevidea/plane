"""Shared QR enrollment is scoped, revocable, and distinct from email invitations."""

from datetime import timedelta
from unittest.mock import patch
from urllib.parse import urlencode

from django.core.cache import cache
from django.core import signing
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from plane.db.models import (
    Issue, PlayerRegistrationSession, Project, ProjectMember, RosterPlayer, State, User, Workspace, WorkspaceMember,
)


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
        self.assertIn("/auth/player-registration/#token=", ticket["url"])
        self.assertEqual(ticket["program_name"], "Varsity")
        preview = self.public.post("/api/player/registration/preview/", {"token": ticket["token"]}, format="json")
        self.assertEqual(preview.status_code, 200, preview.content)
        self.assertEqual(set(preview.json()), {"program_name", "workspace_name", "expires_at"})
        self.assertIn("no-store", preview.headers["Cache-Control"])
        self.assertEqual(self.client.delete(self.management_url).status_code, 204)
        self.assertEqual(self.accept(ticket).status_code, 400)

    def test_enrollment_reports_need_own_valid_operation_and_separate_send(self):
        from plane.app.views import enrollment_diagnostics as reports

        athlete = self.existing()
        other = User.objects.create(email="other-report@fixture.test", username="other-report")
        ticket = self.generate()
        self.public.force_login(athlete)
        operation = "enr-" + "f" * 32
        route = "/api/player/enrollment-diagnostics/"
        body = {
            "mode": "save",
            "operation_id": operation,
            "observation": {"action": "lookup", "result": "confirmed", "duration_ms": 240},
        }

        def submit(client, payload, origin="http://testserver"):
            return client.post(route, payload, format="json", HTTP_ORIGIN=origin)

        with self.settings(
            CUSTOMER_DIAGNOSTICS_ENABLED=True,
            CUSTOMER_DIAGNOSTICS_WORKSPACES=self.workspace.slug,
        ):
            self.assertEqual(submit(self.public, body).status_code, 404)
            invalid = self.public.post(
                "/api/player/registration/preview/", {"token": "invalid"}, format="json",
                HTTP_X_KANAVIO_OPERATION_ID=operation,
            )
            self.assertEqual(invalid.status_code, 400)
            self.assertEqual(submit(self.public, body).status_code, 404)
            preview = self.public.post(
                "/api/player/registration/preview/", {"token": ticket["token"]}, format="json",
                HTTP_X_KANAVIO_OPERATION_ID=operation,
            )
            self.assertEqual(preview.status_code, 200, preview.content)
            outsider = APIClient()
            outsider.force_login(other)
            csrf_client = APIClient(enforce_csrf_checks=True)
            csrf_client.force_login(athlete)
            self.assertEqual(submit(csrf_client, body).status_code, 403)
            with (
                patch.object(reports, "_bridge_key", return_value="k" * 43),
                patch.object(reports, "product_request", return_value=({"incident": {"id": "1" * 32}}, 202)) as relay,
                patch.object(reports, "emit") as emit,
            ):
                self.assertEqual(submit(outsider, body).status_code, 404)
                self.assertEqual(submit(self.public, body, "https://other-school.test").status_code, 403)
                self.assertEqual(submit(self.public, {**body, "scope": "other/scope"}).status_code, 400)
                self.assertEqual(submit(self.public, {**body, "observation": {
                    **body["observation"], "name": "private",
                }}).status_code, 400)
                relay.assert_not_called()
                self.assertEqual(submit(self.public, {**body, "mode": "observe"}).status_code, 200)
                relay.assert_not_called()
                self.assertEqual(emit.call_args.kwargs["context_override"]["scope"], "unscoped")
                saved = submit(self.public, body)
                self.assertEqual(saved.status_code, 202, saved.content)
                self.assertEqual(relay.call_args.args[:3], (athlete.pk, self.workspace.slug, str(self.project.pk)))
                self.assertIs(relay.call_args.args[4]["share"], False)
                self.assertNotIn(ticket["token"], str(emit.call_args_list))
                self.assertEqual(submit(self.public, {
                    "mode": "send", "operation_id": operation, "incident_id": "2" * 32,
                }).status_code, 404)
                self.assertEqual(submit(self.public, {
                    "mode": "send", "operation_id": operation, "incident_id": "1" * 32,
                }).status_code, 202)
                self.assertTrue(relay.call_args.args[3].endswith("/submit"))
                self.assertEqual(relay.call_args.args[4], {"consent": True})

    def test_account_hold_hides_roster_entry_and_rejects_direct_claim(self):
        held = RosterPlayer.objects.create(project=self.project, player_name="Held player", account_link_held=True)
        user = self.existing()
        self.public.force_login(user)
        ticket = self.generate()
        response = self.public.post("/api/player/registration/preview/", {"token": ticket["token"]}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["roster_candidates"]["results"], [])
        self.assertEqual(self.accept(ticket, mode="join", roster_player_id=str(held.pk)).status_code, 400)
        held.refresh_from_db()
        self.assertIsNone(held.user_id)

    def exchange(self, code, client=None):
        return (client or self.public).post("/api/player/registration/preview/", {"code": code}, format="json")

    def test_short_code_exchanges_to_same_team_with_seven_day_lifetime(self):
        ticket = self.generate()
        session = PlayerRegistrationSession.objects.get(project=self.project)
        self.assertEqual(session.team_season.project_id, self.project.id)
        expected = timezone.now() + timedelta(days=7)
        self.assertLess(abs((session.expires_at - expected).total_seconds()), 5)
        code = ticket["short_code"]
        self.assertRegex(code, r"^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$")
        self.assertEqual(len(session.code_digest), 64)
        self.assertNotIn(code.replace("-", ""), session.code_digest)
        self.assertEqual(self.client.get(self.management_url).json()["short_code"], code)
        exchanged = self.exchange(code.replace("-", "").lower())
        self.assertEqual(exchanged.status_code, 200)
        self.assertEqual(set(exchanged.json()), {"token"})
        preview = self.public.post("/api/player/registration/preview/", exchanged.json(), format="json")
        self.assertEqual(preview.json()["program_name"], self.project.name)
        self.assertNotIn("short_code", preview.json())
        self.assertEqual(self.accept(exchanged.json()).status_code, 200)
        self.assertFalse(
            ProjectMember.objects.filter(project=self.project, member__email="qr-player@fixture.test").exists()
        )

    def test_code_exchange_requires_csrf_and_is_rate_limited(self):
        code = self.generate()["short_code"]
        self.assertEqual(self.exchange(code, APIClient(enforce_csrf_checks=True)).status_code, 403)
        with patch("plane.authentication.views.player_registration.limited", side_effect=[False, True]):
            self.assertEqual(self.exchange(code).status_code, 429)
        bad = self.public.post(
            "/api/player/registration/preview/", {"code": code, "roster_offset": 0}, format="json"
        )
        self.assertEqual(bad.status_code, 400)

    def test_code_requests_do_not_spend_the_token_preview_budget(self):
        ticket = self.generate()
        with patch("plane.authentication.views.player_registration.limited", return_value=False) as limiter:
            self.assertEqual(self.exchange(ticket["short_code"]).status_code, 200)
            self.assertNotIn("preview", [call.args[1] for call in limiter.call_args_list])

    def test_stale_coach_view_cannot_replace_or_close_a_newer_session(self):
        initial = self.client.post(self.management_url, {}, format="json", HTTP_IF_MATCH='"none"')
        self.assertEqual(initial.status_code, 201)
        old_version = initial.json()["version"]
        self.assertEqual(
            self.client.post(self.management_url, {}, format="json", HTTP_IF_MATCH='"none"').status_code, 412
        )
        new = self.client.post(self.management_url, {}, format="json", HTTP_IF_MATCH=f'"{old_version}"')
        self.assertEqual(new.status_code, 201)
        self.assertEqual(self.client.delete(self.management_url, HTTP_IF_MATCH=f'"{old_version}"').status_code, 412)
        self.assertEqual(self.exchange(new.json()["short_code"]).status_code, 200)

    def test_replacement_expiry_and_revoke_cover_codes_and_exchanged_links(self):
        old = self.generate()
        exchanged = self.exchange(old["short_code"]).json()
        current = self.generate()
        self.assertNotEqual(old["short_code"], current["short_code"])
        self.assertEqual(self.exchange(old["short_code"]).status_code, 400)
        self.assertEqual(self.accept(exchanged).status_code, 400)
        PlayerRegistrationSession.objects.filter(project=self.project, closed_at__isnull=True).update(
            expires_at=timezone.now() - timedelta(seconds=1)
        )
        self.assertEqual(self.exchange(current["short_code"]).status_code, 400)
        current = self.generate()
        self.assertEqual(self.client.delete(self.management_url).status_code, 204)
        self.assertEqual(self.exchange(current["short_code"]).status_code, 400)

    @override_settings(PLAYER_APP_WEB_URL="https://player.fixture.test")
    def test_landing_uses_configured_origins_and_a_browser_fragment(self):
        ticket = self.generate()
        query = urlencode({"token": ticket["token"], "server": "http://192.168.1.207:8000"})
        landing = self.public.get("/auth/player-registration/")
        self.assertContains(landing, "location.hash")
        self.assertContains(landing, "csrfmiddlewaretoken")
        client = APIClient(enforce_csrf_checks=True)
        payload = urlencode({"token": ticket["token"]})
        form_type = "application/x-www-form-urlencoded"
        self.assertEqual(client.post("/auth/player-registration/", payload, content_type=form_type).status_code, 403)
        client.get("/auth/player-registration/")
        response = client.post(
            "/auth/player-registration/",
            payload,
            content_type=form_type,
            HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value,
        )
        self.assertContains(response, "kanavioplayerapp://register?" + query.replace("&", "&amp;"))
        self.assertContains(response, "https://player.fixture.test/register#" + query.replace("&", "&amp;"))
        self.assertNotContains(response, "ignored.test")
        self.assertEqual(response.headers["Referrer-Policy"], "no-referrer")
        self.client.delete(self.management_url)
        expired = self.public.get("/auth/player-registration/", {"token": ticket["token"]})
        self.assertNotContains(expired, "Continue in browser", status_code=400)

    @override_settings(PLAYER_APP_WEB_URL="https://player.fixture.test@other.test")
    def test_unsafe_browser_origin_is_not_issued(self):
        response = self.public.get("/auth/player-registration/", {"token": self.generate()["token"]})
        self.assertNotContains(response, "Continue in browser")

    def test_existing_legacy_ticket_still_works_without_a_code(self):
        from plane.utils.player_registration import SALT

        session = PlayerRegistrationSession.objects.create(
            project=self.project, expires_at=timezone.now() + timedelta(minutes=10)
        )
        token = signing.dumps({"id": str(session.id), "nonce": str(session.nonce)}, salt=SALT)
        self.assertNotIn("short_code", self.client.get(self.management_url).json())
        self.assertEqual(self.accept({"token": token}).status_code, 200)

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

    def test_accountless_tag_identity_survives_enrollment_and_card_access(self):
        roster = self.management_url.removesuffix("registration/")
        prefix = roster.removesuffix("roster/")
        row = self.client.post(roster, {"player_name": "Alex Player", "jersey_number": "12"}, format="json")
        self.assertEqual(row.status_code, 201, row.content)
        member_id = row.json()["member_id"]
        player = RosterPlayer.objects.get(pk=member_id)
        self.assertIsNone(player.user_id)
        response = self.client.post(
            roster + "tag-references/",
            {"roster_ids": [member_id], "members": [{"member_id": member_id, "jersey": "12"}]},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(
            self.client.patch(f"{roster}{member_id}/", {"jersey_number": "13"}, format="json").status_code, 200
        )
        replacement = self.client.post(roster, {"player_name": "Another player", "jersey_number": "12"}, format="json")
        self.assertEqual(replacement.status_code, 201, replacement.content)

        ticket = self.generate()
        self.assertEqual(self.accept(ticket, mode="signup", roster_player_id=member_id).status_code, 200)
        self.assertEqual(self.approve(player).status_code, 200)
        player.refresh_from_db()
        self.assertIsNotNone(player.first_tagged_at)
        program = self.public.get("/api/player/programs/").json()["results"][0]
        self.assertEqual(program["player_id"], member_id)
        self.assertEqual(program["member_id"], member_id)
        self.assertEqual(program["team_season_id"], str(self.project.team_season.pk))

        state = State.objects.create(project=self.project, name="To Review", group="started", lifecycle_role="assigned")
        card = Issue.objects.create(
            project=self.project,
            state=state,
            name="Review the original #12",
            category="Coaching Card",
            roster_player=player,
            coaching_card_data={
                "recipient_ids": [member_id],
                "playlists": [{"id": "p", "name": "Film", "clips": [{"id": "c", "title": "Clip"}]}],
            },
        )
        response = self.public.get(prefix + "coaching-cards/mine/")
        self.assertEqual(response.status_code, 200, response.content)
        cards = response.json()["results"]
        self.assertEqual([(item["id"], item["member_id"]) for item in cards], [(str(card.pk), member_id)])

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

    def test_roster_notices_follow_join_retry_and_approval_once(self):
        staff = f"/api/workspaces/{self.workspace.slug}/roster-notices/"
        inbox = "/api/player/roster-notices/"
        ticket = self.generate()
        self.assertEqual(self.accept(ticket).status_code, 200)
        self.assertEqual(self.accept(ticket, mode="join").status_code, 200)
        claims = self.client.get(staff).json()["results"]
        self.assertEqual([row["kind"] for row in claims], ["join_requested"])
        self.assertNotIn("email", claims[0])
        self.assertNotIn("token", claims[0])
        self.assertEqual(self.public.get(inbox).json()["results"], [])
        self.assertEqual(self.public.post(f"{staff}{claims[0]['id']}/read/", {}, format="json").status_code, 404)

        player = RosterPlayer.objects.get(project=self.project, email="qr-player@fixture.test")
        self.assertEqual(self.approve(player).status_code, 200)
        self.assertEqual(self.approve(player).status_code, 200)
        page = self.public.get(inbox).json()
        self.assertEqual([row["kind"] for row in page["results"]], ["request_approved"])
        self.assertEqual(page["unread_count"], 1)
        path = f"{inbox}{page['results'][0]['id']}/read/"
        self.assertEqual(self.client.post(path, {}, format="json").status_code, 404)
        self.assertEqual(self.public.post(path, {}, format="json").status_code, 200)
        self.assertEqual(self.public.get(inbox).json()["unread_count"], 0)

    def test_join_logs_correlated_pending_outcome_without_form_data(self):
        ticket = self.generate()
        operation = "enr-" + "a" * 32
        with self.assertLogs("plane.api.request", level="INFO") as captured:
            response = self.public.post(
                "/auth/player-registration/accept/",
                {"token": ticket["token"], "name": "Fixture Private Name", "email": "private@fixture.test",
                 "password": self.password, "password_confirm": self.password, "mode": "signup"},
                HTTP_X_REQUEST_ID="private-contact",
                HTTP_X_KANAVIO_OPERATION_ID=operation,
                HTTP_X_KANAVIO_SCOPE="private-school-name",
            )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["registration_state"], "pending")
        evidence = next(record for record in captured.records if record.event_name == "roster.api.completed")
        self.assertEqual(evidence.operation_id, operation)
        self.assertEqual(evidence.attributes, {
            "action": "join", "channel": "team-link", "result": "pending-approval", "status_code": 200,
        })
        serialized = repr(evidence.__dict__)
        for private in (ticket["token"], "Fixture Private Name", "private@fixture.test", "private-school-name", "private-contact", self.password):
            self.assertNotIn(private, serialized)

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
