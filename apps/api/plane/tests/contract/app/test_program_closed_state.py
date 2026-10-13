import pytest
from rest_framework.exceptions import ValidationError as APIValidationError

from plane.db.models import CardStageHistory, Issue, Project, State
from plane.utils.coaching_card_lifecycle import get_project_card_stage_config, transition_coaching_card


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
