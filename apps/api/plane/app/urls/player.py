from django.urls import path

from plane.app.views.player import PlayerCoachingCardConfigEndpoint, PlayerProgramsEndpoint
from plane.app.views.player_media import PlayerCardPlaybackEndpoint, PlayerSignedMediaEndpoint


urlpatterns = [
    path(
        "player/workspaces/<str:slug>/projects/<uuid:project_id>/coaching-cards/<uuid:card_id>/clips/<int:clip_index>/playback/",
        PlayerCardPlaybackEndpoint.as_view(),
        name="player-card-playback",
    ),
    path(
        "player/media/<str:token>/<path:resource>",
        PlayerSignedMediaEndpoint.as_view(),
        name="player-signed-media",
    ),
    path("player/programs/", PlayerProgramsEndpoint.as_view(), name="player-programs"),
    path(
        "player/workspaces/<str:slug>/projects/<uuid:project_id>/coaching-card-config/",
        PlayerCoachingCardConfigEndpoint.as_view(),
        name="player-coaching-card-config",
    ),
]
