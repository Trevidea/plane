from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("db", "0133_empty_program_state_defaults")]

    operations = [
        migrations.AddField(
            model_name="rosterplayer",
            name="email",
            field=models.EmailField(max_length=254, blank=True, default=""),
        ),
        migrations.AddConstraint(
            model_name="rosterplayer",
            constraint=models.UniqueConstraint(
                fields=("project", "email"),
                condition=models.Q(deleted_at__isnull=True) & ~models.Q(email=""),
                name="roster_player_unique_program_email",
            ),
        ),
    ]
