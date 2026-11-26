import pytest
from rest_framework.test import APIClient

from plane.db.models import Issue, PlayerRegistrationRequest, Project, ProjectMember, RosterEvent, RosterPlayer
from plane.db.models import State, User, WorkspaceMember
from plane.utils.player_activity_access import player_activities, player_programs
from plane.db.models.team_season import TeamSeason


def staff(workspace, email, role=15):
    user = User.objects.create(username=email, email=email)
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=role)
    return user


@pytest.mark.django_db
def test_new_season_and_delegation_do_not_change_old_program(session_client, workspace):
    root = f"/api/workspaces/{workspace.slug}/team-admin/"
    old = Project.objects.create(workspace=workspace, name="Varsity 2025", identifier="OLD", event_season="2025-2026")
    player = RosterPlayer.objects.create(project=old, player_name="Prior Player")
    team = session_client.post(root + "teams/", {"name": "Varsity"}, format="json")
    assert team.status_code == 201, team.content
    team_id = team.json()["id"]
    assert (
        session_client.post(root + f"teams/{team_id}/seasons/", {"project_id": str(old.pk)}, format="json").status_code
        == 201
    )
    payload = {
        "name": "Varsity 2026",
        "identifier": "NEW",
        "season_label": "2026-2027",
        "sport": "Basketball",
        "division": "Boys",
        "level": "Varsity",
    }
    created = session_client.post(root + f"teams/{team_id}/seasons/", payload, format="json")
    assert created.status_code == 201, created.content
    program = Project.objects.get(pk=created.json()["project_id"])
    assert program.event_season == "2026-2027" and program.event_program == "Boys"
    assert State.objects.filter(project=program).exists()
    season = TeamSeason.objects.get(project=program)
    assert str(season.team_id) == team_id
    assert (
        session_client.post(
            root + f"teams/{team_id}/seasons/", {**payload, "name": "Duplicate", "identifier": "DUP"}, format="json"
        ).status_code
        == 400
    )
    assert (
        session_client.post(
            root + f"teams/{team_id}/seasons/",
            {
                **payload,
                "name": "Bad date",
                "identifier": "DATE",
                "season_label": "2028-2029",
                "starts_on": "2030-01-01",
            },
            format="json",
        ).status_code
        == 400
    )
    player.refresh_from_db()
    assert player.project_id == old.pk and not RosterPlayer.objects.filter(project=program).exists()

    operator = staff(workspace, "operator@test.example")
    staff_url = root + f"seasons/{season.pk}/staff/{operator.pk}/"
    client = APIClient()
    client.force_authenticate(operator)
    editor = f"/api/workspaces/{workspace.slug}/projects/{program.pk}/roster/delegated/"
    assert client.get(root + "teams/").status_code == 403
    assert (
        session_client.put(staff_url, {"assignment": "operator", "manage_roster": True}, format="json").status_code
        == 200
    )
    assert ProjectMember.objects.get(project=program, member=operator).role == 5
    assert (
        client.post(editor, {"player_name": "New Player", "email": "forbidden@test.example"}, format="json").status_code
        == 400
    )
    added = client.post(editor, {"player_name": "New Player", "jersey_number": "12"}, format="json")
    assert added.status_code == 201, added.content
    edit_url = editor + f"{added.json()['id']}/"
    assert (
        client.patch(
            edit_url, {"position": "Guard", "expected_updated_at": added.json()["updated_at"]}, format="json"
        ).status_code
        == 200
    )
    assert (
        client.patch(
            edit_url, {"position": "Forward", "expected_updated_at": added.json()["updated_at"]}, format="json"
        ).status_code
        == 409
    )
    assert client.get(f"/api/workspaces/{workspace.slug}/projects/{old.pk}/roster/delegated/").status_code == 403
    assert (
        client.post(editor.replace("delegated/", ""), {"player_name": "Not allowed"}, format="json").status_code == 403
    )
    overview = session_client.get(root + "roster/", {"season": str(season.pk)})
    assert overview.status_code == 200, overview.content
    assert overview.json()["results"][0]["player_name"] == "New Player"
    assert not {"email", "user", "notes"}.intersection(overview.json()["results"][0])
    assert session_client.delete(staff_url).status_code == 204
    assert client.post(editor, {"player_name": "Grant revoked"}, format="json").status_code == 403
    assert ProjectMember.objects.get(project=program, member=operator).role == 5


