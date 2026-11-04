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
    comment_html = models.TextField(blank=True)
    client_id = models.CharField(max_length=128, null=True, blank=True)
    request_hash = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    edited_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "coaching_card_private_messages"
        ordering = ("created_at", "id")
        indexes = [models.Index(fields=["issue", "coach", "recipient", "created_at"], name="private_card_audience_idx")]
        constraints = [
            models.UniqueConstraint(
                fields=["issue", "coach", "recipient", "actor", "client_id"], name="private_message_client_id"
            ),
            models.CheckConstraint(
                check=models.Q(actor=models.F("coach")) | models.Q(actor=models.F("recipient")),
                name="private_card_actor_participant",
            ),
        ]


class CoachingCardPrivateAttachment(models.Model):
    """Private storage is never represented by a shared IssueAttachment/Asset."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    issue = models.ForeignKey("db.Issue", on_delete=models.CASCADE)
    coach = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    recipient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    message = models.OneToOneField(
        CoachingCardPrivateMessage, null=True, blank=True, on_delete=models.SET_NULL, related_name="clip_attachment"
    )
    kind = models.CharField(max_length=16)
    name = models.CharField(max_length=255)
    size = models.PositiveBigIntegerField(default=0)
    duration = models.FloatField(default=0)
    source = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(db_index=True)
    consumed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "coaching_card_private_attachments"
        constraints = [
            models.CheckConstraint(
                check=models.Q(actor=models.F("coach")) | models.Q(actor=models.F("recipient")),
                name="private_clip_actor_participant",
            )
        ]
