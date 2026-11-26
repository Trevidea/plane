from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0141_project_event_metadata"),
    ]

    operations = [
        migrations.AddField(
            model_name="playerregistrationsession",
            name="join_code",
            field=models.CharField(max_length=8, null=True, blank=True, unique=True),
        ),
    ]
