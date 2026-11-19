"""Revocable, program-scoped shared athlete registration sessions."""

import uuid

from django.db import models

from .project import ProjectBaseModel


class PlayerRegistrationSession(ProjectBaseModel):
    nonce = models.UUIDField(default=uuid.uuid4, editable=False)
    expires_at = models.DateTimeField()
    closed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "player_registration_sessions"
        ordering = ("-created_at",)


class PlayerRegistrationRequest(ProjectBaseModel):
    user = models.ForeignKey("db.User", on_delete=models.CASCADE, related_name="player_registration_requests")
    roster_player = models.OneToOneField(
        "db.RosterPlayer", on_delete=models.CASCADE, related_name="registration_request"
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.ForeignKey(
        "db.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="approved_player_registrations"
    )

    class Meta:
        db_table = "player_registration_requests"
        ordering = ("-created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["project", "user"],
                condition=models.Q(deleted_at__isnull=True),
                name="unique_program_player_registration",
            )
        ]
