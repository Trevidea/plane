from rest_framework import serializers, status
from rest_framework.response import Response

from plane.app.views.base import BaseAPIView
from plane.db.models import State
from plane.utils.player_access import player_roster_queryset
from plane.utils.coaching_card_lifecycle import get_project_card_stage_config


class PlayerProgramQuerySerializer(serializers.Serializer):
    limit = serializers.IntegerField(min_value=1, max_value=100, default=50)
    offset = serializers.IntegerField(min_value=0, default=0)


class PlayerProgramsEndpoint(BaseAPIView):
    def get(self, request):
        query = PlayerProgramQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        limit, offset = query.validated_data["limit"], query.validated_data["offset"]
        players = player_roster_queryset(request.user).order_by("project__workspace__name", "project__name", "id")
        total = players.count()
        page = list(players[offset : offset + limit])
        stages = {}
        for state in State.objects.filter(project_id__in=[row.project_id for row in page], is_triage=False).order_by(
            "sequence", "id"
        ):
            stages.setdefault(state.project_id, []).append({"id": str(state.id), "name": state.name})
        response = Response(
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
                        "player_id": str(player.id),
                        "stages": stages.get(player.project_id, []),
                    }
                    for player in page
                ],
            }
        )
        response["Cache-Control"] = "no-store"
        return response


class PlayerProgramConfigEndpoint(BaseAPIView):
    def get(self, request, slug, project_id):
        player = (
            player_roster_queryset(request.user).filter(project_id=project_id, project__workspace__slug=slug).first()
        )
        if player is None:
            return Response({"detail": "Program not found."}, status=status.HTTP_404_NOT_FOUND)
        response = Response(get_project_card_stage_config(player.project))
        response["Cache-Control"] = "no-store"
        return response
