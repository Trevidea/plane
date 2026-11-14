"""The normal User interface has explicit, primary-data scoped read access."""

from types import SimpleNamespace

from django.test import TestCase
from rest_framework.exceptions import PermissionDenied

from plane.db.models import Issue, Project, ProjectMember, RosterPlayer, User, Workspace, WorkspaceMember
from plane.utils.user_role_access import (
    enforce_user_role_access,
    has_user_role,
    readonly_user_access_allowed,
    user_readonly_projects,
)


class ReadonlyView:
    __module__ = "plane.app.views.readonly_test"
    user_role_readonly = True
    action = "list"

    def __init__(self, **kwargs):
        self.kwargs = kwargs


class UserPlaneAccessTests(TestCase):
    def setUp(self):
        self.user = User.objects.create(email="readonly@fixture.test", username="readonly")
        self.workspace = Workspace.objects.create(name="School", slug="readonly-school", owner=self.user)
        self.workspace_member = WorkspaceMember.objects.create(workspace=self.workspace, member=self.user, role=1)
        self.member_program = Project.objects.create(workspace=self.workspace, name="Member", identifier="MEM")
        self.roster_program = Project.objects.create(workspace=self.workspace, name="Roster", identifier="ROS")
        self.hidden_program = Project.objects.create(
            workspace=self.workspace, name="Hidden", identifier="HID", network=2
        )
        self.project_member = ProjectMember.objects.create(project=self.member_program, member=self.user, role=20)
        self.player = RosterPlayer.objects.create(project=self.roster_program, user=self.user, player_name="Player")

    def request(self, method="GET", path="/api/workspaces/readonly-school/"):
        return SimpleNamespace(user=self.user, method=method, path=path, _request=SimpleNamespace(resolver_match=None))

    def view(self, project=None):
        return ReadonlyView(slug=self.workspace.slug, **({"project_id": project.id} if project else {}))

    def test_program_scope_is_membership_or_roster_not_public_visibility(self):
        self.assertEqual(
            set(user_readonly_projects(self.user).values_list("id", flat=True)),
            {self.member_program.id, self.roster_program.id},
        )
        self.assertTrue(readonly_user_access_allowed(self.request(), self.view(self.roster_program)))
        self.assertFalse(readonly_user_access_allowed(self.request(), self.view(self.hidden_program)))

    def test_only_explicit_app_reads_are_allowed(self):
        view = self.view(self.member_program)
        self.assertTrue(readonly_user_access_allowed(self.request(), view))
        for method in ("POST", "PUT", "PATCH", "DELETE"):
            with self.subTest(method=method), self.assertRaises(PermissionDenied):
                enforce_user_role_access(self.request(method), view)
        view.user_role_readonly = False
        with self.assertRaises(PermissionDenied):
            enforce_user_role_access(self.request(), view)

    def test_child_issue_must_belong_to_requested_program(self):
        issue = Issue.objects.create(project=self.hidden_program, name="Other program")
        view = self.view(self.member_program)
        view.kwargs["issue_id"] = issue.id
        self.assertFalse(readonly_user_access_allowed(self.request(), view))

    def test_membership_revocation_is_checked_against_primary_data(self):
        self.assertTrue(readonly_user_access_allowed(self.request(), self.view(self.member_program)))
        self.project_member.is_active = False
        self.project_member.save()
        self.assertFalse(readonly_user_access_allowed(self.request(), self.view(self.member_program)))
        self.workspace_member.is_active = False
        self.workspace_member.save()
        self.assertFalse(readonly_user_access_allowed(self.request(), self.view(self.roster_program)))

    def test_program_user_does_not_restrict_normal_workspace_or_other_program(self):
        self.workspace_member.role = 15
        self.workspace_member.save()
        self.project_member.role = 1
        self.project_member.save()
        ProjectMember.objects.create(project=self.hidden_program, member=self.user, role=15)
        self.assertFalse(has_user_role(self.request(), self.view()))
        self.assertTrue(has_user_role(self.request(), self.view(self.member_program)))
        self.assertFalse(has_user_role(self.request(), self.view(self.hidden_program)))

    def test_api_key_routes_cannot_reuse_app_read_opt_in(self):
        self.assertFalse(
            readonly_user_access_allowed(self.request(path="/api/v1/workspaces/readonly-school/"), self.view())
        )
