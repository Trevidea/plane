import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("db", "0149_roster_account_link_hold")]

    operations = [
        migrations.CreateModel(
            name="RosterNotice",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="Created At")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="Last Modified At")),
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                (
                    "kind",
                    models.CharField(
                        choices=[
                            ("join_requested", "Join requested"),
                            ("request_approved", "Request approved"),
                            ("team_added", "Team added"),
                            ("status_changed", "Status changed"),
                        ],
                        max_length=20,
                    ),
                ),
                ("event_id", models.UUIDField()),
                ("roster_identity", models.UUIDField()),
                ("status", models.CharField(blank=True, default="", max_length=12)),
                ("read_at", models.DateTimeField(blank=True, null=True)),
                (
                    "project",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE, related_name="roster_notices", to="db.project"
                    ),
                ),
                (
                    "receiver",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE, related_name="roster_notices", to="db.user"
                    ),
                ),
            ],
            options={
                "db_table": "roster_notices",
                "indexes": [models.Index(fields=["receiver", "-created_at", "-id"], name="roster_notice_inbox_idx")],
                "constraints": [
                    models.UniqueConstraint(
                        fields=("receiver", "kind", "event_id"), name="roster_notice_recipient_event"
                    )
                ],
            },
        ),
    ]
