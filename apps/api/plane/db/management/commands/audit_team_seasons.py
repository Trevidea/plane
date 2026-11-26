import json

from django.core.management.base import BaseCommand, CommandError
from django.db.models import Exists, OuterRef, Q

from plane.db.models import Project, RosterJerseyAssignment, RosterPlayer, Workspace
from plane.utils.issue_datetime import parse_season_year_range


class Command(BaseCommand):
    help = "Report unresolved team-season mappings and jersey tracking gaps without changing data."

    def add_arguments(self, parser):
        parser.add_argument("--workspace", required=True, help="Workspace slug to audit")

    def handle(self, *args, **options):
        workspace = Workspace.objects.filter(slug=options["workspace"]).first()
        if workspace is None:
            raise CommandError("Workspace not found.")

        projects = (
            Project.objects.filter(workspace=workspace)
            .annotate(has_roster=Exists(RosterPlayer.objects.filter(project_id=OuterRef("pk"))))
            .filter(Q(has_roster=True) | Q(sport__gt="") | Q(event_season__gt="") | Q(team_season__isnull=False))
            .select_related("team_season__team")
            .order_by("pk")
        )
        result = {"workspace_id": str(workspace.id), "programs_checked": 0, "review": []}
        for project in projects.iterator(chunk_size=250):
            result["programs_checked"] += 1
            reasons = []
            season = getattr(project, "team_season", None)
            if season is None:
                reasons.append("season_record_missing")
            else:
                if not season.team_id:
                    reasons.append("team_not_confirmed")
                elif season.team.deleted_at or season.team.workspace_id != project.workspace_id:
                    reasons.append("team_scope_invalid")
                if not parse_season_year_range(season.season_label):
                    reasons.append("season_label_missing_or_unrecognized")
                if (project.event_season or "").strip() != season.season_label:
                    reasons.append("program_season_default_changed")
            if reasons:
                result["review"].append({"program_id": str(project.id), "reasons": reasons})

        active = RosterPlayer.objects.filter(
            project__workspace=workspace,
            project__deleted_at__isnull=True,
            status__in=("active", "injured"),
            jersey_number__gt="",
        )
        tracked = RosterJerseyAssignment.objects.filter(
            roster_player_id=OuterRef("pk"),
            team_season__project_id=OuterRef("project_id"),
            jersey_number=OuterRef("jersey_number"),
            valid_to__isnull=True,
        )
        result["untracked_roster_ids"] = [
            str(player_id) for player_id in active.filter(~Exists(tracked)).order_by("pk").values_list("pk", flat=True)
        ]
        self.stdout.write(json.dumps(result, sort_keys=True))
