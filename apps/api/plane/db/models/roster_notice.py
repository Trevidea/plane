from uuid import uuid4

from django.db import models

from plane.db.mixins import TimeAuditModel


class RosterNoticeKind(models.TextChoices):
    JOIN_REQUESTED = "join_requested", "Join requested"
    REQUEST_APPROVED = "request_approved", "Request approved"
    TEAM_ADDED = "team_added", "Team added"
    STATUS_CHANGED = "status_changed", "Status changed"


class RosterNotice(TimeAuditModel):
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    project = models.ForeignKey("db.Project", on_delete=models.CASCADE, related_name="roster_notices")
    receiver = models.ForeignKey("db.User", on_delete=models.CASCADE, related_name="roster_notices")
    kind = models.CharField(max_length=20, choices=RosterNoticeKind.choices)
    event_id = models.UUIDField()
    roster_identity = models.UUIDField()
    status = models.CharField(max_length=12, blank=True, default="")
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "roster_notices"
        indexes = [models.Index(fields=["receiver", "-created_at", "-id"], name="roster_notice_inbox_idx")]
        constraints = [
            models.UniqueConstraint(fields=["receiver", "kind", "event_id"], name="roster_notice_recipient_event")
        ]
