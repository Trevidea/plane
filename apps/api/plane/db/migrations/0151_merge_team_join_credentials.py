from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0142_player_registration_join_code"),
        ("db", "0150_roster_notice"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="playerregistrationsession",
            name="join_code",
        ),
    ]
