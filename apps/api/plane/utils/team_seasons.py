from django.db.models import F, Q
from django.db.models.functions import Greatest
from django.utils import timezone

from plane.db.models import RosterJerseyAssignment, RosterPlayerStatus, TeamSeason


def ensure_program_season(project):
    """Snapshot defaults once. A program edit must not move its existing roster to another season."""
    season, _ = TeamSeason.objects.get_or_create(
        project=project,
        defaults={
            "season_label": (project.event_season or "").strip(),
            "sport": (project.sport or "").strip(),
            "division": (project.event_program or "").strip(),
            "level": (project.event_level or "").strip(),
        },
    )
    return season


def sync_jersey_assignment(player, *, team_season=None):
    """Called within the roster mutation transaction, after taking the program lock."""
    if team_season is None:
        team_season = ensure_program_season(player.project)
    if team_season.project_id != player.project_id:
        raise ValueError("Roster jersey assignment must belong to the player's program.")

    jersey = player.jersey_number if player.status in (RosterPlayerStatus.ACTIVE, RosterPlayerStatus.INJURED) else None
    assignments = RosterJerseyAssignment.objects.filter(roster_player=player, valid_to__isnull=True)
    current = assignments.first()
    if current and current.jersey_number == jersey:
        return

    at = timezone.now()
    if current:
        at = max(at, current.valid_from)
        assignments.update(valid_to=at, updated_at=at)
    if jersey:
        # Preserve ordering after a backwards clock step, including when the prior wearer is different.
        latest_end = (
            RosterJerseyAssignment.objects.filter(team_season=team_season, jersey_number=jersey)
            .exclude(valid_to__isnull=True)
            .order_by("-valid_to")
            .values_list("valid_to", flat=True)
            .first()
        )
        RosterJerseyAssignment.objects.create(
            team_season=team_season, roster_player=player, jersey_number=jersey, valid_from=max(at, latest_end or at)
        )


def close_jersey_assignments(roster_ids):
    at = timezone.now()
    RosterJerseyAssignment.objects.filter(roster_player_id__in=roster_ids, valid_to__isnull=True).update(
        valid_to=Greatest(F("valid_from"), at), updated_at=at
    )


def roster_players_at_jerseys(team_season, jersey_numbers, at):
    """Resolve only numbers with exactly one known owner at the requested time."""
    owners = {}
    assignments = (
        RosterJerseyAssignment.objects.filter(
            team_season=team_season, jersey_number__in=jersey_numbers, valid_from__lte=at
        )
        .filter(Q(valid_to__gt=at) | Q(valid_to__isnull=True))
        .values_list("jersey_number", "roster_player_id")
    )
    for jersey_number, player_id in assignments:
        owners[jersey_number] = None if jersey_number in owners else player_id
    return {number: player_id for number, player_id in owners.items() if player_id is not None}


def roster_player_at_jersey(team_season, jersey_number, at):
    return roster_players_at_jerseys(team_season, [jersey_number], at).get(jersey_number)
