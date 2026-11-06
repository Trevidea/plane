"""Participant-only conversations for an existing assigned coaching card."""

import hashlib
import json
from django.db import transaction
from html import unescape
from django.shortcuts import get_object_or_404
from django.db.models import Exists, OuterRef
from django.utils import timezone
from django.utils.html import strip_tags
from rest_framework import serializers, status
from rest_framework.exceptions import PermissionDenied, NotFound
from rest_framework.response import Response
from plane.app.serializers.user import UserLiteSerializer
from plane.app.views.base import BaseAPIView
from plane.app.views.player import PlayerProgramQuerySerializer, _eligible_roster
from plane.db.models import CoachingCardPrivateMessage, Issue, ProjectMember, RosterPlayer, User, WorkspaceMember
from plane.utils.coaching_card import COACHING_CARD_CATEGORY
from plane.utils.content_validator import validate_html_content
from rest_framework.exceptions import APIException
from .private_card_attachments import attachment_data, attach_clip


class PrivateWriteSerializer(serializers.Serializer):
    visibility = serializers.ChoiceField(choices=["private"])
    comment_html = serializers.CharField(max_length=20000, trim_whitespace=True, allow_blank=True, default="")
    attachment = serializers.JSONField(required=False)
    client_id = serializers.RegexField(r"^[A-Za-z0-9_-]{1,128}$", required=False)

    def to_internal_value(self, data):
        if not isinstance(data, dict) or set(data) - {"visibility", "comment_html", "attachment", "client_id"}:
            raise serializers.ValidationError({"detail": "Invalid private message fields."})
        return super().to_internal_value(data)

    def validate_comment_html(self, value):
        if not value:
            return ""
        valid, error, cleaned = validate_html_content(value)
        if not valid:
            raise serializers.ValidationError(error)
        text = unescape(strip_tags(cleaned or "")).strip()
        if len(text) > 300:
            raise serializers.ValidationError("Write up to 300 characters.")
        return cleaned if text else ""

    def validate(self, data):
        if not data.get("comment_html") and not data.get("attachment"):
            raise serializers.ValidationError("Write a message or attach a clip.")
        if data.get("attachment") and not data.get("client_id"):
            raise serializers.ValidationError("Clip messages require a client ID.")
        return data


class MessageConflict(APIException):
    status_code = 409
    default_detail = "This send ID was already used for another message."


def private_card(request, slug, project_id, card_id, *, coach_request=False):
    cards = Issue.issue_objects.select_related("created_by").filter(
        pk=card_id,
        project_id=project_id,
        project__workspace__slug=slug,
        category=COACHING_CARD_CATEGORY,
        archived_at__isnull=True,
        project__archived_at__isnull=True,
        project__workspace__deleted_at__isnull=True,
        created_by__is_active=True,
        created_by__is_bot=False,
    )
    if coach_request:
        cards = cards.filter(created_by=request.user)
    card = get_object_or_404(cards)
    # Current staff membership is required for the named coach, even on player reads.
    if not ProjectMember.objects.filter(
        project_id=project_id, member_id=card.created_by_id, is_active=True, role__gte=15
    ).exists():
        raise NotFound()
    if not WorkspaceMember.objects.filter(
        workspace_id=card.workspace_id, member_id=card.created_by_id, is_active=True
    ).exists():
        raise NotFound()
    return card


def participant_context(request, slug, project_id, card_id, recipient_user_id=None):
    card = private_card(request, slug, project_id, card_id, coach_request=recipient_user_id is not None)
    recipient = (
        get_object_or_404(User.objects.filter(is_active=True, is_bot=False), pk=recipient_user_id)
        if recipient_user_id
        else request.user
    )
    player = get_object_or_404(_eligible_roster(recipient), project_id=project_id, project__workspace__slug=slug)
    data = card.coaching_card_data or {}
    recipients = data.get("recipient_ids")
    if recipients is None:
        recipients = [str(card.roster_player_id)] if card.roster_player_id else []
    if str(player.id) not in recipients:
        raise NotFound()
    return card, recipient


def audience(card, recipient):
    return {
        "visibility": "private",
        "issue": str(card.id),
        "recipient_id": str(recipient.id),
        "coach_id": str(card.created_by_id),
    }


def serialize_message(message, card, recipient):
    item = getattr(message, "clip_attachment", None)
    return {
        **({"attachment": attachment_data(item)} if item else {}),
        **audience(card, recipient),
        "id": str(message.id),
        "actor": str(message.actor_id),
        "actor_detail": UserLiteSerializer(message.actor).data,
        "access": "PRIVATE",
        "comment_html": message.comment_html,
        "comment_stripped": unescape(strip_tags(message.comment_html)),
        "created_at": message.created_at.isoformat(),
        "updated_at": message.updated_at.isoformat(),
        "edited_at": message.edited_at.isoformat() if message.edited_at else None,
    }


def private_response(data=None, status_code=status.HTTP_200_OK):
    return Response(data, status=status_code, headers={"Cache-Control": "private, no-store"})


def messages(card, recipient):
    return CoachingCardPrivateMessage.objects.filter(
        issue=card, coach_id=card.created_by_id, recipient=recipient
    ).select_related("actor", "clip_attachment")


