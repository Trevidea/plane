"""Persist six default states for existing sport programs with no configured states."""

from django.db import migrations
from django.template.defaultfilters import slugify


DEFAULT_STATES = (
    ("Identify", "identified", "backlog", "#60646C"),
    ("To Review", "assigned", "unstarted", "#60646C"),
    ("Action Required", "reviewed", "started", "#F59E0B"),
    ("In Progress", "practice", "started", "#F59E0B"),
    ("Verified", "verified", "completed", "#46A758"),
    ("Closed", "closed", "cancelled", "#9AA4BC"),
)


def seed_empty_program_states(apps, schema_editor):
    Project = apps.get_model("db", "Project")
    State = apps.get_model("db", "State")
    alias = schema_editor.connection.alias
    manager = State._base_manager.using(alias)
    projects = (
        Project._base_manager.using(alias).filter(deleted_at__isnull=True).exclude(sport__isnull=True).exclude(sport="")
    )
    default_names = {definition[0] for definition in DEFAULT_STATES}
    for project in projects.iterator():
        existing = list(manager.filter(project_id=project.id, deleted_at__isnull=True).values("name", "is_triage"))
        # Existing configuration, including custom triage names, belongs to coaches.
        if any(not state["is_triage"] or state["name"] in default_names for state in existing):
            continue
        manager.bulk_create(
            [
                State(
                    project_id=project.id,
                    workspace_id=project.workspace_id,
                    name=name,
                    slug=slugify(name),
                    lifecycle_role=role,
                    group=group,
                    color=color,
                    sequence=5000 + index * 10000,
                    default=index == 0,
                )
                for index, (name, role, group, color) in enumerate(DEFAULT_STATES)
            ]
        )


class Migration(migrations.Migration):
    dependencies = [("db", "0132_program_state_defaults")]
    operations = [migrations.RunPython(seed_empty_program_states, migrations.RunPython.noop)]
