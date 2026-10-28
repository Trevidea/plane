from django.urls import path

from plane.app.views.player import PlayerProgramConfigEndpoint, PlayerProgramsEndpoint

urlpatterns = [
    path("player/programs/", PlayerProgramsEndpoint.as_view(), name="player-programs"),
    path(
        "player/workspaces/<str:slug>/projects/<uuid:project_id>/coaching-card-config/",
        PlayerProgramConfigEndpoint.as_view(),
        name="player-program-config",
    ),
]
