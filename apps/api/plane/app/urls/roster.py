from django.urls import path

from plane.app.views import RosterPlayerViewSet


urlpatterns = [
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
        "workspaces/<str:slug>/projects/<uuid:project_id>/roster/<uuid:pk>/account/",
        RosterPlayerViewSet.as_view({"delete": "delete_account"}),
        name="project-roster-delete-account",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/roster/<uuid:pk>/approve/",
        RosterPlayerViewSet.as_view({"post": "approve"}),
        name="project-roster-approve",
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
