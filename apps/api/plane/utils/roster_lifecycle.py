"""Participation changes preserve roster identity and published history."""

from copy import deepcopy
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from plane.db.models import (
    RosterPlayer,
    RosterEvent,
    Workspace,
    Project,
    User,
    WorkspaceMember,
    ProjectMember,
    Issue,
    PlayerRegistrationRequest,
    Session,
    FileAsset,
    IssueComment,
)


def event(player, actor, action, previous_status=None):
    return RosterEvent.objects.create(
        project=player.project,
        roster_player=player,
        roster_identity=player.id,
        player_name=player.player_name,
        jersey_number=player.jersey_number,
        action=action,
        previous_status=previous_status or player.status,
        status=player.status,
        actor=actor,
    )


def referenced(player):
    # Jersey-tagged legacy events have no stable FK. Retain these conservatively.
    return (
        bool(player.first_tagged_at or player.jersey_number)
        or RosterEvent.objects.filter(roster_identity=player.id)
        .exclude(Q(jersey_number__isnull=True) | Q(jersey_number=""))
        .exists()
        or Issue.all_objects.filter(
            Q(roster_player=player)
            | Q(coaching_card_data__recipient_ids__contains=[str(player.id)])
            | Q(coaching_card_data__player__id=str(player.id))
            | Q(description__icontains=str(player.id))
        ).exists()
    )


@transaction.atomic
def remove_player(player, actor):
    Workspace.objects.select_for_update().get(pk=player.workspace_id)
    Project.objects.select_for_update().get(pk=player.project_id)
    player = RosterPlayer.objects.select_for_update().get(pk=player.id)
    if player.status == "removed":
        return player
    keep = referenced(player)
    previous = player.status
    player.status = "removed"
    event(player, actor, "removed", previous)
    player.jersey_number = None
    if player.user_id:
        ProjectMember.objects.filter(project_id=player.project_id, member_id=player.user_id, role=1).update(
            is_active=False
        )
    player.save(update_fields=["status", "jersey_number", "updated_at"])
    PlayerRegistrationRequest.objects.filter(roster_player=player, approved_at__isnull=True).update(
        deleted_at=timezone.now()
    )
    if not keep:
        # Hard delete only a proven unused identity; the event snapshot remains.
        RosterPlayer.all_objects.filter(pk=player.pk).delete()
    return player


@transaction.atomic
def delete_athlete_account(player, actor):
    from plane.license.models import InstanceAdmin

    Workspace.objects.select_for_update().get(pk=player.workspace_id)
    if not WorkspaceMember.objects.filter(
        workspace_id=player.workspace_id, member=actor, role=20, is_active=True
    ).exists():
        from rest_framework.exceptions import PermissionDenied

        raise PermissionDenied("Only workspace Admins can delete accounts.")
    expected_user_id = player.user_id
    Project.objects.select_for_update().get(pk=player.project_id, workspace_id=player.workspace_id)
    current = (
        RosterPlayer.objects.select_for_update()
        .filter(pk=player.id, project_id=player.project_id, workspace_id=player.workspace_id)
        .first()
    )
    if current is None or current.user_id is None or current.user_id != expected_user_id:
        raise ValidationError("The roster account link changed. Refresh before deleting the account.")
    player = current
    user = User.objects.select_for_update().get(pk=player.user_id)
    if (
        user.pk == actor.pk
        or user.is_staff
        or user.is_superuser
        or user.is_bot
        or Workspace.objects.filter(owner=user).exists()
        or InstanceAdmin.objects.filter(user=user).exists()
        or WorkspaceMember.objects.filter(member=user, role__gte=15).exists()
        or ProjectMember.objects.filter(member=user, role__gte=15).exists()
    ):
        raise ValidationError("Staff and administrator accounts cannot be deleted from a roster.")
    players = list(RosterPlayer.all_objects.select_for_update().filter(user=user))
    identities = {str(p.id) for p in players}
    for card in Issue.all_objects.filter(category="Coaching Card"):
        data = deepcopy(card.coaching_card_data or {})
        recipients = set(data.get("recipient_ids") or ([str(card.roster_player_id)] if card.roster_player_id else []))
        affected = recipients & identities
        if not affected:
            continue
        remaining = recipients - identities
        if not remaining:
            # Avoid deleting descendants belonging to other athletes.
            Issue.all_objects.filter(parent=card).update(parent=None)
            Issue.all_objects.filter(pk=card.pk).delete()
        else:
            data["recipient_ids"] = [r for r in data.get("recipient_ids", []) if r not in identities]
            data["recipients"] = [r for r in data.get("recipients", []) if str(r.get("id")) not in identities]
            if str((data.get("player") or {}).get("id")) in identities:
                data["player"] = None
            for key in ["viewed_by"]:
                if isinstance(data.get("review", {}).get(key), dict):
                    data["review"][key] = {k: v for k, v in data["review"][key].items() if k not in identities}
            card.coaching_card_data = data
            if str(card.roster_player_id) in identities:
                card.roster_player = None
            card.save(update_fields=["coaching_card_data", "roster_player", "updated_at"])
    for p in players:
        old = p.status
        p.player_name = "Former player"
        p.email = ""
        p.user = None
        p.status = "removed"
        p.notes = None
        p.height = None
        p.weight = None
        p.class_year = None
        event(p, actor, "account_deleted", old)
        p.jersey_number = None
        p.save()
    RosterEvent.objects.filter(roster_identity__in=[p.id for p in players]).update(player_name="Former player")
    # Personal photos use the existing asset deletion lifecycle. Shared film is retained.
    FileAsset.objects.filter(
        Q(pk__in=[user.avatar_asset_id, user.cover_image_asset_id])
        | Q(user=user, entity_type__in=["USER_AVATAR", "USER_COVER"])
    ).update(is_deleted=True, deleted_at=timezone.now(), user=None)
    # File rows for shared team content must survive deletion of their uploader.
    FileAsset.all_objects.filter(user=user).update(user=None)
    Session.objects.filter(user_id=str(user.id)).delete()
    IssueComment.all_objects.filter(actor=user).update(actor=None)
    user.delete()
