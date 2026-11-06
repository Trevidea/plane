
"""Protect linked players and scope roster cleanup to removed memberships."""

from unittest.mock import patch

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from plane.db.models import Issue, Project, ProjectMember, RosterPlayer, State, User, Workspace, WorkspaceMember


@override_settings(CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}})
class RosterMemberDeletionTests(TestCase):
    def setUp(self):
        self.coach = User.objects.create(email="delete-coach@fixture.test", username="delete-coach")
        self.player = User.objects.create(email="delete-player@fixture.test", username="delete-player")
        self.workspace = Workspace.objects.create(name="School", slug="delete-roster-school", owner=self.coach)
        WorkspaceMember.objects.create(workspace=self.workspace, member=self.coach, role=20)
        self.membership = WorkspaceMember.objects.create(workspace=self.workspace, member=self.player, role=1)
        self.project = Project.objects.create(workspace=self.workspace, name="Football", identifier="FB")
        ProjectMember.objects.create(project=self.project, member=self.coach, role=20)
        self.project_membership = ProjectMember.objects.create(project=self.project, member=self.player, role=1)
        self.roster = RosterPlayer.objects.create(project=self.project, user=self.player, player_name="Player")
        self.client = APIClient()
        self.client.force_authenticate(self.coach)
        self.roster_url = f"/api/workspaces/{self.workspace.slug}/projects/{self.project.id}/roster/"
        self.member_url = f"/api/workspaces/{self.workspace.slug}/members/{self.membership.id}/"
        self.enterContext(patch("plane.db.mixins.soft_delete_related_objects.delay"))

    def test_linked_roster_cannot_be_deleted_directly(self):
        response = self.client.delete(f"{self.roster_url}{self.roster.id}/")
        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("member", response.data["error"].lower())
        self.assertTrue(RosterPlayer.objects.filter(pk=self.roster.pk).exists())
        self.membership.refresh_from_db()
        self.assertTrue(self.membership.is_active)

    def test_unlinked_roster_can_be_deleted(self):
        unlinked = RosterPlayer.objects.create(project=self.project, player_name="Unlinked")
        response = self.client.delete(f"{self.roster_url}{unlinked.id}/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(RosterPlayer.objects.filter(pk=unlinked.pk).exists())

    def test_member_removal_deletes_linked_rosters_in_all_workspace_programs_only(self):
        second = Project.objects.create(workspace=self.workspace, name="Basketball", identifier="BB")
        second_roster = RosterPlayer.objects.create(project=second, user=self.player, player_name="Player")
        unlinked = RosterPlayer.objects.create(project=self.project, email=self.player.email, player_name="Unlinked")
        other_workspace = Workspace.objects.create(name="Other", slug="delete-other-school", owner=self.coach)
        other_membership = WorkspaceMember.objects.create(workspace=other_workspace, member=self.player, role=1)
        other_project = Project.objects.create(workspace=other_workspace, name="Other", identifier="OT")
        other_roster = RosterPlayer.objects.create(project=other_project, user=self.player, player_name="Player")

        response = self.client.delete(self.member_url)
        self.assertEqual(response.status_code, 204, response.data)
        self.assertFalse(RosterPlayer.objects.filter(pk__in=[self.roster.pk, second_roster.pk]).exists())
        self.assertTrue(RosterPlayer.objects.filter(pk=unlinked.pk).exists())
        self.assertTrue(RosterPlayer.objects.filter(pk=other_roster.pk).exists())
        self.membership.refresh_from_db()
        self.project_membership.refresh_from_db()
        other_membership.refresh_from_db()
        self.assertFalse(self.membership.is_active)
        self.assertFalse(self.project_membership.is_active)
        self.assertTrue(other_membership.is_active)
        self.assertTrue(User.objects.filter(pk=self.player.pk).exists())

    def test_rejected_self_removal_keeps_roster(self):
        own_roster = RosterPlayer.objects.create(project=self.project, user=self.coach, player_name="Coach")
        own_membership = WorkspaceMember.objects.get(workspace=self.workspace, member=self.coach)
        response = self.client.delete(f"/api/workspaces/{self.workspace.slug}/members/{own_membership.id}/")
        self.assertEqual(response.status_code, 400, response.data)
        self.assertTrue(RosterPlayer.objects.filter(pk=own_roster.pk).exists())

    def test_member_removal_preserves_coaching_work_items(self):
        state = State.objects.create(project=self.project, name="Assigned", group="started")
        card = Issue.objects.create(project=self.project, state=state, name="Feedback", roster_player=self.roster)
        response = self.client.delete(self.member_url)
        self.assertEqual(response.status_code, 204, response.data)
        card.refresh_from_db()
        self.assertIsNone(card.deleted_at)
        self.assertIsNone(card.roster_player_id)

    def test_non_admin_cannot_remove_member_or_roster(self):
        membership = WorkspaceMember.objects.get(workspace=self.workspace, member=self.coach)
        membership.role = 15
        membership.save()
        response = self.client.delete(self.member_url)
        self.assertEqual(response.status_code, 403, response.data)
        self.assertTrue(RosterPlayer.objects.filter(pk=self.roster.pk).exists())
