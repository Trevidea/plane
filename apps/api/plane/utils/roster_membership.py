"""Link explicitly imported roster emails through existing workspace invitations."""

from uuid import uuid4

from django.db import transaction
from django.db.models import Exists, OuterRef
from rest_framework.exceptions import ValidationError

from plane.bgtasks.workspace_invitation_task import workspace_invitation
from plane.db.models import Project, RosterPlayer, Workspace, WorkspaceMember, WorkspaceMemberInvite
from plane.utils.exception_logger import log_exception


def roster_with_account_status(queryset):
    pending = WorkspaceMemberInvite.objects.filter(
        workspace_id=OuterRef("workspace_id"),
        email__iexact=OuterRef("email"),
        accepted=False,
        responded_at__isnull=True,
    )
    return queryset.annotate(_has_pending_invitation=Exists(pending))


def link_roster_memberships(user, workspace_ids):
    """Link only after active membership exists, without replacing existing links."""
    if not user.is_active or user.is_bot:
        return
    eligible = WorkspaceMember.objects.filter(member=user, workspace_id__in=workspace_ids, is_active=True).values_list(
        "workspace_id", flat=True
    )
    with transaction.atomic():
        # Lock a stable scope even when the import's first roster row is not
        # committed yet. Imports acquire workspace then project locks too.
        list(Workspace.objects.select_for_update().filter(pk__in=workspace_ids).order_by("id"))
        players = RosterPlayer.objects.filter(
            workspace_id__in=eligible,
            email__iexact=user.email,
            user__isnull=True,
            project__deleted_at__isnull=True,
        )
        # The import path takes the same project lock to serialize account linking.
        projects = list(Project.objects.select_for_update().filter(pk__in=players.values("project_id")).order_by("id"))
        for project in projects:
            if not RosterPlayer.objects.filter(project=project, user=user).exists():
                players.filter(project=project, user__isnull=True).update(user=user)


def attach_imported_roster_member(player, request):
    """Called inside the import transaction, after all rows have been validated."""
    if not player.email:
        return
    membership = (
        WorkspaceMember.objects.filter(
            workspace_id=player.workspace_id,
            member__email__iexact=player.email,
            member__is_active=True,
            member__is_bot=False,
            is_active=True,
        )
        .select_related("member")
        .first()
    )
    if membership:
        if player.user_id and player.user_id != membership.member_id:
            raise ValidationError({"players": ["The email does not match the selected member account."]})
        if (
            RosterPlayer.objects.filter(project_id=player.project_id, user_id=membership.member_id)
            .exclude(pk=player.pk)
            .exists()
        ):
            raise ValidationError({"players": ["This member is already linked to a player in this program."]})
        player.user = membership.member
        player.save(update_fields=["user"])
        return

    invitation = WorkspaceMemberInvite.objects.filter(
        workspace_id=player.workspace_id, email__iexact=player.email
    ).first()
    created = False
    if invitation is None:
        invitation, created = WorkspaceMemberInvite.objects.get_or_create(
            workspace_id=player.workspace_id,
            email=player.email,
            defaults={"role": 1, "token": uuid4().hex, "created_by": request.user},
        )
    if not created:
        if invitation.responded_at and not invitation.accepted:
            raise ValidationError({"players": ["This invitation was declined. Resend it from workspace settings."]})
        return

    from plane.utils.host import base_host

    origin = base_host(request=request, is_app=True)

    def enqueue():
        try:
            workspace_invitation.delay(
                invitation.email, invitation.workspace_id, invitation.token, origin, request.user.email
            )
        except Exception as error:
            # The invite remains available in workspace settings for resending.
            log_exception(error)

    transaction.on_commit(enqueue)
