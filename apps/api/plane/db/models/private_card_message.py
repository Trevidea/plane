"""Private messages are deliberately separate from shared IssueComment consumers."""

import uuid
from django.conf import settings
from django.db import models


class CoachingCardPrivateMessage(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    issue = models.ForeignKey("db.Issue", on_delete=models.CASCADE, related_name="private_player_messages")
    coach = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="private_coach_messages")
    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="private_player_messages"
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="authored_private_card_messages"
    )
    comment_html = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    edited_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "coaching_card_private_messages"
        ordering = ("created_at", "id")
        indexes = [models.Index(fields=["issue", "coach", "recipient", "created_at"], name="private_card_audience_idx")]
        constraints = [
            models.CheckConstraint(
                check=models.Q(actor=models.F("coach")) | models.Q(actor=models.F("recipient")),
                name="private_card_actor_participant",
            )
        ]
