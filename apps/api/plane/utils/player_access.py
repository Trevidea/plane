from django.db.models import F

from plane.db.models import RosterPlayer, WorkspaceMember


def player_roster_queryset(user):
    """Explicit account linkage, not project visibility, grants player access."""
    if not user.is_authenticated or not user.is_active:
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
        .exclude(status__in=["inactive", "pending"])
        .select_related("project", "project__workspace")
    )
