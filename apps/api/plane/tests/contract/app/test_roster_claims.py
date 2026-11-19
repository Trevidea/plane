"""Roster-first claims never change the athlete before coach approval."""
from django.test import TestCase, override_settings
from plane.db.models import PlayerRegistrationRequest, Project, ProjectMember, RosterPlayer, User, WorkspaceMember
from plane.tests.contract.app import test_player_registration as registration_fixtures


@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
    PLAYER_APP_API_URL="http://192.168.1.207:8000", WEB_URL="http://testserver",
)
class RosterClaimTests(TestCase):
    setUp = registration_fixtures.PlayerRegistrationTests.setUp
    generate = registration_fixtures.PlayerRegistrationTests.generate
    accept = registration_fixtures.PlayerRegistrationTests.accept
    approve = registration_fixtures.PlayerRegistrationTests.approve
    existing = registration_fixtures.PlayerRegistrationTests.existing

    def athlete(self, **fields):
        return RosterPlayer.objects.create(
            project=self.project, player_name="Roster Athlete", jersey_number="17", **fields
        )

    def preview(self, ticket, **fields):
        return self.public.post(
            "/api/player/registration/preview/", {"token": ticket["token"], **fields}, format="json"
        )

    def decline(self, player):
        url = self.management_url.removesuffix("registration/") + f"{player.pk}/decline/"
        return self.client.post(url, {}, format="json")

    def test_candidates_require_auth_and_hide_email_notes_and_other_programs(self):
        user = self.existing()
        empty = self.athlete(notes="Private", class_year="Junior")
        match = RosterPlayer.objects.create(project=self.project, player_name="Matched", email=user.email.upper())
        RosterPlayer.objects.create(project=self.project, player_name="Different", email="other@fixture.test")
        RosterPlayer.objects.create(project=self.project, player_name="Inactive", status="inactive")
        RosterPlayer.objects.create(project=self.project, player_name="Linked", user=user)
        other = Project.objects.create(workspace=self.workspace, name="Other", identifier="OTH")
        RosterPlayer.objects.create(project=other, player_name="Foreign")
        ticket = self.generate()
        self.assertNotIn("roster_candidates", self.preview(ticket).json())
        # Use another account for the linked exclusion without making this user a member.
        RosterPlayer.objects.filter(project=self.project, player_name="Linked").update(user=self.coach)
        self.public.force_login(user)
        response = self.preview(ticket)
        self.assertEqual(response.status_code, 200)
        page = response.json()["roster_candidates"]
        self.assertEqual({row["id"] for row in page["results"]}, {str(match.pk)})
        self.assertNotIn(str(empty.pk), {row["id"] for row in page["results"]})
        self.assertEqual(set(page["results"][0]), {"id", "player_name", "jersey_number", "position", "class_year"})
        self.assertEqual(page["limit"], 50)

    def test_signup_can_create_account_before_selecting_existing_roster(self):
        player = self.athlete()
        ticket = self.generate()
        response = self.accept(ticket, account_only="1")
        self.assertEqual(response.status_code, 200, response.content)
        user = User.objects.get(email="qr-player@fixture.test")
        self.assertEqual(user.first_name, "Alex Player")
        self.assertFalse(PlayerRegistrationRequest.objects.filter(user=user).exists())
        self.assertFalse(WorkspaceMember.objects.filter(member=user).exists())
        self.assertEqual(self.preview(ticket).json()["roster_candidates"]["results"][0]["id"], str(player.pk))
        response = self.accept(ticket, mode="join", password="", name="", roster_player_id=str(player.pk))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(RosterPlayer.objects.filter(project=self.project).count(), 1)

    def test_email_assigned_to_another_entry_cannot_claim_blank_entry(self):
        user = self.existing()
        blank = self.athlete()
        matching = RosterPlayer.objects.create(project=self.project, player_name="Matched", email=user.email)
        ticket = self.generate()
        self.assertEqual(self.accept(ticket, mode="login", roster_player_id=str(blank.pk)).status_code, 400)
        self.assertFalse(PlayerRegistrationRequest.objects.exists())
        self.assertEqual(self.accept(ticket, mode="login", roster_player_id=str(matching.pk)).status_code, 200)

    def test_blank_email_claim_only_changes_email_and_membership_on_approval(self):
        user = self.existing()
        player = self.athlete(first_tagged_at=None)
        self.assertEqual(self.accept(self.generate(), mode="login", roster_player_id=str(player.pk)).status_code, 200)
        player.refresh_from_db()
        self.assertEqual(player.email, "")
        self.assertIsNone(player.user_id)
        self.assertEqual(player.jersey_number, "17")
        self.assertEqual(RosterPlayer.objects.filter(project=self.project).count(), 1)
        self.assertFalse(WorkspaceMember.objects.filter(workspace=self.workspace, member=user).exists())
        self.assertFalse(ProjectMember.objects.filter(project=self.project, member=user).exists())
        listing = self.client.get(self.management_url.removesuffix("registration/")).json()[0]
        self.assertEqual(listing["registration_email"], user.email)
        self.assertEqual(listing["registration_name"], user.first_name)
        self.assertEqual(self.approve(player).status_code, 200)
        player.refresh_from_db()
        self.assertEqual(player.user_id, user.pk)
        self.assertEqual(player.email, user.email)
        self.assertEqual(player.jersey_number, "17")
        self.assertEqual(ProjectMember.objects.get(project=self.project, member=user).role, 1)
        self.assertEqual(WorkspaceMember.objects.get(workspace=self.workspace, member=user).role, 1)

    def test_decline_keeps_original_roster_and_allows_another_claim(self):
        user = self.existing()
        player = self.athlete()
        ticket = self.generate()
        self.assertEqual(self.accept(ticket, mode="login", roster_player_id=str(player.pk)).status_code, 200)
        self.assertEqual(self.decline(player).status_code, 200)
        player.refresh_from_db()
        self.assertEqual(
            (player.email, player.user_id, player.status, player.jersey_number), ("", None, "active", "17")
        )
        self.assertFalse(PlayerRegistrationRequest.objects.filter(roster_player=player).exists())
        self.assertEqual(self.accept(ticket, mode="join", roster_player_id=str(player.pk)).status_code, 200)
        self.assertEqual(PlayerRegistrationRequest.objects.get(roster_player=player).user_id, user.pk)

    def test_different_email_inactive_linked_and_foreign_entries_cannot_be_claimed(self):
        user = self.existing()
        other = Project.objects.create(workspace=self.workspace, name="Other", identifier="OTH")
        invalid = [
            self.athlete(email="someone-else@fixture.test"),
            RosterPlayer.objects.create(project=self.project, player_name="Inactive", status="inactive"),
            RosterPlayer.objects.create(project=self.project, player_name="Linked", user=self.coach),
            RosterPlayer.objects.create(project=other, player_name="Foreign"),
        ]
        ticket = self.generate()
        for player in invalid:
            self.assertEqual(self.accept(ticket, mode="login", roster_player_id=str(player.pk)).status_code, 400)
        self.assertFalse(PlayerRegistrationRequest.objects.filter(user=user).exists())

    def test_second_account_cannot_replace_pending_claim(self):
        user = self.existing()
        player = self.athlete()
        ticket = self.generate()
        self.assertEqual(self.accept(ticket, mode="login", roster_player_id=str(player.pk)).status_code, 200)
        second = User.objects.create(email="second@fixture.test", username="second")
        self.public.force_login(second)
        candidates = self.preview(ticket).json()["roster_candidates"]["results"]
        self.assertNotIn(str(player.pk), [row["id"] for row in candidates])
        response = self.accept(ticket, mode="join", email=second.email, roster_player_id=str(player.pk))
        self.assertEqual(response.status_code, 400)
        self.assertEqual(PlayerRegistrationRequest.objects.get(roster_player=player).user_id, user.pk)

    def test_approval_revalidates_roster_email_and_decline_requires_coach(self):
        user = self.existing()
        player = self.athlete()
        self.assertEqual(self.accept(self.generate(), mode="login", roster_player_id=str(player.pk)).status_code, 200)
        RosterPlayer.objects.filter(pk=player.pk).update(email="changed@fixture.test")
        self.assertEqual(self.approve(player).status_code, 400)
        self.client.force_login(user)
        self.assertEqual(self.decline(player).status_code, 403)

    def test_candidate_search_and_pagination_are_bounded(self):
        user = self.existing()
        self.public.force_login(user)
        self.athlete()
        ticket = self.generate()
        self.assertEqual(self.preview(ticket, roster_search="missing").json()["roster_candidates"]["results"], [])
        self.assertEqual(self.preview(ticket, roster_offset=-1).status_code, 400)
        self.assertEqual(self.preview(ticket, roster_offset=1).json()["roster_candidates"]["results"], [])
