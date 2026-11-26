from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("db", "0146_player_password_reset")]

    operations = [
        migrations.CreateModel(
            name="RosterImportReceipt",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("import_id", models.UUIDField()),
                ("fingerprint", models.CharField(max_length=64)),
                ("player_ids", models.JSONField()),
                ("actor", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE, related_name="+", to=settings.AUTH_USER_MODEL,
                )),
                ("project", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE, related_name="+", to="db.project",
                )),
            ],
            options={"db_table": "roster_import_receipts"},
        ),
        migrations.AddConstraint(
            model_name="rosterimportreceipt",
            constraint=models.UniqueConstraint(
                fields=("project", "actor", "import_id"), name="unique_roster_import_receipt",
            ),
        ),
    ]
