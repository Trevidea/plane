from itertools import islice

from django.db import migrations, transaction
from django.db.models import Exists, OuterRef, Q
from django.utils import timezone


def backfill(apps, schema_editor):
    database = schema_editor.connection.alias
    Project = apps.get_model("db", "Project")
    RosterPlayer = apps.get_model("db", "RosterPlayer")
    TeamSeason = apps.get_model("db", "TeamSeason")
    Assignment = apps.get_model("db", "RosterJerseyAssignment")

    rosters = RosterPlayer.objects.using(database).filter(deleted_at__isnull=True)
    projects = (
        Project.objects.using(database)
        .filter(deleted_at__isnull=True, workspace__deleted_at__isnull=True)
        .annotate(has_roster=Exists(rosters.filter(project_id=OuterRef("pk"))))
        .filter(Q(has_roster=True) | Q(sport__gt="") | Q(event_season__gt=""))
        .order_by("pk")
        .values("id", "event_season", "sport", "event_program", "event_level")
        .iterator(chunk_size=250)
    )
    observed_at = timezone.now()
    while batch := list(islice(projects, 250)):
        with transaction.atomic(using=database):
            TeamSeason.objects.using(database).bulk_create(
                [
                    TeamSeason(
                        project_id=row["id"],
                        season_label=(row["event_season"] or "").strip(),
                        sport=(row["sport"] or "").strip(),
                        division=(row["event_program"] or "").strip(),
                        level=(row["event_level"] or "").strip(),
                    )
                    for row in batch
                ],
                ignore_conflicts=True,
            )
            season_ids = dict(
                TeamSeason.objects.using(database)
                .filter(project_id__in=[row["id"] for row in batch])
                .values_list("project_id", "id")
            )
            players = (
                rosters.filter(project_id__in=season_ids, status__in=("active", "injured"), jersey_number__gt="")
                .exclude(jersey_assignments__isnull=False)
                .order_by("pk")
                .values_list("id", "project_id", "jersey_number")
                .iterator(chunk_size=500)
            )
            while jerseys := list(islice(players, 500)):
                # A current jersey is evidence only as of this observation, not when old footage was tagged.
                Assignment.objects.using(database).bulk_create(
                    [
                        Assignment(
                            team_season_id=season_ids[project_id],
                            roster_player_id=player_id,
                            jersey_number=number,
                            valid_from=observed_at,
                        )
                        for player_id, project_id, number in jerseys
                    ],
                    ignore_conflicts=True,
                )


class Migration(migrations.Migration):
    atomic = False
    dependencies = [("db", "0142_team_season_foundation")]
    # No original records are updated; rolling back the schema removes only these additive tables.
    operations = [migrations.RunPython(backfill, migrations.RunPython.noop, atomic=False)]
