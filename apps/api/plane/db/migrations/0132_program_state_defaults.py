"""Update standard program labels while preserving state IDs and lifecycle roles."""

from uuid import uuid4

from django.db import migrations
from django.template.defaultfilters import slugify


# Freeze known default labels here; custom labels continue to belong to coaches.
DEFAULT_LABELS = {
    "identified": ("Identify", {"identified", "unassigned", "to review", "backlog"}),
    "assigned": ("To Review", {"assigned", "action required", "todo"}),
    "reviewed": ("Action Required", {"in work", "player reviewed", "in progress"}),
    "practice": ("In Progress", {"ready for coach review", "practice check"}),
    "verified": ("Verified", {"resolved", "verified on film", "done"}),
    "closed": ("Closed", {"cancelled"}),
}


def update_program_state_defaults(apps, schema_editor):
    Project = apps.get_model("db", "Project")
    State = apps.get_model("db", "State")
    alias = schema_editor.connection.alias
    manager = State._base_manager.using(alias)
    projects = (
        Project._base_manager.using(alias).filter(deleted_at__isnull=True).exclude(sport__isnull=True).exclude(sport="")
    )
    for project in projects.iterator():
        states = list(manager.filter(project_id=project.id, deleted_at__isnull=True))
        renames = []
        for state in states:
            definition = DEFAULT_LABELS.get(state.lifecycle_role)
            if not definition or state.is_triage:
                continue
            name, old_names = definition
            if state.name.strip().casefold() in old_names:
                renames.append((state.id, name))

        renamed_ids = {state_id for state_id, _ in renames}
        target_names = [name for _, name in renames]
        occupied = {state.name for state in states if state.id not in renamed_ids}
        # Leave ambiguous programs for an explicit edit rather than overwrite a
        # custom state or violate the project's unique-name constraint.
        if len(set(target_names)) != len(target_names) or occupied.intersection(target_names):
            continue

        # Legacy labels overlap new labels (for example To Review -> Identify).
        # Vacate all old names before assigning the final names in this atomic migration.
        occupied = {state.name for state in states}
        for state_id, _ in renames:
            temporary_name = f"__program_state_{uuid4().hex}__"
            while temporary_name in occupied:
                temporary_name = f"__program_state_{uuid4().hex}__"
            occupied.add(temporary_name)
            manager.filter(pk=state_id).update(name=temporary_name)
        for state_id, name in renames:
            manager.filter(pk=state_id).update(name=name, slug=slugify(name))


class Migration(migrations.Migration):
    dependencies = [("db", "0131_program_state_roles")]
    operations = [migrations.RunPython(update_program_state_defaults, migrations.RunPython.noop)]
