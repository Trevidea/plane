from time import perf_counter

from django.db import transaction
from django.db.models import Exists, OuterRef, Q

from plane.db.models import ProjectMember, RosterNotice, RosterNoticeKind, RosterPlayer, WorkspaceMember
from plane.utils.diagnostic_logging import current, emit


REGISTRATION_STAFF_ROLES = (15, 20)


def observe_notice_commit(started):
    context = dict(current.get() or {})

    def committed():
        emit(
            "roster.notice.committed",
            service="plane-api",
            duration_ms=(perf_counter() - started) * 1000,
            fields={"roster_timing": "notification-lag.v1"},
            context_override=context,
        )

    transaction.on_commit(committed, robust=True)


def registration_staff(workspace_id, project_id):
    """The same two active memberships required to approve a registration."""
    workspace_staff = WorkspaceMember.objects.filter(
        workspace_id=workspace_id, role__in=REGISTRATION_STAFF_ROLES, is_active=True
    ).values("member_id")
    return ProjectMember.objects.filter(
        project_id=project_id,
        role__in=REGISTRATION_STAFF_ROLES,
        is_active=True,
        member_id__in=workspace_staff,
        member__is_active=True,
        member__is_bot=False,
    )


def notify_join_requested(player, claimant_id, event_id):
    started = perf_counter()
    recipients = (
        registration_staff(player.workspace_id, player.project_id)
        .exclude(member_id=claimant_id)
        .values_list("member_id", flat=True)
    )
    notices = [
        RosterNotice(
            receiver_id=recipient,
            project_id=player.project_id,
            kind=RosterNoticeKind.JOIN_REQUESTED,
            event_id=event_id,
            roster_identity=player.pk,
        )
        for recipient in recipients
    ]
    if notices:
        RosterNotice.objects.bulk_create(notices, ignore_conflicts=True)
        observe_notice_commit(started)


def notify_player(player, kind, event_id, *, status=""):
    if player.user_id and not player.account_link_held:
        started = perf_counter()
        _, created = RosterNotice.objects.get_or_create(
            receiver_id=player.user_id,
            kind=kind,
            event_id=event_id,
            defaults={"project_id": player.project_id, "roster_identity": player.pk, "status": status},
        )
        if created:
            observe_notice_commit(started)


def notices_for(user, *, staff_workspace=None):
    rows = RosterNotice.objects.filter(
        receiver=user, project__deleted_at__isnull=True, project__workspace__deleted_at__isnull=True
    )
    if staff_workspace is not None:
        return rows.filter(
            Exists(registration_staff(OuterRef("project__workspace_id"), OuterRef("project_id")).filter(member=user)),
            project__workspace__slug=staff_workspace,
            project__archived_at__isnull=True,
            kind=RosterNoticeKind.JOIN_REQUESTED,
        )
    has_workspace = Exists(
        WorkspaceMember.objects.filter(workspace_id=OuterRef("project__workspace_id"), member=user, is_active=True)
    )
    same_player = Exists(
        RosterPlayer.objects.filter(
            pk=OuterRef("roster_identity"), project_id=OuterRef("project_id"), user=user, account_link_held=False
        )
    )
    # Removing an unused roster row may delete it; its former owner can still see the removal notice.
    return rows.exclude(kind=RosterNoticeKind.JOIN_REQUESTED).filter(
        has_workspace, same_player | Q(kind=RosterNoticeKind.STATUS_CHANGED, status="removed")
    )
