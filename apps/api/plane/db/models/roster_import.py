from django.conf import settings
from django.db import models


class RosterImportReceipt(models.Model):
    project = models.ForeignKey("db.Project", on_delete=models.CASCADE, related_name="+")
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    import_id = models.UUIDField()
    fingerprint = models.CharField(max_length=64)
    player_ids = models.JSONField()

    class Meta:
        db_table = "roster_import_receipts"
        constraints = [
            models.UniqueConstraint(fields=["project", "actor", "import_id"], name="unique_roster_import_receipt")
        ]
