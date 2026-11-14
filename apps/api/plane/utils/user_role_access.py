"""Explicit shared read access and scoped personal actions for User accounts."""

from django.core.exceptions import ValidationError
from django.db.models import F, Q
from rest_framework.permissions import SAFE_METHODS
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
    # A program User role restricts that program, not the whole workspace.
    if slug and not project_id and not view.kwargs.get("project_identifier"):
        return workspace_roles.exists()
    return workspace_roles.exists() or project_roles.exists()


def user_readonly_projects(user, slug=None):
    """Eligible programs from authoritative membership and explicit roster links."""
    from plane.db.models import Project, ProjectMember, RosterPlayer, WorkspaceMember

    if not user or not user.is_authenticated or not user.is_active or user.is_bot:
        return Project.objects.using("default").none()
    workspaces = WorkspaceMember.objects.using("default").filter(member=user, is_active=True).values("workspace_id")
    joined = (
        ProjectMember.objects.using("default")
        .filter(member=user, is_active=True, workspace_id__in=workspaces)
        .values("project_id")
    )
    roster = (
        RosterPlayer.objects.using("default")
        .filter(
            user=user,
            status__in=["active", "injured"],
            workspace_id__in=workspaces,
            workspace_id=F("project__workspace_id"),
        )
        .values("project_id")
    )
    projects = Project.objects.using("default").filter(
        Q(pk__in=joined) | Q(pk__in=roster),
        workspace_id__in=workspaces,
        archived_at__isnull=True,
        workspace__deleted_at__isnull=True,
    )
    return projects.filter(workspace__slug=slug) if slug else projects


def readonly_user_access_allowed(request, view):
    """Approve only deliberately opted-in app reads in a current eligible scope."""
    if request.method not in SAFE_METHODS or not getattr(view, "user_role_readonly", False):
        return False
    return _user_plane_scope_allowed(request, view)


def personal_view_preferences_allowed(request, view):
    """Allow an opted-in endpoint to save only the caller's display preferences."""
    return (
        request.method == "PATCH"
        and getattr(view, "user_role_personal_preferences", False)
        and _user_plane_scope_allowed(request, view)
    )


def _user_plane_scope_allowed(request, view):
    if not view.__class__.__module__.startswith("plane.app.") or not has_user_role(request, view):
        return False
    if getattr(request, "path", "").startswith("/api/v1/"):
        return False
    actions = getattr(view, "user_role_readonly_actions", None)
    if actions is not None and getattr(view, "action", None) not in actions:
        return False
    user = request.user
    if not user.is_active or user.is_bot:
        return False
    from plane.db.models import Issue, WorkspaceMember

    kwargs = view.kwargs
    slug = kwargs.get("slug")
    project_id = kwargs.get("project_id")
    model_name = getattr(getattr(view, "model", None), "__name__", None)
    if not project_id and model_name == "Project":
        project_id = kwargs.get("pk")
    identifier = kwargs.get("project_identifier")
    if (
        slug
        and not WorkspaceMember.objects.using("default")
        .filter(member=user, workspace__slug=slug, workspace__deleted_at__isnull=True, is_active=True)
        .exists()
    ):
        return False
    if not slug and not project_id and not identifier:
        return bool(getattr(view, "user_role_readonly_global", False))
    try:
        if project_id or identifier:
            programs = user_readonly_projects(user, slug)
            if project_id:
                programs = programs.filter(pk=project_id)
            else:
                programs = programs.filter(identifier__iexact=identifier)
            actual_id = programs.values_list("id", flat=True).first()
            if actual_id is None:
                return False
            issue_id = kwargs.get("issue_id") or kwargs.get("card_id")
            if not issue_id and model_name == "Issue":
                issue_id = kwargs.get("pk")
            if (
                issue_id
                and not Issue.issue_objects.using("default")
                .filter(pk=issue_id, project_id=actual_id, archived_at__isnull=True)
                .exists()
            ):
                return False
    except (ValidationError, ValueError, TypeError):
        return False
    return True


def enforce_user_role_access(request, view):
    if not has_user_role(request, view):
        return
    route = getattr(request._request, "resolver_match", None)
    route_name = route.url_name if route else None
    if getattr(view, "user_role_access", False):
        return
    if readonly_user_access_allowed(request, view) or personal_view_preferences_allowed(request, view):
        request.user_readonly_access = True
        view.use_read_replica = False
        from plane.utils.core import set_use_read_replica

        set_use_read_replica(False)
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
        enforce_user_role_access(request, self)
        super().check_permissions(request)

    def finalize_response(self, request, response, *args, **kwargs):
        if getattr(request, "user_readonly_access", False):
            if hasattr(response, "data"):
                from plane.utils.user_plane_read_data import sanitize_user_readonly_response

                response.data = sanitize_user_readonly_response(response.data, request, self)
            response["Cache-Control"] = "private, no-store"
        return super().finalize_response(request, response, *args, **kwargs)
