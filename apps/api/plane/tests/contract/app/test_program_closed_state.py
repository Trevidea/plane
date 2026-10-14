import pytest
from rest_framework.exceptions import ValidationError as APIValidationError

from plane.db.models import CardStageHistory, Issue, Project, State
from plane.utils.coaching_card_lifecycle import get_project_card_stage_config, transition_coaching_card


def migrate_default_labels():
    import importlib
    from django.db import connection
    from django.db.migrations.loader import MigrationLoader
    from django.test import override_settings

    with override_settings(MIGRATION_MODULES={}):
        apps = MigrationLoader(None).project_state([("db", "0132_program_state_defaults")]).apps
    migration = importlib.import_module("plane.db.migrations.0132_program_state_defaults")
    with connection.schema_editor() as editor:
        migration.update_program_state_defaults(apps, editor)


@pytest.mark.django_db
@pytest.mark.parametrize(
    "names",
    [
        ["Identified", "Assigned", "In Work", "Ready for Coach Review", "Resolved", "Closed"],
        ["To Review", "Action Required", "In Progress", "Practice check", "Verified", "Closed"],
    ],
)
def test_default_labels_migrate_without_changing_roles_or_card_references(workspace, names):
    project = Project.objects.create(name="Program", identifier="LABELS", sport="Basketball", workspace=workspace)
    roles = ["identified", "assigned", "reviewed", "practice", "verified", "closed"]
    groups = ["backlog", "unstarted", "started", "started", "completed", "cancelled"]
    states = [
        State.objects.create(
            project=project, name=name, group=group, lifecycle_role=role, color="#333", default=index == 0
        )
        for index, (name, role, group) in enumerate(zip(names, roles, groups))
    ]
    cards = [
        Issue.objects.create(project=project, state=state, name=state.name, category="Coaching Card")
        for state in states
    ]
    snapshot = list(State.objects.filter(project=project).values_list("id", "group", "lifecycle_role", "default"))

    migrate_default_labels()
    migrate_default_labels()

    assert list(State.objects.filter(project=project).order_by("sequence").values_list("name", "slug")) == [
        ("Identify", "identify"),
        ("To Review", "to-review"),
        ("Action Required", "action-required"),
        ("In Progress", "in-progress"),
        ("Verified", "verified"),
        ("Closed", "closed"),
    ]
    assert list(State.objects.filter(project=project).values_list("id", "group", "lifecycle_role", "default")) == snapshot
    for card, state in zip(cards, states):
        card.refresh_from_db()
        assert card.state_id == state.id
    assert not CardStageHistory.objects.filter(issue__project=project).exists()


@pytest.mark.django_db
def test_default_label_migration_preserves_custom_names_and_programs_without_a_sport(workspace):
    project = Project.objects.create(name="Program", identifier="CUSTOM", sport="Football", workspace=workspace)
    custom = State.objects.create(
        project=project, name="Film intake", group="backlog", lifecycle_role="identified", color="#333"
    )
    assigned = State.objects.create(
        project=project, name="Assigned", group="unstarted", lifecycle_role="assigned", color="#333"
    )
    other = Project.objects.create(name="General", identifier="GENERAL", workspace=workspace)
    generic = State.objects.create(project=other, name="Backlog", group="backlog", color="#333")

    migrate_default_labels()

    custom.refresh_from_db()
    assigned.refresh_from_db()
    generic.refresh_from_db()
    assert custom.name == "Film intake"
    assert assigned.name == "To Review"
    assert generic.name == "Backlog"


@pytest.mark.django_db
def test_default_label_migration_leaves_conflicting_custom_states_untouched(workspace):
    project = Project.objects.create(name="Program", identifier="CONFLICT", sport="Football", workspace=workspace)
    initial = State.objects.create(
        project=project, name="Identified", group="backlog", lifecycle_role="identified", color="#333"
    )
    custom = State.objects.create(project=project, name="Identify", group="backlog", color="#333")

    migrate_default_labels()

    initial.refresh_from_db()
    custom.refresh_from_db()
    assert initial.name == "Identified"
    assert custom.name == "Identify"


@pytest.mark.django_db
def test_five_state_program_receives_all_six_defaults_through_migrations(workspace):
    import importlib
    from django.db import connection
    from django.apps import apps

    project = Project.objects.create(name="Basketball", identifier="FIVE", sport="Basketball", workspace=workspace)
    for name, group in [
        ("To Review", "backlog"),
        ("Action Required", "unstarted"),
        ("In Progress", "started"),
        ("Verified", "completed"),
        ("Closed", "cancelled"),
    ]:
        State.objects.create(project=project, name=name, group=group, color="#333", default=group == "backlog")
    original_state = State.objects.get(project=project, name="In Progress")
    card = Issue.objects.create(project=project, state=original_state, name="Existing card", category="Coaching Card")
    migration = importlib.import_module("plane.db.migrations.0131_program_state_roles")
    with connection.schema_editor() as editor:
        migration.bind_program_roles(apps, editor)

    migrate_default_labels()

    config = get_project_card_stage_config(project)
    assert [stage["name"] for stage in config["stages"]] == [
        "Identify", "To Review", "Action Required", "In Progress", "Verified", "Closed"
    ]
    assert State.objects.filter(project=project).count() == 6
    card.refresh_from_db()
    assert card.state_id == original_state.id


