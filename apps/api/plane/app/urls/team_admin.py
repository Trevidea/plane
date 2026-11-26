from django.urls import path

from plane.app.views.roster_account_correction import RosterAccountCorrectionEndpoint
from plane.app.views.team_admin import DelegatedRosterEndpoint, SchoolRosterEndpoint, SeasonStaffEndpoint
from plane.app.views.team_admin import (
    StaffOptionsEndpoint,
    TeamsEndpoint,
    TeamSeasonsEndpoint,
    UnlinkedProgramsEndpoint,
)


prefix = "workspaces/<str:slug>/team-admin/"
roster = "workspaces/<str:slug>/projects/<uuid:project_id>/roster/"
urlpatterns = [
    path(prefix + "teams/", TeamsEndpoint.as_view()),
    path(prefix + "teams/<uuid:team_id>/seasons/", TeamSeasonsEndpoint.as_view()),
    path(prefix + "unlinked-programs/", UnlinkedProgramsEndpoint.as_view()),
    path(prefix + "staff-options/", StaffOptionsEndpoint.as_view()),
    path(prefix + "seasons/<uuid:season_id>/staff/", SeasonStaffEndpoint.as_view()),
    path(prefix + "seasons/<uuid:season_id>/staff/<uuid:user_id>/", SeasonStaffEndpoint.as_view()),
    path(prefix + "roster/", SchoolRosterEndpoint.as_view()),
    path(roster + "delegated/", DelegatedRosterEndpoint.as_view(), name="project-roster-delegated"),
    path(roster + "delegated/<uuid:player_id>/", DelegatedRosterEndpoint.as_view(), name="project-roster-delegated-detail"),
    path(roster + "<uuid:player_id>/account-correction/", RosterAccountCorrectionEndpoint.as_view(), name="project-roster-correction"),
]
