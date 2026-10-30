"""Fail closed for player Users on general-purpose workspace/project APIs."""

from rest_framework.exceptions import PermissionDenied

USER_ROLE = 1

# Only personal bootstrap/account/invitation routes; never aggregate issue data.
SELF_ROUTES = {
    "users",
    "user-session",
    "accounts",
    "user-onboard",
    "user-tour",
    "user-workspace",
    "user-workspace-invitations",
    "workspace-join",
    "project-join",
    "user-project-invitations",
}


def has_user_role(request, view):
    from plane.db.models import ProjectMember, WorkspaceMember

    user = request.user
    if not user or not user.is_authenticated:
        return False
    slug = view.kwargs.get("slug")
    project_id = view.kwargs.get("project_id")
    if not project_id and getattr(getattr(view, "model", None), "__name__", None) == "Project":
        # Project ViewSets identify the project with pk rather than project_id.
        project_id = view.kwargs.get("pk")
    workspace_roles = WorkspaceMember.objects.using("default").filter(member=user, role=USER_ROLE)
    project_roles = ProjectMember.objects.using("default").filter(member=user, role=USER_ROLE)
    if slug:
        workspace_roles = workspace_roles.filter(workspace__slug=slug)
        project_roles = project_roles.filter(workspace__slug=slug)
    if project_id:
        project_roles = project_roles.filter(project_id=project_id)
    elif view.kwargs.get("project_identifier"):
        project_roles = project_roles.filter(project__identifier__iexact=view.kwargs["project_identifier"])
    return workspace_roles.exists() or project_roles.exists()


def enforce_user_role_access(request, view):
    if not has_user_role(request, view):
        return
    route = getattr(request._request, "resolver_match", None)
    route_name = route.url_name if route else None
    if getattr(view, "user_role_access", False):
        return
    # API keys must not use app-route names as an escape hatch.
    if view.__class__.__module__.startswith("plane.app.") and route_name in SELF_ROUTES:
        if route_name in {"workspace-join", "project-join"}:
            from plane.db.models import WorkspaceMemberInvite, ProjectMemberInvite
            from rest_framework.exceptions import NotFound

            model = WorkspaceMemberInvite if route_name == "workspace-join" else ProjectMemberInvite
            invites = model.objects.filter(
                pk=view.kwargs.get("pk"), email__iexact=request.user.email, workspace__slug=view.kwargs.get("slug")
            )
            if route_name == "project-join":
                invites = invites.filter(project_id=view.kwargs.get("project_id"))
            if not invites.exists():
                raise NotFound("Invitation not found.")
        return
    raise PermissionDenied("User accounts can access only their assigned activities and personal feedback.")


class UserRoleAccessMixin:
    def check_permissions(self, request):
        super().check_permissions(request)
        enforce_user_role_access(request, self)
