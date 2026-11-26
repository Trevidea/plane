import uuid

from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import F, Q

from plane.db.mixins import TimeAuditModel


class TeamSeason(TimeAuditModel):
    """A season uses one existing Program as its roster and event boundary."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.OneToOneField("db.Project", on_delete=models.CASCADE, related_name="team_season")
    team = models.ForeignKey("db.Team", on_delete=models.SET_NULL, related_name="seasons", null=True, blank=True)
    season_label = models.CharField(max_length=20, blank=True, default="")
    sport = models.CharField(max_length=100, blank=True, default="")
    division = models.CharField(max_length=100, blank=True, default="")
    level = models.CharField(max_length=100, blank=True, default="")
    starts_on = models.DateField(null=True, blank=True)
    ends_on = models.DateField(null=True, blank=True)

    class Meta:
        db_table = "team_seasons"
        constraints = [
            models.CheckConstraint(
                check=Q(starts_on__isnull=True) | Q(ends_on__isnull=True) | Q(starts_on__lte=F("ends_on")),
                name="team_season_ordered_dates",
            ),
            models.UniqueConstraint(fields=["team", "season_label"], name="unique_team_season_label"),
        ]

    def save(self, *args, **kwargs):
        if self.team_id and (self.team.workspace_id != self.project.workspace_id or self.team.deleted_at):
            raise ValidationError({"team": "Select an active team in the program's workspace."})
        return super().save(*args, **kwargs)


class TeamSeasonStaff(TimeAuditModel):
    season = models.ForeignKey(TeamSeason, on_delete=models.CASCADE, related_name="staff_assignments")
    membership = models.OneToOneField("db.ProjectMember", on_delete=models.CASCADE, related_name="season_staff")
    assignment = models.CharField(max_length=12, choices=[("coach", "Coach"), ("operator", "Operator")])
    manage_roster = models.BooleanField(default=False)

    class Meta:
        db_table = "team_season_staff"


class RosterJerseyAssignment(TimeAuditModel):
    """An observed, half-open jersey assignment: [valid_from, valid_to)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    team_season = models.ForeignKey(TeamSeason, on_delete=models.CASCADE, related_name="jersey_assignments")
    roster_player = models.ForeignKey("db.RosterPlayer", on_delete=models.CASCADE, related_name="jersey_assignments")
    jersey_number = models.CharField(max_length=20)
    valid_from = models.DateTimeField()
    valid_to = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "roster_jersey_assignments"
        indexes = [
            models.Index(fields=["team_season", "jersey_number", "valid_from"], name="roster_jersey_at_time_idx")
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["team_season", "jersey_number"],
                condition=Q(valid_to__isnull=True),
                name="roster_jersey_one_open_per_number",
            ),
            models.UniqueConstraint(
                fields=["roster_player"], condition=Q(valid_to__isnull=True), name="roster_jersey_one_open_per_player"
            ),
            models.CheckConstraint(
                check=Q(valid_to__isnull=True) | Q(valid_to__gte=F("valid_from")),
                name="roster_jersey_ordered_dates",
            ),
        ]
