"""Authenticated, read-only metadata for explicitly linked roster players."""

from django.db.models import Exists, F, OuterRef
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.response import Response

from plane.app.views.base import BaseAPIView
from plane.db.models import RosterPlayer, WorkspaceMember
from plane.utils.coaching_card_lifecycle import get_project_card_stage_config


class PlayerProgramQuerySerializer(serializers.Serializer):
    limit = serializers.IntegerField(min_value=1, max_value=100, default=50)
    offset = serializers.IntegerField(min_value=0, max_value=2**31 - 1, default=0)


def _eligible_roster(user):
    memberships = WorkspaceMember.objects.filter(
        workspace_id=OuterRef("project__workspace_id"), member=user, is_active=True
    )
    return (
        RosterPlayer.objects.filter(
            user=user,
            user__is_active=True,
            user__is_bot=False,
            status__in=("active", "injured"),
            workspace_id=F("project__workspace_id"),
            project__deleted_at__isnull=True,
            project__archived_at__isnull=True,
            project__workspace__deleted_at__isnull=True,
        )
        .alias(has_workspace_membership=Exists(memberships))
        .filter(has_workspace_membership=True)
        .select_related("project", "project__workspace")
    )


class PlayerProgramsEndpoint(BaseAPIView):
    def get(self, request):
        query = PlayerProgramQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        limit = query.validated_data["limit"]
        offset = query.validated_data["offset"]
        players = _eligible_roster(request.user).order_by(
            "project__workspace__slug", "project__name", "project_id", "id"
        )
        total = players.count()
        results = [
            {
                "id": str(player.project_id),
                "name": player.project.name,
                "identifier": player.project.identifier,
                "sport": player.project.sport or "",
                "workspace_slug": player.project.workspace.slug,
                "workspace_name": player.project.workspace.name,
                "player_id": str(player.id),
            }
            for player in players[offset : offset + limit]
        ]
        return Response(
            {"total_count": total, "limit": limit, "offset": offset, "results": results},
            headers={"Cache-Control": "private, no-store"},
        )


class PlayerCoachingCardConfigEndpoint(BaseAPIView):
    def get(self, request, slug, project_id):
        player = get_object_or_404(_eligible_roster(request.user), project_id=project_id, project__workspace__slug=slug)
        return Response(get_project_card_stage_config(player.project), headers={"Cache-Control": "private, no-store"})
