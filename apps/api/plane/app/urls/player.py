from django.urls import path
from plane.authentication.views.player_invitation import PlayerInvitationPreviewEndpoint

from plane.app.views.player import PlayerCoachingCardConfigEndpoint, PlayerProgramsEndpoint
from plane.app.views.player_media import PlayerCardPlaybackEndpoint, PlayerSignedMediaEndpoint
from plane.app.views.player_thread import PlayerThreadEndpoint, PlayerThreadMessageEndpoint

from plane.app.views.player_activity import (
    PlayerStageHistoryEndpoint,
    PlayerActivitiesEndpoint,
    PlayerActivityEndpoint,
    PlayerAssignmentsEndpoint,
    PlayerProgressEndpoint,
    PlayerCommentsEndpoint,
    PlayerCommentEndpoint,
    PlayerReactionsEndpoint,
    PlayerActivityMediaEndpoint,
    PlayerRoleEndpoint,
)

from plane.app.views.private_card_thread import (
    PrivateCardThreadEndpoint,
    PrivateCardMessageEndpoint,
    CoachPrivateRecipientsEndpoint,
)

from plane.app.views.private_card_attachments import PrivateClipUploadEndpoint, PrivateClipPlaybackEndpoint

urlpatterns = [
    path("player/invitations/preview/", PlayerInvitationPreviewEndpoint.as_view(), name="player-invitation-preview"),
    path(
        "player/workspaces/<str:slug>/projects/<uuid:project_id>/coaching-cards/<uuid:card_id>/private-thread/attachments/",
        PrivateClipUploadEndpoint.as_view(),
        name="player-private-clips",
    ),
    path(
        "player/workspaces/<str:slug>/projects/<uuid:project_id>/coaching-cards/<uuid:card_id>/private-thread/attachments/<uuid:attachment_id>/playback/",
        PrivateClipPlaybackEndpoint.as_view(),
        name="player-private-clip-playback",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/coaching-cards/<uuid:card_id>/private-threads/<uuid:recipient_user_id>/attachments/",
        PrivateClipUploadEndpoint.as_view(),
        name="coach-private-clips",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/coaching-cards/<uuid:card_id>/private-threads/<uuid:recipient_user_id>/attachments/<uuid:attachment_id>/playback/",
        PrivateClipPlaybackEndpoint.as_view(),
        name="coach-private-clip-playback",
    ),
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
        PlayerStageHistoryEndpoint.as_view(),
        name="player-stage-history",
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


activity = "player/workspaces/<str:slug>/projects/<uuid:project_id>/activities/<uuid:issue_id>/"
urlpatterns += [
    path("player/assignments/", PlayerAssignmentsEndpoint.as_view(), name="player-assignments"),
    path("player/activities/", PlayerActivitiesEndpoint.as_view(), name="player-activities"),
    path(activity, PlayerActivityEndpoint.as_view(), name="player-activity"),
    path(activity + "progress/", PlayerProgressEndpoint.as_view(), name="player-activity-progress"),
    path(activity + "comments/", PlayerCommentsEndpoint.as_view(), name="player-activity-comments"),
    path(activity + "comments/<uuid:comment_id>/", PlayerCommentEndpoint.as_view(), name="player-activity-comment"),
    path(activity + "reactions/", PlayerReactionsEndpoint.as_view(), name="player-activity-reactions"),
    path(
        activity + "comments/<uuid:comment_id>/reactions/",
        PlayerReactionsEndpoint.as_view(),
        name="player-comment-reactions",
    ),
    path(
        activity + "media/<str:package_id>/<str:artifact_id>/",
        PlayerActivityMediaEndpoint.as_view(),
        name="player-activity-media",
    ),
    path(
        activity + "media/<str:package_id>/<str:artifact_id>/<path:artifact_path>",
        PlayerActivityMediaEndpoint.as_view(),
        name="player-activity-media-path",
    ),
]

urlpatterns += [path("player/role/", PlayerRoleEndpoint.as_view(), name="player-role")]