@pytest.mark.django_db
def test_account_correction_preserves_tags_and_will_not_transfer_cards(session_client, workspace, create_user):
    prior = Project.objects.create(workspace=workspace, name="Prior", identifier="PRIOR")
    program = Project.objects.create(workspace=workspace, name="Target", identifier="TARGET")
    ProjectMember.objects.create(project=program, member=create_user, role=20)
    wrong = staff(workspace, "wrong@test.example", role=1)
    correct = staff(workspace, "right@test.example", role=1)
    ProjectMember.objects.create(project=program, member=wrong, role=1)
    player = RosterPlayer.objects.create(
        project=program, user=wrong, player_name="Alex Player", class_year="2028", email=wrong.email
    )
    RosterPlayer.objects.create(
        project=prior, user=correct, player_name=player.player_name, class_year=player.class_year
    )
    tag = Issue.objects.create(project=program, name="Game tag", description={"roster_id": str(player.pk)})
    card = Issue.objects.create(project=program, name="Assigned card", category="Coaching Card", roster_player=player)
    url = f"/api/workspaces/{workspace.slug}/projects/{program.pk}/roster/{player.pk}/account-correction/"
    payload = {"expected_user_id": str(wrong.pk), "replacement_user_id": str(correct.pk)}
    assert session_client.post(url, payload, format="json").status_code == 409
    card.roster_player = None
    card.save(update_fields=["roster_player"])
    response = session_client.post(url, payload, format="json")
    assert response.status_code == 200, response.content
    player.refresh_from_db()
    tag.refresh_from_db()
    assert tag.description == {"roster_id": str(player.pk)}
    assert player.user_id == correct.pk and player.email == ""
    assert not ProjectMember.objects.get(project=program, member=wrong).is_active
    assert ProjectMember.objects.get(project=program, member=correct).is_active
    audit = RosterEvent.objects.get(roster_player=player, action="account_link_corrected")
    assert audit.previous_account_id == wrong.pk and audit.replacement_account_id == correct.pk
    assert session_client.post(url, payload, format="json").status_code == 409


@pytest.mark.django_db
def test_unlink_holds_history_and_revokes_program_access(session_client, workspace, create_user):
    program = Project.objects.create(workspace=workspace, name="Team", identifier="TEAM")
    other = Project.objects.create(workspace=workspace, name="Other", identifier="OTHER")
    ProjectMember.objects.create(project=program, member=create_user, role=20)
    athlete = staff(workspace, "wrong-history@test.example", role=1)
    ProjectMember.objects.create(project=program, member=athlete, role=1)
    ProjectMember.objects.create(project=other, member=athlete, role=1)
    row = RosterPlayer.objects.create(project=program, user=athlete, player_name="Player", jersey_number="7")
    request = PlayerRegistrationRequest.objects.create(project=program, roster_player=row, user=athlete)
    state = State.objects.create(project=program, name="Published", group="started")
    card = Issue.objects.create(
        project=program,
        state=state,
        name="Card",
        category="Coaching Card",
        roster_player=row,
        coaching_card_data={"recipient_ids": [str(row.pk)]},
    )
    root = f"/api/workspaces/{workspace.slug}/projects/{program.pk}/roster/{row.pk}/"
    assert player_activities(athlete).filter(pk=card.pk).exists()
    response = session_client.post(
        root + "account-correction/", {"expected_user_id": str(athlete.pk), "replacement_user_id": None}, format="json"
    )
    assert response.status_code == 200, response.content
    row.refresh_from_db()
    assert row.account_link_held and row.user_id is None and row.jersey_number == "7" and row.status == "active"
    assert not player_activities(athlete).filter(pk=card.pk).exists()
    assert set(player_programs(athlete).values_list("pk", flat=True)) == {other.pk}
    assert Issue.objects.get(pk=card.pk).roster_player_id == row.pk
    assert PlayerRegistrationRequest.objects.filter(pk=request.pk, user=athlete).exists()
    assert session_client.post(root + "approve/", {}, format="json").status_code == 400
    assert session_client.patch(root, {"email": "no@test.example"}, format="json").status_code == 400
    assert RosterEvent.objects.filter(
        roster_player=row, action="account_link_revoked", previous_account_id=athlete.pk
    ).exists()
