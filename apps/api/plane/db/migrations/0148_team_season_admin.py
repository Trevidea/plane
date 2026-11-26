from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("db", "0147_roster_import_receipt")]

    operations = [
        migrations.AddField(model_name="rosterevent", name="previous_account_id", field=models.UUIDField(null=True)),
        migrations.AddField(model_name="rosterevent", name="replacement_account_id", field=models.UUIDField(null=True)),
        migrations.AddConstraint(
            model_name="teamseason",
            constraint=models.UniqueConstraint(fields=("team", "season_label"), name="unique_team_season_label"),
        ),
        migrations.CreateModel(
            name="TeamSeasonStaff",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="Created At")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="Last Modified At")),
                ("assignment", models.CharField(choices=[("coach", "Coach"), ("operator", "Operator")], max_length=12)),
                ("manage_roster", models.BooleanField(default=False)),
                (
                    "membership",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE, related_name="season_staff", to="db.projectmember"
                    ),
                ),
                (
                    "season",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="staff_assignments",
                        to="db.teamseason",
                    ),
                ),
            ],
            options={"db_table": "team_season_staff"},
        ),
    ]
