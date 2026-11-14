from django.test import TestCase
from rest_framework.test import APIClient

from plane.db.models import Page, Project, ProjectPage, RosterPlayer, User, Workspace, WorkspaceMember


class UserPlanePageTests(TestCase):
    def setUp(self):
        self.user = User.objects.create(email="readonly-page@fixture.test", username="readonly-page")
        self.coach = User.objects.create(email="page-coach@fixture.test", username="page-coach")
        self.workspace = Workspace.objects.create(name="School", slug="readonly-pages", owner=self.coach)
        WorkspaceMember.objects.create(workspace=self.workspace, member=self.user, role=1)
        self.program = Project.objects.create(workspace=self.workspace, name="Assigned", identifier="ASG")
        self.hidden = Project.objects.create(workspace=self.workspace, name="Hidden", identifier="HID")
        RosterPlayer.objects.create(project=self.program, user=self.user, player_name="Player")
        self.shared = self.page("Shared", self.coach, 0)
        self.private = self.page("Coach private", self.coach, 1)
        self.own = self.page("Own private", self.user, 1)
        self.other = self.page("Other program", self.coach, 0, self.hidden)
        ProjectPage.objects.create(project=self.hidden, page=self.shared, workspace=self.workspace)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.base = f"/api/workspaces/{self.workspace.slug}/projects/{self.program.id}/pages/"

    def page(self, name, owner, access, program=None):
        page = Page.objects.create(workspace=self.workspace, name=name, owned_by=owner, access=access)
        ProjectPage.objects.create(project=program or self.program, page=page, workspace=self.workspace)
        return page

    def test_roster_only_user_reads_shared_and_own_pages_without_other_associations(self):
        response = self.client.get(self.base)
        self.assertEqual(response.status_code, 200, response.data)
        rows = response.data if isinstance(response.data, list) else response.data.get("results", [])
        self.assertEqual({str(row["id"]) for row in rows}, {str(self.shared.id), str(self.own.id)})
        self.assertNotIn(str(self.hidden.id), str(response.data))
        self.assertEqual(self.client.get(f"{self.base}{self.shared.id}/").status_code, 200)
        self.assertIn(self.client.get(f"{self.base}{self.private.id}/").status_code, (403, 404))
        self.assertIn(self.client.get(f"{self.base}{self.other.id}/").status_code, (403, 404))

    def test_page_ownership_does_not_allow_shared_mutations(self):
        for method, suffix, body in (
            ("patch", "", {"name": "Changed"}),
            ("delete", "", {}),
            ("post", "lock/", {}),
            ("post", "access/", {"access": 0}),
        ):
            with self.subTest(method=method, suffix=suffix):
                response = getattr(self.client, method)(f"{self.base}{self.own.id}/{suffix}", body, format="json")
                self.assertEqual(response.status_code, 403, response.data)
        self.own.refresh_from_db()
        self.assertEqual(self.own.name, "Own private")
        self.assertEqual(self.own.access, 1)
