from django.urls import path

from plane.app.views.player import PlayerCoachingCardConfigEndpoint, PlayerProgramsEndpoint
from plane.app.views.player_activity import PlayerActivityEndpoint
from plane.app.views.player_media import PlayerCardPlaybackEndpoint, PlayerSignedMediaEndpoint
from plane.app.views.player_thread import PlayerThreadEndpoint, PlayerThreadMessageEndpoint


from plane.app.views.private_card_thread import (
    PrivateCardThreadEndpoint,
    PrivateCardMessageEndpoint,
    CoachPrivateRecipientsEndpoint,
)

urlpatterns = [
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/coaching-cards/<uuid:card_id>/private-threads/",
        CoachPrivateRecipientsEndpoint.as_view(),
        name="coach-private-card-recipients",
    ),
    path(
        "player/workspaces/<str:slug>/projects/<uuid:project_id>/coaching-cards/<uuid:card_id>/private-thread/",
        PrivateCardThreadEndpoint.as_view(),
        name="player-private-card-thread",
    ),
    path(
        "player/workspaces/<str:slug>/projects/<uuid:project_id>/coaching-cards/<uuid:card_id>/private-thread/<uuid:comment_id>/",
        PrivateCardMessageEndpoint.as_view(),
        name="player-private-card-message",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/coaching-cards/<uuid:card_id>/private-threads/<uuid:recipient_user_id>/",
        PrivateCardThreadEndpoint.as_view(),
        name="coach-private-card-thread",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/coaching-cards/<uuid:card_id>/private-threads/<uuid:recipient_user_id>/messages/<uuid:comment_id>/",
        PrivateCardMessageEndpoint.as_view(),
        name="coach-private-card-message",
    ),
    path(
        "player/workspaces/<str:slug>/projects/<uuid:project_id>/activity/",
        PlayerActivityEndpoint.as_view(),
        name="player-activity",
    ),
    path(
        "player/workspaces/<str:slug>/projects/<uuid:project_id>/coaching-cards/<uuid:card_id>/thread/",
        PlayerThreadEndpoint.as_view(),
        name="player-card-thread",
    ),
    path(
        "player/workspaces/<str:slug>/projects/<uuid:project_id>/coaching-cards/<uuid:card_id>/thread/<uuid:comment_id>/",
        PlayerThreadMessageEndpoint.as_view(),
        name="player-card-thread-message",
    ),
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
