"""Player Users cannot gain program administration through lead assignment."""

from unittest.mock import patch

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from plane.db.models import Project, ProjectMember, User, Workspace, WorkspaceMember


@override_settings(CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}})
class ProjectLeadRoleTests(TestCase):
    def setUp(self):
        self.coach = User.objects.create(email="lead-coach@fixture.test", username="lead-coach")
        self.player = User.objects.create(email="lead-player@fixture.test", username="lead-player")
        self.workspace = Workspace.objects.create(name="School", slug="lead-role-school", owner=self.coach)
        WorkspaceMember.objects.create(workspace=self.workspace, member=self.coach, role=20)
        self.membership = WorkspaceMember.objects.create(workspace=self.workspace, member=self.player, role=1)
        self.project = Project.objects.create(workspace=self.workspace, name="Football", identifier="FB")
        ProjectMember.objects.create(project=self.project, member=self.coach, role=20)
        self.client = APIClient()
        self.client.force_authenticate(self.coach)
        self.url = f"/api/workspaces/{self.workspace.slug}/projects/"
        self.enterContext(patch("plane.app.views.project.base.model_activity.delay"))
        self.enterContext(patch("plane.utils.cache.invalidate_cache_directly"))
        self.enterContext(patch("plane.db.mixins.soft_delete_related_objects.delay"))

    def test_creation_rejects_user_lead_without_creating_project_or_promoting_user(self):
        response = self.client.post(
            self.url, {"name": "NBA", "identifier": "NBA", "project_lead": str(self.player.id)}, format="json"
        )
        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("project_lead", response.data)
        self.assertFalse(Project.objects.filter(identifier="NBA").exists())
        self.assertFalse(ProjectMember.objects.filter(member=self.player).exists())
        self.membership.refresh_from_db()
        self.assertEqual(self.membership.role, 1)

    def test_update_rejects_workspace_user_even_with_elevated_project_role(self):
        ProjectMember.objects.create(project=self.project, member=self.player, role=20)
        response = self.client.patch(
            f"{self.url}{self.project.id}/", {"project_lead": str(self.player.id)}, format="json"
        )
        self.assertEqual(response.status_code, 400, response.data)
        self.project.refresh_from_db()
        self.assertIsNone(self.project.project_lead_id)

    def test_update_rejects_project_user_even_with_workspace_member_role(self):
        self.membership.role = 15
        self.membership.save()
        ProjectMember.objects.create(project=self.project, member=self.player, role=1)
        response = self.client.patch(
            f"{self.url}{self.project.id}/", {"project_lead": str(self.player.id)}, format="json"
        )
        self.assertEqual(response.status_code, 400, response.data)
        self.project.refresh_from_db()
        self.assertIsNone(self.project.project_lead_id)

    def test_existing_non_user_workspace_roles_remain_eligible(self):
        for role in (5, 15, 20):
            with self.subTest(role=role):
                self.membership.role = role
                self.membership.save()
                response = self.client.post(
                    self.url,
                    {"name": f"Program {role}", "identifier": f"P{role}", "project_lead": str(self.player.id)},
                    format="json",
                )
                self.assertEqual(response.status_code, 201, response.data)

    def test_nonmember_and_inactive_member_cannot_be_lead(self):
        self.membership.role = 15
        self.membership.is_active = False
        self.membership.save()
        outsider = User.objects.create(email="outsider@fixture.test", username="outsider-lead")
        for user in (self.player, outsider):
            with self.subTest(user=user.id):
                response = self.client.patch(
                    f"{self.url}{self.project.id}/", {"project_lead": str(user.id)}, format="json"
                )
                self.assertEqual(response.status_code, 400, response.data)

    def test_clearing_lead_is_allowed(self):
        self.project.project_lead = self.coach
        self.project.save()
        response = self.client.patch(f"{self.url}{self.project.id}/", {"project_lead": None}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.project.refresh_from_db()
        self.assertIsNone(self.project.project_lead_id)
