"""Authenticated, read-only metadata for explicitly linked roster players."""

from rest_framework import serializers, status
from rest_framework.response import Response

from plane.app.views.base import BaseAPIView
from plane.db.models import State
from plane.utils.coaching_card_lifecycle import get_project_card_stage_config
from plane.utils.player_access import player_roster_queryset


class PlayerProgramQuerySerializer(serializers.Serializer):
    limit = serializers.IntegerField(min_value=1, max_value=100, default=50)
    offset = serializers.IntegerField(min_value=0, max_value=2**31 - 1, default=0)


def _eligible_roster(user):
    return player_roster_queryset(user).filter(
        user__is_active=True,
        user__is_bot=False,
        status__in=("active", "injured"),
    )


class PlayerProgramsEndpoint(BaseAPIView):
    def get(self, request):
        query = PlayerProgramQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        limit, offset = query.validated_data["limit"], query.validated_data["offset"]
        players = _eligible_roster(request.user).order_by(
            "project__workspace__slug", "project__name", "project_id", "id"
        )
        total = players.count()
        page = list(players[offset : offset + limit])
        stages = {}
        for state in State.objects.filter(project_id__in=[row.project_id for row in page], is_triage=False).order_by(
            "sequence", "id"
        ):
            stages.setdefault(state.project_id, []).append({"id": str(state.id), "name": state.name})
        return Response(
            {
                "total_count": total,
                "limit": limit,
                "offset": offset,
                "results": [
                    {
                        "id": str(player.project_id),
                        "workspace_slug": player.project.workspace.slug,
                        "workspace_name": player.project.workspace.name,
                        "name": player.project.name,
                        "identifier": player.project.identifier,
                        "sport": player.project.sport or "",
                        "logo_props": player.project.logo_props,
                        "player_id": str(player.id),
                        "stages": stages.get(player.project_id, []),
                        "roster": {
                            "player_name": player.player_name,
                            "jersey_number": player.jersey_number,
                            "position": player.position,
                            "class_year": player.class_year,
                        },
                    }
                    for player in page
                ],
            },
            headers={"Cache-Control": "private, no-store"},
        )


class PlayerProgramConfigEndpoint(BaseAPIView):
    def get(self, request, slug, project_id):
        player = _eligible_roster(request.user).filter(project_id=project_id, project__workspace__slug=slug).first()
        if player is None:
            return Response({"detail": "Program not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(get_project_card_stage_config(player.project), headers={"Cache-Control": "private, no-store"})


# Keep imports from either branch compatible without duplicating the endpoint.
PlayerCoachingCardConfigEndpoint = PlayerProgramConfigEndpoint
