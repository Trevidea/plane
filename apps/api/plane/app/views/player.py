"""Authenticated, read-only metadata for explicitly linked roster players."""

from rest_framework import serializers, status
from rest_framework.response import Response

from plane.app.views.base import BaseAPIView
from plane.db.models import State, PlayerRegistrationRequest
from plane.utils.coaching_card_lifecycle import get_project_card_stage_config
from plane.utils.player_access import player_card_roster_queryset


class PlayerProgramQuerySerializer(serializers.Serializer):
    limit = serializers.IntegerField(min_value=1, max_value=100, default=50)
    offset = serializers.IntegerField(min_value=0, max_value=2**31 - 1, default=0)


class PlayerRegistrationRequestsEndpoint(BaseAPIView):
    user_role_access = True

    def get(self, request):
        query = PlayerProgramQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        limit, offset = query.validated_data["limit"], query.validated_data["offset"]
        rows = (
            PlayerRegistrationRequest.objects.filter(
                user=request.user,
                user__is_active=True,
                approved_at__isnull=True,
                roster_player__deleted_at__isnull=True,
                roster_player__account_link_held=False,
                project__deleted_at__isnull=True,
                project__archived_at__isnull=True,
                workspace__deleted_at__isnull=True,
            )
            .select_related("project", "workspace")
            .order_by("-created_at", "id")
        )
        return Response(
            {
                "total_count": rows.count(),
                "limit": limit,
                "offset": offset,
                "results": [
                    {
                        "id": str(row.id),
                        "program_id": str(row.project_id),
                        "program_name": row.project.name,
                        "workspace_name": row.workspace.name,
                        "status": "pending",
                    }
                    for row in rows[offset : offset + limit]
                ],
            },
            headers={"Cache-Control": "private, no-store"},
        )


def _eligible_roster(user):
    return player_card_roster_queryset(user).filter(
        user__is_active=True,
        user__is_bot=False,
        status__in=("active", "injured", "inactive", "removed"),
    )


class PlayerProgramsEndpoint(BaseAPIView):
    user_role_access = True

    def get(self, request):
        query = PlayerProgramQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        limit, offset = query.validated_data["limit"], query.validated_data["offset"]
        from django.db.models import Q

        # JSON recipients are checked in the personal activity query, including shared cards.
        from plane.utils.player_activity_access import player_activities

        own_projects = player_activities(request.user).filter(category="Coaching Card").values("project_id")
        players = (
            _eligible_roster(request.user)
            .filter(Q(status__in=["active", "injured"]) | Q(project_id__in=own_projects))
            .select_related("project__team_season")
            .order_by("project__workspace__slug", "project__name", "project_id", "id")
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
                        "member_id": str(player.id),
                        "team_season_id": getattr(getattr(player.project, "team_season", None), "pk", None),
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
    user_role_access = True

    def get(self, request, slug, project_id):
        from django.db.models import Q
        from plane.utils.player_activity_access import player_activities

        own_projects = player_activities(request.user).filter(category="Coaching Card").values("project_id")
        player = (
            _eligible_roster(request.user)
            .filter(
                Q(status__in=["active", "injured"]) | Q(project_id__in=own_projects),
                project_id=project_id,
                project__workspace__slug=slug,
            )
            .first()
        )
        if player is None:
            return Response({"detail": "Program not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(get_project_card_stage_config(player.project), headers={"Cache-Control": "private, no-store"})


# Keep imports from either branch compatible without duplicating the endpoint.
PlayerCoachingCardConfigEndpoint = PlayerProgramConfigEndpoint
