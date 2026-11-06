from django.db import migrations, models


def protect_previous_uploads(apps, schema_editor):
    # A detached upload may previously have belonged to a deleted message.
    # Conservatively retire pre-upgrade uploads instead of making those reusable.
    attachment = apps.get_model("db", "CoachingCardPrivateAttachment")
    attachment.objects.using(schema_editor.connection.alias).update(consumed_at=models.F("created_at"))


class Migration(migrations.Migration):
    dependencies = [("db", "0135_private_conversation_clips")]
    operations = [
        migrations.AddField(
            model_name="coachingcardprivateattachment",
            name="consumed_at",
            field=models.DateTimeField(null=True, blank=True),
        ),
        migrations.RunPython(protect_previous_uploads, migrations.RunPython.noop),
    ]
