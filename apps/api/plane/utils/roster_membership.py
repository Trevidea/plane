"""Link explicitly imported roster emails through existing workspace invitations."""

from uuid import uuid4

from django.db import transaction
from django.db.models import Exists, OuterRef, Subquery
from rest_framework.exceptions import ValidationError

from plane.db.models import (
    Project,
    ProjectMember,
    RosterPlayer,
    Workspace,
    WorkspaceMember,
    WorkspaceMemberInvite,
    PlayerRegistrationRequest,
)
from plane.utils.roster_invitation_delivery import queue_roster_invitation


def pending_player_invitations(workspace_id, email):
    return WorkspaceMemberInvite.objects.filter(
        workspace_id=workspace_id, email__iexact=email, role=1, accepted=False, responded_at__isnull=True
    )


def roster_with_account_status(queryset):
    pending = WorkspaceMemberInvite.objects.filter(
        workspace_id=OuterRef("workspace_id"),
        email__iexact=OuterRef("email"),
        accepted=False,
        responded_at__isnull=True,
    )
    approvals = PlayerRegistrationRequest.objects.filter(roster_player_id=OuterRef("pk"), approved_at__isnull=True)
    memberships = ProjectMember.all_objects.filter(project_id=OuterRef("project_id"), member_id=OuterRef("user_id"))
    player_invites = pending_player_invitations(OuterRef("workspace_id"), OuterRef("email"))
    return queryset.select_related("user__avatar_asset", "registration_request__user").annotate(
        _has_pending_invitation=Exists(pending),
        _registration_pending=Exists(approvals),
        _program_membership_exists=Exists(memberships),
        _player_invitation_exists=Exists(player_invites),
        _invitation_delivery_state=Subquery(player_invites.values("roster_delivery__state")[:1]),
        _invitation_delivery_changed_at=Subquery(player_invites.values("roster_delivery__changed_at")[:1]),
    )


def link_roster_memberships(user, workspace_ids):
    """Restore approved links only; workspace invitation acceptance is not program approval."""
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
            account_link_held=False,
            project__deleted_at__isnull=True,
            registration_request__user=user,
            registration_request__approved_at__isnull=False,
            registration_request__deleted_at__isnull=True,
        )
        # The import path takes the same project lock to serialize account linking.
        projects = list(Project.objects.select_for_update().filter(pk__in=players.values("project_id")).order_by("id"))
        for project in projects:
            if not RosterPlayer.objects.filter(project=project, user=user).exists():
                players.filter(project=project, user__isnull=True).update(user=user)


def attach_imported_roster_member(player, request):
    """Called inside the import transaction, after all rows have been validated."""
    if (
        not player.email
        or player.status not in ("active", "injured")
        or PlayerRegistrationRequest.objects.filter(roster_player=player, approved_at__isnull=True).exists()
    ):
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
        # Matching email identifies an account, but must not grant program access.
        # The authenticated team join records a request; approval links the account
        # and creates its program membership together.
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

    queue_roster_invitation(invitation, request.user.pk)
