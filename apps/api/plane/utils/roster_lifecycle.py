"""Participation changes preserve roster identity and published history."""

from copy import deepcopy
import json
from django.conf import settings
from django.core import signing
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.crypto import constant_time_compare, salted_hmac
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError
from plane.db.models import (
    CoachingCardPrivateAttachment,
    CoachingCardPrivateMessage,
    RosterPlayer,
    RosterEvent,
    RosterNotice,
    RosterNoticeKind,
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
    PlayerActivityProgress,
)
from plane.utils.roster_notices import notify_player
from plane.utils.team_seasons import close_jersey_assignments


def event(player, actor, action, previous_status=None):
    log = RosterEvent.objects.create(
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
    if action in ("status_changed", "removed") and previous_status != player.status:
        notify_player(player, RosterNoticeKind.STATUS_CHANGED, log.pk, status=player.status)
    return log


def referenced(player):
    # Jersey-tagged legacy events have no stable FK. Retain these conservatively.
    return (
        bool(player.first_tagged_at or player.jersey_number or player.account_link_held)
        or player.jersey_assignments.exists()
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
    close_jersey_assignments([player.id])
    PlayerRegistrationRequest.objects.filter(
        roster_player=player, approved_at__isnull=True, roster_player__account_link_held=False
    ).update(deleted_at=timezone.now())
    if not keep:
        # Hard delete only a proven unused identity; the event snapshot remains.
        RosterPlayer.all_objects.filter(pk=player.pk).delete()
    return player


class DeletionPreviewChanged(APIException):
    status_code = 409
    default_detail = "The deletion preview changed or expired. Refresh it before confirming."


def _deletion_subject(player, actor, *, lock=False):
    from plane.license.models import InstanceAdmin

    if lock:
        Workspace.objects.select_for_update().get(pk=player.workspace_id)
    if (
        not WorkspaceMember.objects.filter(
            workspace_id=player.workspace_id, member=actor, role=20, is_active=True
        ).exists()
        or not actor.is_active
        or actor.is_bot
    ):
        raise PermissionDenied("Only workspace Admins can delete accounts.")
    expected_user_id = player.user_id
    if lock:
        roster_projects = RosterPlayer.all_objects.filter(user_id=expected_user_id, workspace_id=player.workspace_id)
        projects = Project.all_objects.filter(workspace_id=player.workspace_id).filter(
            Q(pk=player.project_id) | Q(pk__in=roster_projects.values("project_id"))
        )
        list(projects.select_for_update().order_by("pk").values_list("pk", flat=True))
    roster_query = RosterPlayer.objects.select_for_update() if lock else RosterPlayer.objects
    current = roster_query.filter(pk=player.id, project_id=player.project_id, workspace_id=player.workspace_id).first()
    if current is None or current.user_id is None or current.user_id != expected_user_id:
        raise ValidationError("The roster account link changed. Refresh before deleting the account.")
    player = current
    users = User.objects.select_for_update() if lock else User.objects
    user = users.get(pk=player.user_id)
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
    # A workspace admin must not perform installation-wide deletion when the account has
    # current or historical links elsewhere. Check on the write database under the user lock.
    workspace_id = player.workspace_id
    scoped_links = (
        WorkspaceMember.all_objects.filter(member=user),
        ProjectMember.all_objects.filter(member=user),
        RosterPlayer.all_objects.filter(user=user),
        PlayerRegistrationRequest.all_objects.filter(user=user),
        PlayerActivityProgress.all_objects.filter(user=user),
        IssueComment.all_objects.filter(actor=user),
        FileAsset.all_objects.filter(Q(user=user) | Q(pk__in=[user.avatar_asset_id, user.cover_image_asset_id])),
    )
    private_participant = Q(actor=user) | Q(coach=user) | Q(recipient=user)
    if (
        any(
            rows.filter(workspace_id__isnull=False).exclude(workspace_id=workspace_id).exists() for rows in scoped_links
        )
        or FileAsset.all_objects.filter(user=user, project__isnull=False)
        .exclude(project__workspace_id=workspace_id)
        .exists()
        or CoachingCardPrivateMessage.objects.filter(private_participant)
        .exclude(issue__workspace_id=workspace_id)
        .exists()
        or CoachingCardPrivateAttachment.objects.filter(private_participant)
        .exclude(issue__workspace_id=workspace_id)
        .exists()
    ):
        raise PermissionDenied(
            "This account has records outside this workspace. Contact an installation administrator."
        )

    return player, user


def _deletion_plan(player, user, actor, *, lock=False):
    workspace_id = player.workspace_id
    roster = RosterPlayer.all_objects.filter(user=user, workspace_id=workspace_id).order_by("pk")
    players = list(roster.select_for_update() if lock else roster)
    identities = {str(p.id) for p in players}
    cards = Issue.all_objects.filter(category="Coaching Card", workspace_id=workspace_id)
    refs = Q(roster_player_id__in=identities)
    for identity in sorted(identities):
        refs |= Q(coaching_card_data__recipient_ids__contains=[identity])
    cards = cards.filter(refs).order_by("pk")
    if lock:
        cards = cards.select_for_update()
    card_plan = []
    for card in cards:
        data = card.coaching_card_data or {}
        recipients = {str(candidate) for candidate in data.get("recipient_ids", []) or []}
        if not recipients and card.roster_player_id:
            recipients = {str(card.roster_player_id)}
        if recipients & identities:
            card_plan.append((card, recipients - identities))

    personal_photos = FileAsset.objects.filter(
        Q(pk__in=[user.avatar_asset_id, user.cover_image_asset_id])
        | Q(user=user, entity_type__in=["USER_AVATAR", "USER_COVER"])
    )
    participant = Q(actor=user) | Q(coach=user) | Q(recipient=user)

    def ids(rows):
        return [str(pk) for pk in rows.order_by("pk").values_list("pk", flat=True)]

    records = {
        "workspace_memberships": ids(WorkspaceMember.all_objects.filter(member=user, workspace_id=workspace_id)),
        "program_memberships": ids(ProjectMember.all_objects.filter(member=user, workspace_id=workspace_id)),
        "roster_entries": sorted(identities),
        "personal_cards": [str(card.pk) for card, others in card_plan if not others],
        "shared_cards": [(str(card.pk), sorted(others)) for card, others in card_plan if others],
        "profile_images": ids(personal_photos),
        "private_messages": ids(
            CoachingCardPrivateMessage.objects.filter(participant, issue__workspace_id=workspace_id)
        ),
        "private_attachments": ids(
            CoachingCardPrivateAttachment.objects.filter(participant, issue__workspace_id=workspace_id)
        ),
        "activity_progress": ids(PlayerActivityProgress.all_objects.filter(user=user, workspace_id=workspace_id)),
        "join_records": ids(PlayerRegistrationRequest.all_objects.filter(user=user, workspace_id=workspace_id)),
        "roster_notices": ids(RosterNotice.objects.filter(receiver=user)),
    }
    legacy_image = bool(user.avatar and not user.avatar_asset_id) or bool(
        user.cover_image and not user.cover_image_asset_id
    )
    fingerprint = salted_hmac(
        "roster-account-deletion",
        json.dumps(
            {
                "scope": [str(value) for value in (workspace_id, player.project_id, player.pk, user.pk, actor.pk)],
                "records": records,
                "legacy_image": legacy_image,
            },
            sort_keys=True,
        ),
        algorithm="sha256",
    ).hexdigest()
    impact = {key: len(value) for key, value in records.items()}
    impact["legacy_profile_image"] = legacy_image
    return players, card_plan, personal_photos, impact, fingerprint


DELETION_PREVIEW_SALT = "plane.roster.account-deletion.v1"
DELETION_PREVIEW_SECONDS = 600


def preview_athlete_account_deletion(player, actor):
    player, user = _deletion_subject(player, actor)
    _, _, _, impact, fingerprint = _deletion_plan(player, user, actor)
    enabled = settings.ROSTER_ACCOUNT_DELETION_ENABLED
    return {
        "enabled": enabled,
        "impact": impact,
        "confirmation": signing.dumps(fingerprint, salt=DELETION_PREVIEW_SALT) if enabled else None,
    }


@transaction.atomic
def delete_athlete_account(player, actor, confirmation=None):
    if not settings.ROSTER_ACCOUNT_DELETION_ENABLED:
        raise PermissionDenied(
            "Permanent account deletion is disabled. You can still remove the athlete from this roster."
        )
    player, user = _deletion_subject(player, actor, lock=True)
    if not isinstance(confirmation, str) or not confirmation or len(confirmation) > 512:
        raise ValidationError("Preview this account before confirming deletion.")
    try:
        reviewed = signing.loads(confirmation, salt=DELETION_PREVIEW_SALT, max_age=DELETION_PREVIEW_SECONDS)
    except signing.BadSignature:
        raise DeletionPreviewChanged() from None
    players, card_plan, personal_photos, _, fingerprint = _deletion_plan(player, user, actor, lock=True)
    if not isinstance(reviewed, str) or not constant_time_compare(reviewed, fingerprint):
        raise DeletionPreviewChanged()
    identities = {str(p.id) for p in players}
    for card, remaining in card_plan:
        data = deepcopy(card.coaching_card_data or {})
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
    close_jersey_assignments([p.id for p in players])
    # Personal photos use the existing asset deletion lifecycle. Shared film is retained.
    personal_photos.update(is_deleted=True, deleted_at=timezone.now(), user=None)
    # File rows for shared team content must survive deletion of their uploader.
    FileAsset.all_objects.filter(user=user).update(user=None)
    Session.objects.filter(user_id=str(user.id)).delete()
    IssueComment.all_objects.filter(actor=user).update(actor=None)
    user.delete()
