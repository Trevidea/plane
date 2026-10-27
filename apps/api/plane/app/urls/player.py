from django.urls import path

from plane.app.views.player import PlayerCoachingCardConfigEndpoint, PlayerProgramsEndpoint


urlpatterns = [
    path("player/programs/", PlayerProgramsEndpoint.as_view(), name="player-programs"),
    path(
        "player/workspaces/<str:slug>/projects/<uuid:project_id>/coaching-card-config/",
        PlayerCoachingCardConfigEndpoint.as_view(),
        name="player-coaching-card-config",
    ),
]
