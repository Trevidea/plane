from django.conf import settings
from django.db import models
from django.utils import timezone

from .base import BaseModel


class CardStageHistory(BaseModel):
    issue = models.ForeignKey("db.Issue", on_delete=models.CASCADE, related_name="card_stage_history")
    from_stage_id = models.UUIDField()
    from_stage_name = models.CharField(max_length=255)
    to_stage_id = models.UUIDField()
    to_stage_name = models.CharField(max_length=255)
    changed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    changed_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "card_stage_history"
        ordering = ("changed_at", "id")
