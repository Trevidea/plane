from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):
    dependencies = [("db", "0134_private_card_messages")]
    operations = [
        migrations.AlterField(
            model_name="coachingcardprivatemessage", name="comment_html", field=models.TextField(blank=True)
        ),
        migrations.AddField(
            model_name="coachingcardprivatemessage",
            name="client_id",
            field=models.CharField(max_length=128, null=True, blank=True),
        ),
        migrations.AddField(
            model_name="coachingcardprivatemessage",
            name="request_hash",
            field=models.CharField(max_length=64, blank=True),
        ),
        migrations.AddConstraint(
            model_name="coachingcardprivatemessage",
            constraint=models.UniqueConstraint(
                fields=["issue", "coach", "recipient", "actor", "client_id"], name="private_message_client_id"
            ),
        ),
        migrations.CreateModel(
            name="CoachingCardPrivateAttachment",
            fields=[
                ("id", models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, serialize=False)),
                ("kind", models.CharField(max_length=16)),
                ("name", models.CharField(max_length=255)),
                ("size", models.PositiveBigIntegerField(default=0)),
                ("duration", models.FloatField(default=0)),
                ("source", models.JSONField(default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("expires_at", models.DateTimeField(db_index=True)),
                ("issue", models.ForeignKey(to="db.issue", on_delete=django.db.models.deletion.CASCADE)),
                (
                    "coach",
                    models.ForeignKey(
                        to=settings.AUTH_USER_MODEL, on_delete=django.db.models.deletion.CASCADE, related_name="+"
                    ),
                ),
                (
                    "recipient",
                    models.ForeignKey(
                        to=settings.AUTH_USER_MODEL, on_delete=django.db.models.deletion.CASCADE, related_name="+"
                    ),
                ),
                (
                    "actor",
                    models.ForeignKey(
                        to=settings.AUTH_USER_MODEL, on_delete=django.db.models.deletion.CASCADE, related_name="+"
                    ),
                ),
                (
                    "message",
                    models.OneToOneField(
                        to="db.coachingcardprivatemessage",
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="clip_attachment",
                        null=True,
                        blank=True,
                    ),
                ),
            ],
            options={"db_table": "coaching_card_private_attachments"},
        ),
        migrations.AddConstraint(
            model_name="coachingcardprivateattachment",
            constraint=models.CheckConstraint(
                check=models.Q(actor=models.F("coach")) | models.Q(actor=models.F("recipient")),
                name="private_clip_actor_participant",
            ),
        ),
    ]
