"""Account linkage is independent of the player's availability status."""

from django.db import connection
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext
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


@override_settings(CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}})
class RosterAccountStatusTests(TestCase):
    def setUp(self):
        self.coach = User.objects.create(email="status-coach@fixture.test", username="status-coach")
        self.workspace = Workspace.objects.create(name="School", slug="status-school", owner=self.coach)
        WorkspaceMember.objects.create(workspace=self.workspace, member=self.coach, role=20)
        self.project = Project.objects.create(workspace=self.workspace, name="Football", identifier="FB")
        ProjectMember.objects.create(project=self.project, member=self.coach, role=20)
        self.player = RosterPlayer.objects.create(project=self.project, player_name="Player", status="injured")
        self.client = APIClient()
        self.client.force_authenticate(self.coach)
        self.url = f"/api/workspaces/{self.workspace.slug}/projects/{self.project.id}/roster/"

    def detail(self):
        response = self.client.get(f"{self.url}{self.player.pk}/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["status"], "injured")
        return response.data

    def test_email_missing(self):
        self.assertEqual(self.detail()["account_status"], "email_missing")

    def test_email_alone_is_not_linked_or_pending(self):
        self.player.email = "status-player@fixture.test"
        self.player.save()
        self.assertEqual(self.detail()["account_status"], "not_linked")

    def test_actual_pending_invitation_is_reported_case_insensitively(self):
        self.player.email = "status-player@fixture.test"
        self.player.save()
        WorkspaceMemberInvite.objects.create(
            workspace=self.workspace, email="STATUS-PLAYER@fixture.test", token="fixture", role=1
        )
        self.assertEqual(self.detail()["account_status"], "invitation_pending")

    def test_other_workspace_invitation_does_not_appear_pending(self):
        self.player.email = "status-player@fixture.test"
        self.player.save()
        other = Workspace.objects.create(name="Other", slug="status-other", owner=self.coach)
        WorkspaceMemberInvite.objects.create(workspace=other, email=self.player.email, token="fixture", role=1)
        self.assertEqual(self.detail()["account_status"], "not_linked")

    def test_accepted_or_declined_invitation_is_not_pending(self):
        self.player.email = "status-player@fixture.test"
        self.player.save()
        invite = WorkspaceMemberInvite.objects.create(
            workspace=self.workspace, email=self.player.email, token="fixture", role=1
        )
        for accepted in [True, False]:
            invite.accepted = accepted
            invite.responded_at = timezone.now()
            invite.save()
            self.assertEqual(self.detail()["account_status"], "not_linked")

    def test_explicit_account_link_takes_priority_even_without_roster_email(self):
        self.player.user = self.coach
        self.player.save()
        self.assertEqual(self.detail()["account_status"], "linked")

    def test_list_uses_one_pending_invitation_query_for_many_players(self):
        for number in range(8):
            RosterPlayer.objects.create(
                project=self.project, player_name=f"Player {number}", email=f"status-{number}@fixture.test"
            )
        with CaptureQueriesContext(connection) as queries:
            response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(all("account_status" in player for player in response.data))
        self.assertEqual(sum('"workspace_member_invites"' in query["sql"] for query in queries), 1)

    def test_client_cannot_set_computed_account_status(self):
        response = self.client.patch(f"{self.url}{self.player.pk}/", {"account_status": "linked"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["account_status"], "email_missing")

    def test_accepting_invitation_changes_account_status_to_linked(self):
        self.player.email = "status-player@fixture.test"
        self.player.status = "active"
        self.player.save()
        invite = WorkspaceMemberInvite.objects.create(
            workspace=self.workspace, email=self.player.email, token="fixture", role=1
        )
        self.assertEqual(self.client.get(f"{self.url}{self.player.pk}/").data["account_status"], "invitation_pending")
        response = APIClient().post(
            "/auth/player-invitation/accept/",
            {
                "token": create_player_ticket(invite),
                "name": "Player",
                "password": "Fixture-player-password-827!",
            },
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.client.get(f"{self.url}{self.player.pk}/").data["account_status"], "linked")
