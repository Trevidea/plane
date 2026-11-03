"""Read-only stage audit history for currently assigned player cards."""

from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework.response import Response

from plane.app.views.base import BaseAPIView
from plane.app.views.player import PlayerProgramQuerySerializer, _eligible_roster
from plane.db.models import CardStageHistory, Issue
from plane.utils.coaching_card import COACHING_CARD_CATEGORY


class PlayerActivityEndpoint(BaseAPIView):
    def get(self, request, slug, project_id):
        player = get_object_or_404(_eligible_roster(request.user), project_id=project_id, project__workspace__slug=slug)
        query = PlayerProgramQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        limit, offset = query.validated_data["limit"], query.validated_data["offset"]
        legacy = Q(coaching_card_data__recipient_ids__isnull=True) | Q(coaching_card_data__recipient_ids=None)
        cards = Issue.issue_objects.filter(
            Q(coaching_card_data__recipient_ids__contains=[str(player.id)]) | (legacy & Q(roster_player_id=player.id)),
            project_id=project_id,
            workspace_id=player.workspace_id,
            category=COACHING_CARD_CATEGORY,
            archived_at__isnull=True,
        )
        history = (
            CardStageHistory.objects.filter(issue_id__in=cards.values("id"))
            .select_related("issue", "changed_by")
            .order_by("-changed_at", "-id")
        )
        total = history.count()
        results = [
            {
                "id": str(event.id),
                "card": {"id": str(event.issue_id), "title": event.issue.name, "sequence_id": event.issue.sequence_id},
                "actor": (
                    {"id": str(event.changed_by_id), "display_name": event.changed_by.display_name or "Coach", "avatar_url": event.changed_by.avatar_url}
                    if event.changed_by_id
                    else None
                ),
                "from_stage": event.from_stage_name,
                "to_stage": event.to_stage_name,
                "changed_at": event.changed_at.isoformat(),
                "reason": event.reason,
            }
            for event in history[offset : offset + limit]
        ]
        return Response(
            {"project_id": str(project_id), "total_count": total, "limit": limit, "offset": offset, "results": results},
            headers={"Cache-Control": "private, no-store"},
        )
