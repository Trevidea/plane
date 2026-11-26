import json
from datetime import timedelta
from importlib import import_module
from io import StringIO
from types import SimpleNamespace

import pytest
from django.apps import apps
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.db import connection

from plane.db.models import Project, ProjectMember, RosterJerseyAssignment, RosterPlayer, TeamSeason, Workspace
from plane.db.models.workspace import Team
from plane.utils.team_seasons import roster_player_at_jersey


@pytest.fixture
def program(workspace, create_user):
    project = Project.objects.create(
        workspace=workspace,
        name="Varsity Football",
        identifier="FB",
        sport="Football",
        event_season="2026-2027",
        event_program="Men",
        event_level="Varsity",
    )
    ProjectMember.objects.create(project=project, member=create_user, role=20)
    return project


@pytest.mark.django_db
def test_jersey_reuse_does_not_change_the_historical_owner(session_client, program):
    path = f"/api/workspaces/{program.workspace.slug}/projects/{program.id}/roster/"

    def add(name):
        return session_client.post(path, {"player_name": name, "jersey_number": "12"}, format="json")

    maya = add("Maya")
    assert maya.status_code == 201, maya.data
    first_id = RosterPlayer.objects.get(pk=maya.data["id"]).id
    season = TeamSeason.objects.get(project=program)
    historical = RosterJerseyAssignment.objects.get(roster_player_id=first_id)
    assert add("Sam").status_code == 400
    maya_path = f"{path}{first_id}/"
    assert session_client.patch(maya_path, {"status": "inactive"}, format="json").status_code == 200
    sam = add("Sam")
    assert sam.status_code == 201, sam.data
    current = RosterJerseyAssignment.objects.get(roster_player_id=sam.data["id"])
    historical.refresh_from_db()
    assert current.valid_to is None
    assert historical.valid_from <= historical.valid_to <= current.valid_from
    assert roster_player_at_jersey(season, "12", historical.valid_from - timedelta(microseconds=1)) is None
    assert roster_player_at_jersey(season, "12", historical.valid_from) == first_id
    assert roster_player_at_jersey(season, "12", current.valid_from) == current.roster_player_id
    assert (
        session_client.patch(maya_path, {"status": "active", "jersey_number": "12"}, format="json").status_code == 400
    )
    assert (
        session_client.patch(maya_path, {"status": "active", "jersey_number": "13"}, format="json").status_code == 200
    )
    assert session_client.delete(maya_path).status_code == 200
    assert RosterPlayer.objects.get(pk=first_id).status == "removed"
    assert not RosterJerseyAssignment.objects.filter(roster_player_id=first_id, valid_to__isnull=True).exists()
    assert roster_player_at_jersey(season, "12", historical.valid_from) == first_id


@pytest.mark.django_db
def test_tag_preflight_rejects_stale_jersey_instead_of_tagging_the_new_owner(session_client, program):
    roster = f"/api/workspaces/{program.workspace.slug}/projects/{program.id}/roster/"
    create = session_client.post(roster, {"player_name": "Maya", "jersey_number": "12"}, format="json")
    assert create.status_code == 201, create.data
    maya = create.json()["id"]
    assert create.json()["member_id"] == maya
    path = roster + "tag-references/"

    def tag(member_id, number):
        return session_client.post(
            path, {"roster_ids": [member_id], "members": [{"member_id": member_id, "jersey": number}]}, format="json"
        )

    assert tag(maya, "12").status_code == 200
    assert session_client.patch(f"{roster}{maya}/", {"jersey_number": "13"}, format="json").status_code == 200
    sam = session_client.post(roster, {"player_name": "Sam", "jersey_number": "12"}, format="json").json()["id"]
    assert tag(maya, "12").status_code == 409
    assert RosterPlayer.objects.get(pk=sam).first_tagged_at is None
    assert tag(maya, "13").status_code == 200
    assert tag(sam, "12").status_code == 200
    no_jersey = session_client.post(roster, {"player_name": "No jersey"}, format="json").json()["id"]
    assert tag(no_jersey, "").status_code == 200
    assert session_client.post(path, {"roster_ids": [no_jersey]}, format="json").status_code == 200


@pytest.mark.django_db
def test_legacy_backfill_is_repeatable_and_does_not_merge_programs(program):
    player = RosterPlayer.objects.create(project=program, player_name="Maya", jersey_number="12")
    other = Project.objects.create(
        workspace=program.workspace,
        name="JV Football",
        identifier="JV",
        sport=program.sport,
        event_season=program.event_season,
    )
    Team.objects.create(workspace=program.workspace, name=program.name)

    backfill = import_module("plane.db.migrations.0143_backfill_team_seasons").backfill
    backfill(apps, SimpleNamespace(connection=connection))
    season = TeamSeason.objects.get(project=program)
    assignment = RosterJerseyAssignment.objects.get(roster_player=player)
    assert season.team_id is None
    assert TeamSeason.objects.get(project=other).pk != season.pk
    assert (season.season_label, season.sport, season.division, season.level) == (
        "2026-2027",
        "Football",
        "Men",
        "Varsity",
    )

    Project.objects.filter(pk=program.pk).update(event_season="2027-2028")
    backfill(apps, SimpleNamespace(connection=connection))
    season.refresh_from_db()
    assert season.season_label == "2026-2027"
    assert RosterJerseyAssignment.objects.get(roster_player=player).pk == assignment.pk
    assert roster_player_at_jersey(season, "12", assignment.valid_from - timedelta(days=1)) is None

    output = StringIO()
    call_command("audit_team_seasons", workspace=program.workspace.slug, stdout=output)
    report = json.loads(output.getvalue())
    assert report["programs_checked"] == 2
    assert report["untracked_roster_ids"] == []
    assert {row["program_id"]: row["reasons"] for row in report["review"]} == {
        str(program.pk): ["team_not_confirmed", "program_season_default_changed"],
        str(other.pk): ["team_not_confirmed"],
    }


@pytest.mark.django_db
def test_season_cannot_be_linked_to_another_school(program, create_user):
    other_school = Workspace.objects.create(name="Other school", slug="other-school", owner=create_user)
    other_team = Team.objects.create(workspace=other_school, name="Other team")
    with pytest.raises(ValidationError):
        TeamSeason.objects.create(project=program, team=other_team)