class PrivateCardThreadEndpoint(BaseAPIView):
    user_role_access = True

    def get(self, request, slug, project_id, card_id, recipient_user_id=None):
        card, recipient = participant_context(request, slug, project_id, card_id, recipient_user_id)
        query = PlayerProgramQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        limit, offset = query.validated_data["limit"], query.validated_data["offset"]
        qs = messages(card, recipient).order_by("created_at", "id")
        return private_response(
            {
                **audience(card, recipient),
                "total_count": qs.count(),
                "limit": limit,
                "offset": offset,
                "results": [serialize_message(message, card, recipient) for message in qs[offset : offset + limit]],
            }
        )

    def post(self, request, slug, project_id, card_id, recipient_user_id=None):
        card, recipient = participant_context(request, slug, project_id, card_id, recipient_user_id)
        payload = PrivateWriteSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        fingerprint = hashlib.sha256(
            json.dumps(
                {"comment_html": data["comment_html"], "attachment": data.get("attachment")},
                sort_keys=True,
                separators=(",", ":"),
            ).encode()
        ).hexdigest()
        with transaction.atomic():
            # Serialize send/retry for this card to enforce attachment ownership atomically.
            Issue.issue_objects.select_related(None).select_for_update(of=("self",)).get(pk=card.id)
            card, recipient = participant_context(request, slug, project_id, card_id, recipient_user_id)
            if data.get("client_id"):
                existing = messages(card, recipient).filter(actor=request.user, client_id=data["client_id"]).first()
                if existing:
                    if existing.request_hash != fingerprint:
                        raise MessageConflict()
                    return private_response(serialize_message(existing, card, recipient))
            message = CoachingCardPrivateMessage.objects.create(
                issue=card,
                coach_id=card.created_by_id,
                recipient=recipient,
                actor=request.user,
                comment_html=data["comment_html"],
                client_id=data.get("client_id"),
                request_hash=fingerprint,
            )
            if data.get("attachment"):
                attach_clip(request, card, recipient, data["attachment"], message)
        return private_response(serialize_message(message, card, recipient), status.HTTP_201_CREATED)


class PrivateCardMessageEndpoint(BaseAPIView):
    user_role_access = True

    def message(self, request, slug, project_id, card_id, comment_id, recipient_user_id=None, writing=False):
        card, recipient = participant_context(request, slug, project_id, card_id, recipient_user_id)
        message = get_object_or_404(messages(card, recipient), pk=comment_id)
        if writing and message.actor_id != request.user.id:
            raise PermissionDenied("You can change only your own messages.")
        return card, recipient, message

    def get(self, request, slug, project_id, card_id, comment_id, recipient_user_id=None):
        card, recipient, message = self.message(request, slug, project_id, card_id, comment_id, recipient_user_id)
        return private_response(serialize_message(message, card, recipient))

    def patch(self, request, slug, project_id, card_id, comment_id, recipient_user_id=None):
        card, recipient, message = self.message(
            request, slug, project_id, card_id, comment_id, recipient_user_id, writing=True
        )
        if set(request.data) - {"visibility", "comment_html"}:
            raise serializers.ValidationError("Attachments cannot be replaced by editing a message.")
        payload = PrivateWriteSerializer(
            data={
                **request.data,
                **(
                    {"attachment": {"existing": True}, "client_id": "edit"}
                    if getattr(message, "clip_attachment", None)
                    else {}
                ),
            }
        )
        payload.is_valid(raise_exception=True)
        message.comment_html = payload.validated_data["comment_html"]
        message.edited_at = timezone.now()
        message.save(update_fields=["comment_html", "edited_at", "updated_at"])
        return private_response(serialize_message(message, card, recipient))

    def delete(self, request, slug, project_id, card_id, comment_id, recipient_user_id=None):
        _, _, message = self.message(request, slug, project_id, card_id, comment_id, recipient_user_id, writing=True)
        message.delete()
        return private_response(status_code=status.HTTP_204_NO_CONTENT)


class CoachPrivateRecipientsEndpoint(BaseAPIView):
    def get(self, request, slug, project_id, card_id):
        card = private_card(request, slug, project_id, card_id, coach_request=True)
        data = card.coaching_card_data or {}
        recipient_ids = data.get("recipient_ids")
        if recipient_ids is None:
            recipient_ids = [str(card.roster_player_id)] if card.roster_player_id else []
        roster = (
            RosterPlayer.objects.filter(
                pk__in=recipient_ids,
                project_id=project_id,
                workspace_id=card.workspace_id,
                user__is_active=True,
                user__is_bot=False,
                status__in=("active", "injured"),
            )
            .alias(
                has_membership=Exists(
                    WorkspaceMember.objects.filter(
                        workspace_id=card.workspace_id,
                        member_id=OuterRef("user_id"),
                        is_active=True,
                    )
                )
            )
            .filter(has_membership=True)
            .order_by("player_name", "id")
        )
        recipients = list(
            {str(player.user_id): {"id": str(player.user_id), "name": player.player_name} for player in roster}.values()
        )
        return private_response(
            {"visibility": "private", "issue": str(card.id), "coach_id": str(request.user.id), "recipients": recipients}
        )
