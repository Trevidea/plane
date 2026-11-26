from django.db import transaction
from django.db.models import Exists, OuterRef, Q
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.authentication import SessionAuthentication
from rest_framework.exceptions import MethodNotAllowed, PermissionDenied, ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

from plane.app.serializers.project import ProjectSerializer
from plane.app.serializers.roster import RosterPlayerSerializer
from plane.app.views.base import BaseAPIView
from plane.db.models import IssueUserProperty, PlayerRegistrationRequest, Project, ProjectMember, RosterPlayer
from plane.db.models import TeamSeason, TeamSeasonStaff
from plane.db.models import Workspace, WorkspaceMember
from plane.db.models.workspace import Team
from plane.utils.issue_datetime import parse_season_year_range
from plane.utils.program_creation import initialize_program
from plane.utils.team_seasons import ensure_program_season


STAFF = (15, 20)
PRIVATE = {"Cache-Control": "private, no-store"}
ROSTER_FIELDS = ("player_name", "jersey_number", "position", "class_year")


class RosterStaffAPIView(BaseAPIView):
    authentication_classes = [SessionAuthentication]


def admin_workspace(request, slug, *, lock=False):
    workspaces = Workspace.objects.select_for_update() if lock else Workspace.objects.all()
    workspace = get_object_or_404(workspaces, slug=slug)
    if (
        not request.user.is_active
        or request.user.is_bot
        or not WorkspaceMember.objects.filter(
            workspace=workspace,
            member=request.user,
            role=20,
            is_active=True,
        ).exists()
    ):
        raise PermissionDenied("School administrator access is required.")
    return workspace


def page(request, queryset, present):
    paginator = PageNumberPagination()
    paginator.page_size = 50
    rows = paginator.paginate_queryset(queryset, request)
    result = paginator.get_paginated_response([present(row) for row in rows])
    result["Cache-Control"] = PRIVATE["Cache-Control"]
    return result


def season_data(season):
    return {
        "id": season.pk,
        "team_id": season.team_id,
        "project_id": season.project_id,
        "name": season.project.name,
        "season_label": season.season_label,
        "sport": season.sport,
        "division": season.division,
        "level": season.level,
        "starts_on": season.starts_on,
        "ends_on": season.ends_on,
        "archived": bool(season.project.archived_at),
    }


class TeamInput(serializers.Serializer):
    name = serializers.CharField(max_length=255)


class TeamsEndpoint(RosterStaffAPIView):
    def get(self, request, slug):
        workspace = admin_workspace(request, slug)
        rows = Team.objects.filter(workspace=workspace).order_by("name", "pk")
        return page(request, rows, lambda team: {"id": team.pk, "name": team.name})

    @transaction.atomic
    def post(self, request, slug):
        workspace = admin_workspace(request, slug, lock=True)
        payload = TeamInput(data=request.data)
        payload.is_valid(raise_exception=True)
        name = payload.validated_data["name"]
        if Team.objects.filter(workspace=workspace, name__iexact=name).exists():
            raise ValidationError({"name": "A team with this name already exists."})
        team = Team.objects.create(workspace=workspace, name=name, created_by=request.user)
        return Response({"id": team.pk, "name": team.name}, status=201, headers=PRIVATE)


class SeasonInput(serializers.Serializer):
    project_id = serializers.UUIDField(required=False)
    name = serializers.CharField(max_length=255, required=False)
    identifier = serializers.RegexField(r"\A[A-Za-z0-9]+\Z", max_length=12, required=False)
    season_label = serializers.CharField(max_length=20, required=False)
    sport = serializers.CharField(max_length=100, required=False)
    division = serializers.CharField(max_length=100, required=False)
    level = serializers.CharField(max_length=100, required=False)
    starts_on = serializers.DateField(required=False, allow_null=True)
    ends_on = serializers.DateField(required=False, allow_null=True)

    def validate(self, attrs):
        if "project_id" in attrs:
            if len(attrs) != 1:
                raise ValidationError("Link an existing program without changing its season metadata.")
        else:
            required = {"name", "identifier", "season_label", "sport", "division", "level"}
            if missing := required - attrs.keys():
                raise ValidationError({field: "This field is required." for field in sorted(missing)})
            start, end = attrs.get("starts_on"), attrs.get("ends_on")
            years = parse_season_year_range(attrs["season_label"])
            if not years or years[0] == 0 or years[1] - years[0] != 1:
                raise ValidationError({"season_label": "Select two consecutive school years."})
            attrs["season_label"] = f"{years[0]:04d}-{years[1]:04d}"
            if start and end and start > end:
                raise ValidationError({"ends_on": "Must not be before the start date."})
            if any(value and not years[0] <= value.year <= years[1] for value in (start, end)):
                raise ValidationError("The season dates must be within the selected school years.")
        return attrs


