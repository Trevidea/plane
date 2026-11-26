from django.urls import path
from rest_framework.authentication import SessionAuthentication

from plane.app.views import RosterPlayerViewSet
from plane.app.views.roster_notice import RosterNoticeEndpoint
from plane.app.views.enrollment_diagnostics import EnrollmentReportEndpoint


urlpatterns = [
    path("player/enrollment-diagnostics/", EnrollmentReportEndpoint.as_view(), name="enrollment-diagnostics"),
    path("workspaces/<str:slug>/roster-notices/", RosterNoticeEndpoint.as_view(), name="staff-roster-notices"),
    path(
        "workspaces/<str:slug>/roster-notices/<uuid:notice_id>/read/",
        RosterNoticeEndpoint.as_view(),
        name="staff-roster-notice-read",
    ),
    path("player/roster-notices/", RosterNoticeEndpoint.as_view(), name="player-roster-notices"),
    path(
        "player/roster-notices/<uuid:notice_id>/read/", RosterNoticeEndpoint.as_view(), name="player-roster-notice-read"
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/roster/<uuid:pk>/password-reset/",
        RosterPlayerViewSet.as_view({"post": "issue_password_reset"}, authentication_classes=[SessionAuthentication]),
        name="project-roster-password-reset",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/roster/<uuid:pk>/decline/",
        RosterPlayerViewSet.as_view({"post": "decline"}), name="project-roster-decline",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/roster/identities/",
        RosterPlayerViewSet.as_view({"get": "identities"}),
        name="project-roster-identities",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/roster/tag-references/",
        RosterPlayerViewSet.as_view({"post": "tag_references"}),
        name="project-roster-tag-references",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/roster/events/",
        RosterPlayerViewSet.as_view({"get": "events"}),
        name="project-roster-events",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/roster/account-matches/",
        RosterPlayerViewSet.as_view({"post": "account_matches"}),
        name="project-roster-account-matches",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/roster/account-deletion/",
        RosterPlayerViewSet.as_view({"get": "account_deletion_policy"}),
        name="project-roster-account-deletion-policy",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/roster/<uuid:pk>/account/",
        RosterPlayerViewSet.as_view(
            {"get": "preview_account_deletion", "delete": "delete_account"}, authentication_classes=[SessionAuthentication]
        ),
        name="project-roster-delete-account",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/roster/<uuid:pk>/approve/",
        RosterPlayerViewSet.as_view({"post": "approve"}),
        name="project-roster-approve",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/roster/<uuid:pk>/resend-invitation/",
        RosterPlayerViewSet.as_view({"post": "resend_invitation"}),
        name="project-roster-resend-invitation",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/roster/registration/",
        RosterPlayerViewSet.as_view({"get": "registration", "post": "registration", "delete": "registration"}),
        name="project-roster-registration",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/roster/import/",
        RosterPlayerViewSet.as_view({"post": "import_players"}),
        name="project-roster-import",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/roster/import-matches/",
        RosterPlayerViewSet.as_view({"post": "import_matches"}),
        name="project-roster-import-matches",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/roster/",
        RosterPlayerViewSet.as_view({"get": "list", "post": "create"}),
        name="project-roster",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/roster/<uuid:pk>/",
        RosterPlayerViewSet.as_view(
            {
                "get": "retrieve",
                "patch": "partial_update",
                "delete": "destroy",
            }
        ),
        name="project-roster-detail",
    ),
]
