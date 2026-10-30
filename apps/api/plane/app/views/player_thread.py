"""Recipient-scoped access to the player-visible comments on a coaching card."""

from html import unescape

from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.html import strip_tags
from rest_framework import serializers, status
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from plane.app.serializers.user import UserLiteSerializer
from plane.app.views.base import BaseAPIView
from plane.app.views.player import PlayerProgramQuerySerializer, _eligible_roster
from plane.db.models import Issue, IssueComment
from plane.utils.coaching_card import COACHING_CARD_CATEGORY
from plane.utils.content_validator import validate_html_content


class PlayerThreadMessageSerializer(serializers.ModelSerializer):
    actor_detail = UserLiteSerializer(source="actor", read_only=True)

    class Meta:
        model = IssueComment
        fields = (
            "id", "issue", "actor", "actor_detail", "comment_html", "comment_stripped",
            "access", "created_at", "updated_at", "edited_at",
        )
        read_only_fields = fields


class PlayerThreadWriteSerializer(serializers.Serializer):
    comment_html = serializers.CharField(max_length=20000, trim_whitespace=True)

    def to_internal_value(self, data):
        if not isinstance(data, dict):
            raise serializers.ValidationError("Expected an object containing comment_html.")
        unknown = set(data) - {"comment_html"}
        if unknown:
            raise serializers.ValidationError({key: "This field is not writable." for key in unknown})
        return super().to_internal_value(data)

    def validate_comment_html(self, value):
        valid, error, cleaned = validate_html_content(value)
        if not valid:
            raise serializers.ValidationError(error)
        if not unescape(strip_tags(cleaned or "")).strip():
            raise serializers.ValidationError("Write a message before sending.")
        return cleaned


class PlayerThreadBase(BaseAPIView):
    def get_card(self, request, slug, project_id, card_id):
        player = get_object_or_404(
            _eligible_roster(request.user), project_id=project_id, project__workspace__slug=slug
        )
        card = get_object_or_404(
            Issue.issue_objects.select_related("project", "project__workspace"),
            pk=card_id, project_id=project_id, workspace_id=player.workspace_id,
            category=COACHING_CARD_CATEGORY, archived_at__isnull=True,
        )
        data = card.coaching_card_data or {}
        # A present recipient list is authoritative; only legacy cards use the FK.
        recipients = data.get("recipient_ids")
        if recipients is None:
            recipients = [str(card.roster_player_id)] if card.roster_player_id else []
        if str(player.id) not in recipients:
            from rest_framework.exceptions import NotFound

            raise NotFound()
        return card

    def messages(self, card):
        return IssueComment.objects.filter(issue=card, project_id=card.project_id, access="EXTERNAL").select_related("actor")

    def response(self, data=None, status_code=status.HTTP_200_OK):
        return Response(data, status=status_code, headers={"Cache-Control": "private, no-store"})


class PlayerThreadEndpoint(PlayerThreadBase):
    def get(self, request, slug, project_id, card_id):
        card = self.get_card(request, slug, project_id, card_id)
        query = PlayerProgramQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        limit, offset = query.validated_data["limit"], query.validated_data["offset"]
        messages = self.messages(card).order_by("created_at", "id")
        return self.response({
            "total_count": messages.count(), "limit": limit, "offset": offset,
            "results": PlayerThreadMessageSerializer(messages[offset:offset + limit], many=True).data,
        })

    def post(self, request, slug, project_id, card_id):
        card = self.get_card(request, slug, project_id, card_id)
        payload = PlayerThreadWriteSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        comment = IssueComment.objects.create(
            project=card.project, issue=card, actor=request.user, access="EXTERNAL",
            comment_html=payload.validated_data["comment_html"],
        )
        return self.response(PlayerThreadMessageSerializer(comment).data, status.HTTP_201_CREATED)


class PlayerThreadMessageEndpoint(PlayerThreadBase):
    def get_message(self, request, slug, project_id, card_id, comment_id, *, writing=False):
        card = self.get_card(request, slug, project_id, card_id)
        message = get_object_or_404(self.messages(card), pk=comment_id)
        if writing and message.actor_id != request.user.id:
            raise PermissionDenied("You can change only your own messages.")
        return message

    def get(self, request, slug, project_id, card_id, comment_id):
        message = self.get_message(request, slug, project_id, card_id, comment_id)
        return self.response(PlayerThreadMessageSerializer(message).data)

    def patch(self, request, slug, project_id, card_id, comment_id):
        message = self.get_message(request, slug, project_id, card_id, comment_id, writing=True)
        payload = PlayerThreadWriteSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        message.comment_html = payload.validated_data["comment_html"]
        message.edited_at = timezone.now()
        message.save()
        return self.response(PlayerThreadMessageSerializer(message).data)

    def delete(self, request, slug, project_id, card_id, comment_id):
        message = self.get_message(request, slug, project_id, card_id, comment_id, writing=True)
        message.delete()
        return self.response(status_code=status.HTTP_204_NO_CONTENT)
