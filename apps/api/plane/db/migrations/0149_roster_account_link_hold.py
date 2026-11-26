from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("db", "0148_team_season_admin")]

    operations = [
        migrations.AddField(
            model_name="rosterplayer", name="account_link_held", field=models.BooleanField(default=False)
        ),
        migrations.AddConstraint(
            model_name="rosterplayer",
            constraint=models.CheckConstraint(
                check=models.Q(account_link_held=False) | models.Q(user__isnull=True, email=""),
                name="roster_held_link_requires_empty_account",
            ),
        ),
    ]
