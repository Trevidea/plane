from django.urls import path

from plane.app.views.player import PlayerCoachingCardConfigEndpoint, PlayerProgramsEndpoint

from plane.app.views.player_activity import (
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

urlpatterns = [
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