class TeamSeasonsEndpoint(RosterStaffAPIView):
    def get(self, request, slug, team_id):
        team = get_object_or_404(Team, pk=team_id, workspace=admin_workspace(request, slug))
        rows = TeamSeason.objects.filter(team=team, project__deleted_at__isnull=True).select_related("project")
        return page(request, rows.order_by("-season_label", "pk"), season_data)

    @transaction.atomic
    def post(self, request, slug, team_id):
        workspace = admin_workspace(request, slug, lock=True)
        team = get_object_or_404(Team, pk=team_id, workspace=workspace)
        payload = SeasonInput(data=request.data)
        payload.is_valid(raise_exception=True)
        values = payload.validated_data
        if "project_id" in values:
            project = get_object_or_404(
                Project.objects.select_for_update(), workspace=workspace, pk=values["project_id"]
            )
            season = ensure_program_season(project)
            if season.team_id == team.pk:
                return Response(season_data(season), status=200, headers=PRIVATE)
            if season.team_id or not season.season_label:
                raise ValidationError("The program already belongs to a team or has no recorded season label.")
            label = season.season_label
        else:
            label = values["season_label"]

        existing_labels = TeamSeason.objects.filter(team=team).values_list("season_label", flat=True)
        year_range = parse_season_year_range(label)
        if any(
            label.casefold() == existing.casefold() or (year_range and year_range == parse_season_year_range(existing))
            for existing in existing_labels
        ):
            raise ValidationError({"season_label": "This team already has a season with this label."})
        if "project_id" not in values:
            serializer = ProjectSerializer(
                data={
                    "name": values["name"],
                    "identifier": values["identifier"].upper(),
                    "network": 0,
                    "sport": values["sport"],
                    "event_season": label,
                    "event_program": values["division"],
                    "event_level": values["level"],
                },
                context={"workspace_id": workspace.pk},
            )
            serializer.is_valid(raise_exception=True)
            project = serializer.save(created_by=request.user)
            initialize_program(project, request.user)
            season = ensure_program_season(project)
            season.starts_on, season.ends_on = values.get("starts_on"), values.get("ends_on")
        season.team = team
        season.save()
        return Response(season_data(season), status=201, headers=PRIVATE)


class UnlinkedProgramsEndpoint(RosterStaffAPIView):
    def get(self, request, slug):
        workspace = admin_workspace(request, slug)
        projects = Project.objects.filter(workspace=workspace, team_season__team__isnull=True).order_by("name", "pk")
        return page(request, projects, lambda p: {"id": p.pk, "name": p.name})


def staff_members(workspace):
    return WorkspaceMember.objects.filter(
        workspace=workspace, role__in=STAFF, is_active=True, member__is_active=True, member__is_bot=False
    )


class StaffOptionsEndpoint(RosterStaffAPIView):
    def get(self, request, slug):
        query = request.query_params.get("search", "").strip()[:100]
        rows = staff_members(admin_workspace(request, slug)).select_related("member")
        if query:
            rows = rows.filter(Q(member__display_name__icontains=query) | Q(member__email__icontains=query))
        return page(
            request,
            rows.order_by("member__display_name", "member_id"),
            lambda row: {"id": row.member_id, "name": row.member.display_name or row.member.email},
        )


class AssignmentInput(serializers.Serializer):
    assignment = serializers.ChoiceField(choices=["coach", "operator"])
    manage_roster = serializers.BooleanField()


def assignment_data(row):
    member = row.membership
    return {
        "id": member.member_id,
        "name": member.member.display_name or member.member.email,
        "assignment": row.assignment,
        "manage_roster": row.manage_roster,
    }


class SeasonStaffEndpoint(RosterStaffAPIView):
    def season(self, workspace, season_id):
        return get_object_or_404(
            TeamSeason,
            pk=season_id,
            team__workspace=workspace,
            project__workspace=workspace,
            team__deleted_at__isnull=True,
            project__deleted_at__isnull=True,
        )

    def get(self, request, slug, season_id, user_id=None):
        if user_id:
            raise MethodNotAllowed(request.method)
        workspace = admin_workspace(request, slug)
        season = self.season(workspace, season_id)
        rows = season.staff_assignments.filter(membership__project_id=season.project_id).select_related(
            "membership__member"
        )
        return page(request, rows.order_by("membership__member__display_name", "pk"), assignment_data)

    @transaction.atomic
    def put(self, request, slug, season_id, user_id=None):
        if not user_id:
            raise MethodNotAllowed(request.method)
        workspace = admin_workspace(request, slug, lock=True)
        season = self.season(workspace, season_id)
        project = get_object_or_404(Project.objects.select_for_update(), pk=season.project_id, archived_at__isnull=True)
        get_object_or_404(staff_members(workspace), member_id=user_id)
        payload = AssignmentInput(data=request.data)
        payload.is_valid(raise_exception=True)
        values = payload.validated_data
        role = 15 if values["assignment"] == "coach" else 5
        member = ProjectMember.objects.filter(project=project, member_id=user_id).first()
        if member and (member.role == 1 or not member.is_active):
            raise ValidationError("Restore or update this program membership before assigning staff.")
        if not member:
            if ProjectMember.all_objects.filter(project=project, member_id=user_id).exists():
                raise ValidationError("Restore this program membership before assigning staff.")
            member = ProjectMember.objects.create(project=project, member_id=user_id, role=role)
            IssueUserProperty.objects.get_or_create(project=project, user_id=user_id)
        elif values["assignment"] == "coach" and member.role == 5:
            member.role = 15
            member.save(update_fields=["role", "updated_at"])
        row, _ = TeamSeasonStaff.objects.update_or_create(membership=member, defaults={"season": season, **values})
        return Response(assignment_data(row), headers=PRIVATE)

    @transaction.atomic
    def delete(self, request, slug, season_id, user_id=None):
        if not user_id:
            raise MethodNotAllowed(request.method)
        season = self.season(admin_workspace(request, slug, lock=True), season_id)
        season.staff_assignments.filter(
            membership__project_id=season.project_id, membership__member_id=user_id
        ).delete()
        return Response(status=204, headers=PRIVATE)


