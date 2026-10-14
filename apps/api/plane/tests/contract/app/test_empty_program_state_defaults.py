import importlib

import pytest
from django.db import connection
from django.db.migrations.loader import MigrationLoader
from django.test import override_settings

from plane.db.models import Project, ProjectMember, State


DEFAULT_NAMES = ["Identify", "To Review", "Action Required", "In Progress", "Verified", "Closed"]


def seed_empty_programs():
    migration = importlib.import_module("plane.db.migrations.0133_empty_program_state_defaults")
    with override_settings(MIGRATION_MODULES={}):
        apps = MigrationLoader(None).project_state([("db", "0132_program_state_defaults")]).apps
    with connection.schema_editor() as editor:
        migration.seed_empty_program_states(apps, editor)


@pytest.mark.django_db
@pytest.mark.parametrize("sport", ["Basketball", "Cricket", "Football"])
def test_empty_program_gets_six_persisted_editable_defaults(session_client, workspace, create_user, sport):
    project = Project.objects.create(name=sport, sport=sport, identifier="EMPTY", workspace=workspace)
    ProjectMember.objects.create(project=project, member=create_user, role=20, is_active=True)

    seed_empty_programs()
    original_ids = list(State.objects.filter(project=project).values_list("id", flat=True))
    seed_empty_programs()

    response = session_client.get(f"/api/workspaces/{workspace.slug}/projects/{project.id}/states/")
    assert response.status_code == 200
    assert [state["name"] for state in response.data] == DEFAULT_NAMES
    assert [state["lifecycle_role"] for state in response.data] == [
        "identified", "assigned", "reviewed", "practice", "verified", "closed"
    ]
    assert [state["default"] for state in response.data] == [True, False, False, False, False, False]
    assert list(State.objects.filter(project=project).values_list("id", flat=True)) == original_ids
    assert [state["slug"] for state in State.objects.filter(project=project).values("slug")] == [
        "identify", "to-review", "action-required", "in-progress", "verified", "closed"
    ]
    state_url = f"/api/workspaces/{workspace.slug}/projects/{project.id}/states/{original_ids[0]}/"
    assert session_client.patch(state_url, {"name": "Film intake"}, format="json").status_code == 200


@pytest.mark.django_db
def test_empty_program_seed_preserves_existing_configuration_and_non_sport_programs(workspace):
    existing = Project.objects.create(name="Existing", sport="Football", identifier="EXIST", workspace=workspace)
    custom = State.objects.create(project=existing, name="Coach intake", group="backlog", color="#333", default=True)
    general = Project.objects.create(name="General", identifier="GENERAL", workspace=workspace)

    seed_empty_programs()

    assert list(State.objects.filter(project=existing).values_list("id", "name")) == [(custom.id, "Coach intake")]
    assert not State.objects.filter(project=general).exists()


@pytest.mark.django_db
def test_empty_program_seed_keeps_triage_records(workspace):
    project = Project.objects.create(name="Cricket", sport="Cricket", identifier="TRIAGE", workspace=workspace)
    triage = State.objects.create(project=project, name="Triage", group="triage", is_triage=True, color="#333")

    seed_empty_programs()

    assert State.objects.filter(project=project, is_triage=False).count() == 6
    triage.refresh_from_db()
    assert triage.name == "Triage"