@pytest.mark.django_db
def test_card_can_close_only_after_verification_even_when_states_are_renamed(workspace, create_user):
    project = Project.objects.create(name="Program", identifier="CLOSE", sport="Football", workspace=workspace)
    states = [
        State.objects.create(
            project=project, name=f"Coach label {role}", group=group, color="#333", lifecycle_role=role
        )
        for role, group in [
            ("identified", "backlog"),
            ("assigned", "unstarted"),
            ("reviewed", "started"),
            ("practice", "started"),
            ("verified", "completed"),
            ("closed", "cancelled"),
        ]
    ]
    cancelled = State.objects.create(project=project, name="Old cancellation", group="cancelled", color="#333")
    config = get_project_card_stage_config(project)
    assert str(states[-1].id) in [stage["id"] for stage in config["stages"]]
    assert str(cancelled.id) not in [stage["id"] for stage in config["stages"]]
    card = Issue.objects.create(
        project=project,
        state=states[3],
        category="Coaching Card",
        name="Card",
        coaching_card_data={"recipient_ids": ["player"]},
    )
    with pytest.raises(APIValidationError):
        transition_coaching_card(card, states[-1].id, create_user)
    card.refresh_from_db()
    assert card.state_id == states[3].id
    assert not CardStageHistory.objects.filter(issue=card).exists()
    transition_coaching_card(card, states[4].id, create_user)
    State.objects.create(project=project, name="Legacy completed state", group="completed", color="#333")
    transition_coaching_card(card, states[5].id, create_user)
    card.refresh_from_db()
    assert card.state_id == states[5].id
    assert card.coaching_card_data["recipient_ids"] == ["player"]
    assert CardStageHistory.objects.filter(issue=card, to_stage_id=states[5].id).count() == 1
    with pytest.raises(APIValidationError):
        transition_coaching_card(card, states[4].id, create_user)
    card.refresh_from_db()
    assert card.state_id == states[5].id
    transition_coaching_card(card, states[4].id, create_user, reason="Recheck the film")
    card.refresh_from_db()
    assert card.state_id == states[4].id
    assert CardStageHistory.objects.filter(issue=card, reason="Recheck the film").count() == 1


@pytest.mark.django_db
def test_terminal_role_is_preserved_when_renamed_and_cannot_change_its_group(workspace):
    from plane.app.serializers.state import StateSerializer

    project = Project.objects.create(name="Program", identifier="BOUND", sport="Football", workspace=workspace)
    state = State.objects.create(
        project=project, name="Verified on film", group="completed", color="#333", lifecycle_role="verified"
    )
    rename = StateSerializer(state, data={"name": "Coach approved", "lifecycle_role": "closed"}, partial=True)
    assert rename.is_valid(), rename.errors
    rename.save()
    state.refresh_from_db()
    assert state.name == "Coach approved"
    assert state.lifecycle_role == "verified"
    invalid = StateSerializer(state, data={"group": "cancelled"}, partial=True)
    assert not invalid.is_valid()


@pytest.mark.django_db
def test_historical_import_separates_verified_label_from_cancelled_group_without_moving_cards(workspace):
    import importlib
    from django.db import connection
    from django.db.migrations.loader import MigrationLoader
    from django.test import override_settings

    project = Project.objects.create(name="Existing program", identifier="OLD", sport="Football", workspace=workspace)
    states = [
        State.objects.create(project=project, name=name, group=group, color="#333")
        for name, group in [
            ("Unassigned", "backlog"),
            ("Assigned", "unstarted"),
            ("Player Reviewed", "started"),
            ("Practice check", "completed"),
            ("Verified on film", "cancelled"),
        ]
    ]
    card = Issue.objects.create(
        project=project,
        state=states[-1],
        name="Verified card",
        category="Coaching Card",
        coaching_card_data={"recipient_ids": ["player"]},
    )
    with override_settings(MIGRATION_MODULES={}):
        historical_apps = MigrationLoader(None).project_state([("db", "0131_program_state_roles")]).apps
    migration = importlib.import_module("plane.db.migrations.0131_program_state_roles")
    with connection.schema_editor() as editor:
        migration.bind_program_roles(historical_apps, editor)
        migration.bind_program_roles(historical_apps, editor)
    states[-1].refresh_from_db()
    card.refresh_from_db()
    assert states[-1].lifecycle_role == "verified"
    assert states[-1].group == "completed"
    assert states[-1].name == "Verified on film"
    assert card.state_id == states[-1].id
    assert card.coaching_card_data["recipient_ids"] == ["player"]
    assert State.objects.filter(project=project, lifecycle_role="closed", name="Closed", group="cancelled").count() == 1
    assert State.objects.filter(project=project).count() == 6
