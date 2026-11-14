"""Normal-shell reads preserve the User program boundary."""

from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from plane.db.models import Project, ProjectMember, RosterPlayer, User, Workspace, WorkspaceMember


class UserPlaneShellTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create(email="shell-user@fixture.test", username="shell-user")
        cls.coach = User.objects.create(email="shell-coach@fixture.test", username="shell-coach")
        cls.workspace = Workspace.objects.create(name="Shell", slug="shell-fixture", owner=cls.coach)
        WorkspaceMember.objects.create(workspace=cls.workspace, member=cls.user, role=1)
        WorkspaceMember.objects.create(workspace=cls.workspace, member=cls.coach, role=20)
        cls.assigned = Project.objects.create(workspace=cls.workspace, name="Assigned", identifier="ASG")
        cls.linked = Project.objects.create(workspace=cls.workspace, name="Linked", identifier="LNK")
        cls.public = Project.objects.create(workspace=cls.workspace, name="Other public", identifier="PUB", network=2)
        ProjectMember.objects.create(project=cls.assigned, member=cls.user, role=1)
        ProjectMember.objects.create(project=cls.assigned, member=cls.coach, role=20)
        RosterPlayer.objects.create(project=cls.linked, user=cls.user, player_name="Shell User")

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.root = f"/api/workspaces/{self.workspace.slug}"

    def test_program_list_contains_membership_and_roster_only(self):
        response = self.client.get(f"{self.root}/projects/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual({row["id"] for row in response.json()}, {str(self.assigned.id), str(self.linked.id)})
        self.assertTrue(all(row["member_role"] == 1 for row in response.json()))

    @patch("plane.app.views.project.base.recent_visited_task.delay")
    def test_linked_program_detail_and_effective_role_do_not_create_membership(self, visit):
        for suffix in ("", "project-members/me/"):
            response = self.client.get(f"{self.root}/projects/{self.linked.id}/{suffix}")
            self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(ProjectMember.objects.filter(project=self.linked, member=self.user).exists())
        roles = self.client.get(f"/api/users/me/workspaces/{self.workspace.slug}/project-roles/")
        self.assertEqual(roles.status_code, 200)
        self.assertEqual(roles.json(), {str(self.assigned.id): 1, str(self.linked.id): 1})

    def test_public_program_and_shared_writes_stay_denied(self):
        self.assertIn(self.client.get(f"{self.root}/projects/{self.public.id}/").status_code, (403, 404))
        self.assertEqual(
            self.client.patch(f"{self.root}/projects/{self.assigned.id}/", {"name": "Changed"}).status_code, 403
        )
        self.assertEqual(self.client.post(f"{self.root}/projects/", {"name": "Changed"}).status_code, 403)

    def test_member_names_do_not_include_account_email(self):
        response = self.client.get(f"{self.root}/projects/{self.assigned.id}/members/")
        self.assertEqual(response.status_code, 200)
        self.assertNotIn(self.coach.email, response.content.decode())
        self.assertNotIn("last_login_medium", response.content.decode())

    def test_inactive_membership_removes_programs(self):
        WorkspaceMember.objects.filter(workspace=self.workspace, member=self.user).update(is_active=False)
        response = self.client.get(f"{self.root}/projects/")
        self.assertIn(response.status_code, (403, 404))

    def test_roster_only_state_and_label_reads_and_aggregate_scoping(self):
        from plane.db.models import Label, State

        visible_state = State.objects.create(project=self.linked, name="Visible state", group="backlog")
        hidden_state = State.objects.create(project=self.public, name="Hidden state", group="backlog")
        visible_label = Label.objects.create(project=self.linked, name="Visible label")
        hidden_label = Label.objects.create(project=self.public, name="Hidden label")
        for suffix, expected in (("states/", visible_state), ("issue-labels/", visible_label)):
            response = self.client.get(f"{self.root}/projects/{self.linked.id}/{suffix}")
            self.assertEqual(response.status_code, 200, response.content)
            self.assertIn(str(expected.id), response.content.decode())
        for suffix, hidden in (("states/", hidden_state), ("labels/", hidden_label)):
            response = self.client.get(f"{self.root}/{suffix}")
            self.assertEqual(response.status_code, 200, response.content)
            self.assertNotIn(str(hidden.id), response.content.decode())

    def test_project_favorites_never_resolve_private_pages_or_foreign_projects(self):
        from plane.db.models import Page, UserFavorite

        private_page = Page.objects.create(
            workspace=self.workspace, owned_by=self.coach, name="Private favorite title", access=1
        )
        for entity_type, entity_id in (
            ("page", private_page.id),
            ("project", self.public.id),
            ("project", self.assigned.id),
        ):
            UserFavorite.objects.create(
                workspace=self.workspace,
                project=self.assigned,
                user=self.user,
                entity_type=entity_type,
                entity_identifier=entity_id,
            )
        response = self.client.get(f"{self.root}/user-favorite-projects/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertIn(self.assigned.name, response.content.decode())
        self.assertNotIn(private_page.name, response.content.decode())
        self.assertNotIn(self.public.name, response.content.decode())
        self.assertNotIn(str(private_page.id), response.content.decode())
        self.assertNotIn(str(self.public.id), response.content.decode())

    @patch("plane.app.views.view.base.recent_visited_task.delay")
    def test_workspace_user_with_legacy_guest_program_can_read_shared_views(self, visit):
        from plane.db.models import IssueView

        ProjectMember.objects.filter(project=self.assigned, member=self.user).update(role=5)
        shared = IssueView.objects.create(
            project=self.assigned,
            workspace=self.workspace,
            owned_by=self.coach,
            name="Shared program view",
            access=1,
        )
        private = IssueView.objects.create(
            project=self.assigned,
            workspace=self.workspace,
            owned_by=self.coach,
            name="Private program view",
            access=0,
        )
        root = f"{self.root}/projects/{self.assigned.id}/views"
        response = self.client.get(f"{root}/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertIn(shared.name, response.content.decode())
        self.assertNotIn(private.name, response.content.decode())
        self.assertEqual(self.client.get(f"{root}/{shared.id}/").status_code, 200)
        self.assertEqual(self.client.get(f"{root}/{private.id}/").status_code, 404)
        # A real Guest retains the preexisting feature restriction.
        WorkspaceMember.objects.filter(workspace=self.workspace, member=self.user).update(role=5)
        self.assertNotIn(shared.name, self.client.get(f"{root}/").content.decode())
        self.assertEqual(self.client.get(f"{root}/{shared.id}/").status_code, 403)

    def test_user_can_switch_layout_without_editing_shared_content(self):
        from plane.db.models import IssueUserProperty

        for project in (self.assigned, self.linked):
            url = f"{self.root}/projects/{project.id}/user-properties/"
            self.assertEqual(self.client.get(url).status_code, 200)
            coach_preferences, _ = IssueUserProperty.objects.get_or_create(user=self.coach, project=project)
            original_coach_layout = coach_preferences.display_filters.copy()
            for layout in ("kanban", "calendar", "gantt", "spreadsheet", "list"):
                response = self.client.patch(
                    url,
                    {"display_filters": {"layout": layout}, "user": str(self.coach.id)},
                    format="json",
                )
                self.assertEqual(response.status_code, 201, response.content)
                self.assertEqual(self.client.get(url).json()["display_filters"]["layout"], layout)
            coach_preferences.refresh_from_db()
            self.assertEqual(coach_preferences.display_filters, original_coach_layout)
            self.assertEqual(
                self.client.patch(f"{self.root}/projects/{project.id}/", {"name": "Changed"}).status_code, 403
            )
        forbidden = f"{self.root}/projects/{self.public.id}/user-properties/"
        self.assertIn(
            self.client.patch(forbidden, {"display_filters": {"layout": "kanban"}}, format="json").status_code,
            (403, 404),
        )
        WorkspaceMember.objects.filter(workspace=self.workspace, member=self.user).update(is_active=False)
        self.assertEqual(
            self.client.patch(url, {"display_filters": {"layout": "kanban"}}, format="json").status_code, 403
        )
