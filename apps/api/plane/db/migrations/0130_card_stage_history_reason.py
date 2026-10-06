from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("db", "0129_roster_player_user")]

    operations = [
        migrations.AddField(
            model_name="cardstagehistory",
            name="reason",
            field=models.CharField(blank=True, default="", max_length=2000),
        ),
    ]
