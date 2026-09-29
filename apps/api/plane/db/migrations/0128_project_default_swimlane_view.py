from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("db", "0127_card_stage_history")]

    operations = [
        migrations.AddField(
            model_name="project",
            name="default_swimlane_view",
            field=models.CharField(
                choices=[
                    ("stage", "By Stage"),
                    ("coach", "By Coach"),
                    ("player", "By Player"),
                    ("card_type", "By Card Type"),
                    ("priority", "By Priority"),
                    ("aging", "By Aging"),
                ],
                default="stage",
                max_length=20,
            ),
        ),
    ]
