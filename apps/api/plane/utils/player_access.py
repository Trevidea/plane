from django.db.models import F, Q

from plane.db.models import RosterPlayer, WorkspaceMember


def player_roster_queryset(user):
    """Explicit account linkage, not project visibility, grants player access."""
    if not user.is_authenticated or not user.is_active or user.is_bot:
        return RosterPlayer.objects.none()
    workspaces = WorkspaceMember.objects.filter(member=user, is_active=True).values("workspace_id")
    return (
        RosterPlayer.objects.filter(
            user=user,
            workspace_id__in=workspaces,
            project__workspace_id=F("workspace_id"),
            project__deleted_at__isnull=True,
            project__workspace__deleted_at__isnull=True,
            project__archived_at__isnull=True,
        )
        .filter(status__in=["active", "injured"])
        .select_related("project", "project__workspace")
    )


def player_card_roster_queryset(user):
    """Historical identity grants only own-card access, never shared team content."""
    if not user.is_authenticated or not user.is_active or user.is_bot:
        return RosterPlayer.objects.none()
    workspaces = WorkspaceMember.objects.filter(member=user, is_active=True).values("workspace_id")
    return RosterPlayer.objects.filter(
        Q(status__in=["inactive", "removed"])
        | Q(status__in=["active", "injured"], workspace_id__in=workspaces, project__archived_at__isnull=True),
        user=user,
        project__deleted_at__isnull=True,
        project__workspace__deleted_at__isnull=True,
        workspace_id=F("project__workspace_id"),
    ).select_related("project", "project__workspace")
