from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0140_roster_lifecycle"),
    ]

    operations = [
        migrations.AddField(
            model_name="project",
            name="event_season",
            field=models.CharField(max_length=20, null=True, blank=True),
        ),
        migrations.AddField(
            model_name="project",
            name="event_program",
            field=models.CharField(max_length=100, null=True, blank=True),
        ),
        migrations.AddField(
            model_name="project",
            name="event_level",
            field=models.CharField(max_length=100, null=True, blank=True),
        ),
    ]
