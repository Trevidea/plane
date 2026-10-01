from django.conf import settings
from django.db import migrations, models
from django.db.models import Q
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0128_project_default_swimlane_view"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="rosterplayer",
            name="user",
            field=models.ForeignKey(
                to=settings.AUTH_USER_MODEL,
                on_delete=django.db.models.deletion.SET_NULL,
                null=True,
                blank=True,
            ),
        ),
        migrations.AddConstraint(
            model_name="rosterplayer",
            constraint=models.UniqueConstraint(
                fields=("project", "user"),
                condition=Q(deleted_at__isnull=True, user__isnull=False),
                name="roster_player_unique_project_user_when_active",
            ),
        ),
    ]
