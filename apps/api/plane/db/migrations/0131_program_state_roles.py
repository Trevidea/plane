"""Bind editable program labels to roles and separate verification from closure."""

from django.db import migrations, models


def bind_program_roles(apps, schema_editor):
    Project = apps.get_model("db", "Project")
    State = apps.get_model("db", "State")
    alias = schema_editor.connection.alias
    manager = State._base_manager.using(alias)
    projects = (
        Project._base_manager.using(alias).filter(deleted_at__isnull=True).exclude(sport__isnull=True).exclude(sport="")
    )
    for project in projects.iterator():
        states = list(
            manager.filter(project_id=project.id, deleted_at__isnull=True, is_triage=False).order_by("sequence", "id")
        )
        if any(state.lifecycle_role for state in states):
            continue

        def pick(group, exclude=()):
            members = [state for state in states if state.group == group and state.id not in exclude]
            return next((state for state in members if state.default), members[0] if members else None)

        initial, assigned, reviewed, completed = [
            pick(group) for group in ("backlog", "unstarted", "started", "completed")
        ]
        # Do not invent an entire lifecycle for incomplete event-only boards.
        if not all((initial, assigned, reviewed, completed)):
            continue

        def create(name, group, color):
            existing_names = {state.name for state in states}
            candidate, suffix = name, 2
            while candidate in existing_names:
                candidate = f"{name} ({suffix})"
                suffix += 1
            state = manager.create(
                project_id=project.id,
                workspace_id=project.workspace_id,
                name=candidate,
                group=group,
                color=color,
                sequence=max((state.sequence for state in states), default=0) + 15000,
                default=False,
            )
            states.append(state)
            return state

        cancelled = pick("cancelled")
        # Interpret the screenshot's legacy label once, never during runtime.
        verified_was_cancelled = cancelled and cancelled.name.strip().casefold() in {"verified", "verified on film"}
        if verified_was_cancelled:
            practice, verified = completed, cancelled
            manager.filter(pk=verified.id).update(
                group="completed",
                color="#46A758",
                sequence=max(state.sequence for state in states if state.group == "completed") + 15000,
            )
            verified.group = "completed"
        else:
            verified = completed
            practice = pick("started", exclude=(reviewed.id,)) or create("Practice check", "started", "#F59E0B")
        closed = pick("cancelled", exclude=(verified.id,)) or create("Closed", "cancelled", "#9AA4BC")
        for role, state in zip(
            ("identified", "assigned", "reviewed", "practice", "verified", "closed"),
            (initial, assigned, reviewed, practice, verified, closed),
        ):
            manager.filter(pk=state.id).update(lifecycle_role=role)


class Migration(migrations.Migration):
    dependencies = [("db", "0130_card_stage_history_reason")]
    operations = [
        migrations.AddField(
            model_name="state",
            name="lifecycle_role",
            field=models.CharField(
                blank=True,
                default="",
                max_length=20,
                choices=[
                    ("identified", "Identified"),
                    ("assigned", "Assigned"),
                    ("reviewed", "Player reviewed"),
                    ("practice", "Practice check"),
                    ("verified", "Verified"),
                    ("closed", "Closed"),
                ],
            ),
        ),
        migrations.RunPython(bind_program_roles, migrations.RunPython.noop),
    ]
