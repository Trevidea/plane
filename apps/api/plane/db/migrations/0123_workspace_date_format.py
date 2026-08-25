from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0122_drop_stale_customplaylist_annotations"),
    ]

    operations = [
        migrations.AddField(
            model_name="workspace",
            name="date_format",
            field=models.CharField(
                choices=[
                    ("MM/DD/YYYY", "MM/DD/YYYY"),
                    ("DD/MM/YYYY", "DD/MM/YYYY"),
                    ("YYYY-MM-DD", "YYYY-MM-DD"),
                ],
                default="MM/DD/YYYY",
                max_length=16,
            ),
        ),
    ]
