from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("db", "0125_issue_coaching_card_fields")]

    operations = [
        migrations.AddField(
            model_name="issue",
            name="position_group",
            field=models.CharField(blank=True, max_length=100, null=True),
        ),
    ]