class SchoolRosterFilters(serializers.Serializer):
    season = serializers.UUIDField(required=False)
    search = serializers.CharField(max_length=100, allow_blank=True, required=False)


class SchoolRosterEndpoint(RosterStaffAPIView):
    def get(self, request, slug):
        workspace = admin_workspace(request, slug)
        filters = SchoolRosterFilters(data=request.query_params)
        filters.is_valid(raise_exception=True)
        values = filters.validated_data
        rows = RosterPlayer.objects.filter(
            workspace=workspace, project__workspace=workspace, project__deleted_at__isnull=True
        ).exclude(status="removed")
        if "season" in values:
            rows = rows.filter(project__team_season__pk=values["season"])
        if values.get("search"):
            rows = rows.filter(player_name__icontains=values["search"])
        rows = rows.select_related("project", "project__team_season").annotate(
            pending=Exists(
                PlayerRegistrationRequest.objects.filter(roster_player_id=OuterRef("pk"), approved_at__isnull=True)
            )
        )
        return page(
            request,
            rows.order_by("player_name", "pk"),
            lambda player: {
                "id": player.pk,
                "player_name": player.player_name,
                "jersey_number": player.jersey_number,
                "class_year": player.class_year,
                "status": player.status,
                "account_status": "held"
                if player.account_link_held
                else "pending"
                if player.pending
                else "linked"
                if player.user_id
                else "unlinked",
                "program": player.project.name,
                "project_id": player.project_id,
                "season_label": getattr(getattr(player.project, "team_season", None), "season_label", ""),
            },
        )


def has_roster_grant(user, project):
    return (
        user.is_active
        and not user.is_bot
        and not project.archived_at
        and staff_members(project.workspace).filter(member=user).exists()
        and TeamSeasonStaff.objects.filter(
            season__project=project,
            season__team__workspace_id=project.workspace_id,
            season__team__deleted_at__isnull=True,
            membership__project=project,
            membership__member=user,
            membership__role__in=(5, *STAFF),
            membership__is_active=True,
            membership__deleted_at__isnull=True,
            manage_roster=True,
        ).exists()
    )


class DelegatedRosterEndpoint(RosterStaffAPIView):
    def project(self, request, slug, project_id, *, lock=False):
        workspace = get_object_or_404(Workspace.objects.select_for_update() if lock else Workspace, slug=slug)
        query = Project.objects.select_for_update() if lock else Project
        project = get_object_or_404(query, workspace=workspace, pk=project_id)
        if not has_roster_grant(request.user, project):
            raise PermissionDenied("A roster delegation for this season is required.")
        return project

    def get(self, request, slug, project_id, player_id=None):
        if player_id:
            raise MethodNotAllowed(request.method)
        project = self.project(request, slug, project_id)
        rows = RosterPlayer.objects.filter(project=project, status__in=("active", "injured")).order_by(
            "player_name", "pk"
        )
        return page(request, rows, self.present)

    @staticmethod
    def present(row):
        return {"id": row.pk, "updated_at": row.updated_at, **{key: getattr(row, key) for key in ROSTER_FIELDS}}

    def save(self, request, project, player=None):
        data = request.data.copy()
        if player:
            timestamp = serializers.DateTimeField().run_validation(data.pop("expected_updated_at", None))
            if timestamp != player.updated_at:
                return Response(
                    {"detail": "This roster row changed. Refresh and try again."}, status=409, headers=PRIVATE
                )
        if not data or set(data) - set(ROSTER_FIELDS):
            raise ValidationError(
                "Only name, jersey number, position and graduation year may be edited with this grant."
            )
        serializer = RosterPlayerSerializer(
            player, data=data, partial=bool(player), context={"project": project, "request": request}
        )
        serializer.is_valid(raise_exception=True)
        return Response(self.present(serializer.save()), status=200 if player else 201, headers=PRIVATE)

    @transaction.atomic
    def post(self, request, slug, project_id, player_id=None):
        if player_id:
            raise MethodNotAllowed(request.method)
        return self.save(request, self.project(request, slug, project_id, lock=True))

    @transaction.atomic
    def patch(self, request, slug, project_id, player_id=None):
        if not player_id:
            raise MethodNotAllowed(request.method)
        project = self.project(request, slug, project_id, lock=True)
        player = get_object_or_404(
            RosterPlayer.objects.select_for_update(), project=project, pk=player_id, status__in=("active", "injured")
        )
        return self.save(request, project, player)
