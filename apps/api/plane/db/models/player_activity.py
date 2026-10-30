from django.conf import settings
from django.core.validators import MaxValueValidator
from django.db import models
from .project import ProjectBaseModel


class PlayerActivityProgress(ProjectBaseModel):
    issue = models.ForeignKey("db.Issue", on_delete=models.CASCADE, related_name="player_progress")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    percent = models.PositiveSmallIntegerField(default=0, validators=[MaxValueValidator(100)])
    note = models.TextField(blank=True, default="")
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "player_activity_progress"
        constraints = [
            models.UniqueConstraint(
                fields=["issue", "user"],
                condition=models.Q(deleted_at__isnull=True),
                name="player_progress_unique_issue_user",
            )
        ]
