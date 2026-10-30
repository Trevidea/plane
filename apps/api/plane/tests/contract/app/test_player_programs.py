"""Read-only player program discovery and stage configuration contracts."""

from uuid import uuid4

from django.test import SimpleTestCase, TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from plane.db.models import Project, ProjectMember, RosterPlayer, State, User, Workspace, WorkspaceMember


class PlayerProgramRouteTests(SimpleTestCase):
    def test_routes_exist_and_require_authentication(self):
        client = APIClient()
        for url in (
            "/api/player/programs/",
            f"/api/player/workspaces/school/projects/{uuid4()}/coaching-card-config/",
        ):
            with self.subTest(url=url):
                self.assertIn(client.get(url).status_code, [401, 403])


class PlayerProgramContractTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create(email="player@fixture.test", username="fixture-player")
        cls.other = User.objects.create(email="other@fixture.test", username="fixture-other")
        cls.workspace = Workspace.objects.create(name="Fixture School", slug="fixture-school", owner=cls.other)
        cls.membership = WorkspaceMember.objects.create(workspace=cls.workspace, member=cls.user, role=5)
        cls.project = Project.objects.create(
            workspace=cls.workspace, name="Football", identifier="FB", sport="Football",
            logo_props={"in_use": "emoji", "emoji": {"value": "9200"}},
        )
        cls.player = RosterPlayer.objects.create(
            project=cls.project, user=cls.user, player_name="Fixture Player",
            jersey_number="00", position="OL", class_year="2027",
        )
        cls.stage = State.objects.create(
            project=cls.project, name="Identified", group="backlog", sequence=1, lifecycle_role="identified"
        )

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def programs(self, query=""):
        return self.client.get(f"/api/player/programs/{query}")

    def config(self, project_id=None, slug=None):
        return self.client.get(
            f"/api/player/workspaces/{slug or self.workspace.slug}/projects/"
            f"{project_id or self.project.id}/coaching-card-config/"
        )

    def test_discovery_returns_linked_program_without_a_coach_or_project_role(self):
        self.assertFalse(ProjectMember.objects.filter(project=self.project, member=self.user).exists())
        response = self.programs("?limit=50&offset=0")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "total_count": 1,
                "limit": 50,
                "offset": 0,
                "results": [
                    {
                        "id": str(self.project.id),
                        "name": "Football",
                        "identifier": "FB",
                        "sport": "Football",
                        "logo_props": {"in_use": "emoji", "emoji": {"value": "9200"}},
                        "workspace_slug": "fixture-school",
                        "workspace_name": "Fixture School",
                        "player_id": str(self.player.id),
                        "roster": {
                            "player_name": "Fixture Player",
                            "jersey_number": "00",
                            "position": "OL",
                            "class_year": "2027",
                        },
                    }
                ],
            },
        )
        self.assertIn("no-store", response.headers["Cache-Control"])

    def test_workspace_admin_does_not_discover_unlinked_public_programs_or_another_player(self):
        WorkspaceMember.objects.filter(pk=self.membership.pk).update(role=20)
        public = Project.objects.create(workspace=self.workspace, name="Public", identifier="PUB", network=2)
        ProjectMember.objects.create(project=public, member=self.user, role=20)
        RosterPlayer.objects.create(project=public, user=self.other, player_name="Other Player")
        response = self.programs(f"?user_id={self.other.id}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([p["id"] for p in response.json()["results"]], [str(self.project.id)])

    def test_user_without_roster_link_receives_an_empty_successful_page(self):
        self.client.force_authenticate(self.other)
        response = self.programs()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"total_count": 0, "limit": 50, "offset": 0, "results": []})

    def test_stage_config_requires_the_same_linked_program_and_workspace(self):
        response = self.config()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["initial_stage_id"], str(self.stage.id))
        self.assertEqual(response.json()["stages"][0]["name"], "Identified")
        self.assertEqual(self.config(project_id=uuid4()).status_code, 404)
        self.assertEqual(self.config(slug="other-school").status_code, 404)
        self.client.force_authenticate(self.other)
        self.assertEqual(self.config().status_code, 404)

    def test_inactive_or_pending_players_are_excluded_and_injured_players_remain_eligible(self):
        for roster_status in ("inactive", "pending"):
            with self.subTest(status=roster_status):
                RosterPlayer.objects.filter(pk=self.player.pk).update(status=roster_status)
                response = self.programs()
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["results"], [])
                self.assertEqual(self.config().status_code, 404)
        RosterPlayer.objects.filter(pk=self.player.pk).update(status="injured")
        self.assertEqual(self.programs().json()["total_count"], 1)

    def test_revoked_membership_and_inactive_or_deleted_resources_are_excluded(self):
        cases = [
            (Project.all_objects, self.project.pk, "archived_at", timezone.now()),
            (Project.all_objects, self.project.pk, "deleted_at", timezone.now()),
            (Workspace.all_objects, self.workspace.pk, "deleted_at", timezone.now()),
            (RosterPlayer.all_objects, self.player.pk, "deleted_at", timezone.now()),
            (RosterPlayer.all_objects, self.player.pk, "user_id", None),
            (WorkspaceMember.all_objects, self.membership.pk, "is_active", False),
            (WorkspaceMember.all_objects, self.membership.pk, "deleted_at", timezone.now()),
            (User.objects, self.user.pk, "is_active", False),
            (User.objects, self.user.pk, "is_bot", True),
        ]
        for manager, pk, field, value in cases:
            with self.subTest(model=manager.model.__name__, field=field):
                previous = manager.filter(pk=pk).values_list(field, flat=True).get()
                manager.filter(pk=pk).update(**{field: value})
                response = self.programs()
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["results"], [])
                self.assertEqual(self.config().status_code, 404)
                manager.filter(pk=pk).update(**{field: previous})

    def test_pagination_is_stable_and_rejects_out_of_range_queries(self):
        extra = Project.objects.create(workspace=self.workspace, name="Basketball", identifier="BB", sport="Basketball")
        RosterPlayer.objects.create(project=extra, user=self.user, player_name="Fixture Player")
        first = self.programs("?limit=1&offset=0")
        second = self.programs("?limit=1&offset=1")
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.json()["total_count"], 2)
        self.assertEqual(first.json()["results"][0]["id"], str(extra.id))
        self.assertEqual(second.json()["results"][0]["id"], str(self.project.id))
        for query in ("?limit=0", "?limit=101", "?offset=-1", "?offset=invalid", "?offset=99999999999999999999"):
            self.assertEqual(self.programs(query).status_code, 400)

    def test_programs_and_config_reject_mutations(self):
        self.assertEqual(self.client.post("/api/player/programs/", {}, format="json").status_code, 405)
        url = f"/api/player/workspaces/{self.workspace.slug}/projects/{self.project.id}/coaching-card-config/"
        self.assertEqual(self.client.post(url, {}, format="json").status_code, 405)

    def test_discovery_preserves_missing_optional_roster_details(self):
        RosterPlayer.objects.filter(pk=self.player.pk).update(
            jersey_number=None, position=None, class_year=None
        )
        response = self.programs()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["results"][0]["roster"], {
            "player_name": "Fixture Player", "jersey_number": None,
            "position": None, "class_year": None,
        })
