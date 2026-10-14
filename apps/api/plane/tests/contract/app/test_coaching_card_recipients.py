from copy import deepcopy
from datetime import timedelta

import pytest
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from plane.db.models import CardStageHistory, Issue, Project, ProjectMember, RosterPlayer, State
from plane.utils.coaching_card_lifecycle import default_project_state_definitions


@pytest.fixture
def recipient_card(workspace, create_user):
    project = Project.objects.create(name="Football", identifier="FOOT", workspace=workspace, sport="Football")
    ProjectMember.objects.create(project=project, member=create_user, role=20, is_active=True)
    states = [
        State.objects.create(project=project, **definition) for definition in default_project_state_definitions(project)
    ]
    players = [
        RosterPlayer.objects.create(project=project, player_name="Jordan", position="Guard"),
        RosterPlayer.objects.create(project=project, player_name="Taylor", position="Forward"),
    ]
    card = Issue.objects.create(
        project=project,
        name="Pass protection",
        state=states[1],
        category="Coaching Card",
        roster_player=players[0],
        coaching_card_data={
            "kind": "coaching_card",
            "recipient_ids": [str(players[0].id)],
            "recipients": [{"id": str(players[0].id), "name": players[0].player_name}],
            "review": {"viewed_by": {str(players[0].id): timezone.now().isoformat()}},
        },
    )
    url = f"/api/workspaces/{workspace.slug}/projects/{project.id}/coaching-cards/{card.id}/"
    return card, states, players, url


@pytest.mark.contract
@pytest.mark.django_db
@pytest.mark.parametrize("stage_index", [0, 1])
@pytest.mark.parametrize("field", ["player_ids", "player_id", "position_group"])
def test_first_two_stages_allow_recipient_edits(session_client, recipient_card, stage_index, field):
    card, states, players, url = recipient_card
    card.state = states[stage_index]
    card.save(update_fields=["state"])
    value = "Forward" if field == "position_group" else str(players[1].id)
    response = session_client.patch(url, {field: [value] if field == "player_ids" else value}, format="json")

    assert response.status_code == 200, response.data
    card.refresh_from_db()
    assert card.coaching_card_data["recipient_ids"] == [str(players[1].id)]
    assert card.state_id == states[1].id


@pytest.mark.contract
@pytest.mark.django_db
@pytest.mark.parametrize("stage_index", [2, 3, 4, 5])
@pytest.mark.parametrize("field", ["player_ids", "player_id", "position_group"])
def test_later_stages_reject_recipient_edits_without_changing_any_fields(
    session_client, recipient_card, stage_index, field
):
    card, states, players, url = recipient_card
    card.state = states[stage_index]
    card.save(update_fields=["state"])
    original = deepcopy(card.coaching_card_data)
    value = "Forward" if field == "position_group" else str(players[1].id)
    response = session_client.patch(
        url, {field: [value] if field == "player_ids" else value, "title": "Must not persist"}, format="json"
    )

    assert response.status_code == 400
    assert "first two lifecycle stages" in response.data["detail"]
    card.refresh_from_db()
    assert card.name == "Pass protection"
    assert card.state_id == states[stage_index].id
    assert card.roster_player_id == players[0].id
    assert card.coaching_card_data == original
    assert CardStageHistory.objects.filter(issue=card).count() == 0


@pytest.mark.contract
@pytest.mark.django_db
def test_later_stage_properties_remain_editable_without_changing_recipients(session_client, recipient_card):
    card, states, _, url = recipient_card
    card.state = states[2]
    card.save(update_fields=["state"])
    recipient_ids = card.coaching_card_data["recipient_ids"]

    response = session_client.patch(url, {"title": "Updated coaching note", "priority": "Standard"}, format="json")

    assert response.status_code == 200, response.data
    card.refresh_from_db()
    assert card.name == "Updated coaching note"
    assert card.coaching_card_data["recipient_ids"] == recipient_ids


@pytest.mark.contract
@pytest.mark.django_db
def test_archived_cards_cannot_change_recipients(session_client, recipient_card):
    card, _, players, url = recipient_card
    card.archived_at = timezone.now()
    card.save(update_fields=["archived_at"])

    response = session_client.patch(url, {"player_ids": [str(players[1].id)]}, format="json")

    assert response.status_code == 404
    card.refresh_from_db()
    assert card.coaching_card_data["recipient_ids"] == [str(players[0].id)]


@pytest.mark.contract
@pytest.mark.django_db
@pytest.mark.parametrize("assignment", ["single", "multiple", "position_group", "legacy", "empty"])
def test_removing_all_recipients_moves_assigned_to_identified_without_a_reopen_reason(
    session_client, recipient_card, create_user, assignment
):
    card, states, players, url = recipient_card
    recipients = (
        [] if assignment == "empty" else players if assignment in ("multiple", "position_group") else players[:1]
    )
    snapshots = [{"id": str(player.id), "name": player.player_name} for player in recipients]
    data = {
        **card.coaching_card_data,
        "player": snapshots[0] if len(snapshots) == 1 else None,
        "recipient_ids": [snapshot["id"] for snapshot in snapshots],
        "recipients": snapshots,
        "position_group": "Guard" if assignment == "position_group" else None,
        "feedback": "Keep this feedback",
        "review": {
            "assigned_at": timezone.now().isoformat(),
            "deadline_at": timezone.now().isoformat(),
            "viewed_by": {snapshot["id"]: timezone.now().isoformat() for snapshot in snapshots},
        },
    }
    if assignment == "legacy":
        data.pop("recipient_ids")
        data.pop("recipients")
    card.coaching_card_data = data
    card.position_group = data["position_group"]
    card.roster_player = recipients[0] if len(recipients) == 1 else None
    card.save()

    response = session_client.patch(url, {"player_ids": []}, format="json")

    assert response.status_code == 200, response.data
    card.refresh_from_db()
    assert card.state_id == states[0].id
    assert str(response.data["state_id"]) == str(states[0].id)
    assert card.coaching_card_data["stage_id"] == str(states[0].id)
    assert card.coaching_card_data["recipient_ids"] == []
    assert card.coaching_card_data["recipients"] == []
    assert card.coaching_card_data["player"] is None
    assert card.coaching_card_data["position_group"] is None
    assert card.coaching_card_data["review"] == {"assigned_at": None, "deadline_at": None, "viewed_by": {}}
    assert card.coaching_card_data["feedback"] == "Keep this feedback"
    assert card.roster_player_id is None
    assert card.position_group is None
    history = CardStageHistory.objects.get(issue=card)
    assert history.from_stage_id == states[1].id
    assert history.to_stage_id == states[0].id
    assert history.changed_by_id == create_user.id
    assert history.reason == "All recipients removed."


@pytest.mark.contract
@pytest.mark.django_db
def test_clearing_a_position_group_returns_card_to_identified(session_client, recipient_card):
    card, states, _, url = recipient_card
    card.position_group = "Guard"
    card.coaching_card_data["position_group"] = "Guard"
    card.save()

    response = session_client.patch(url, {"position_group": ""}, format="json")

    assert response.status_code == 200, response.data
    card.refresh_from_db()
    assert card.state_id == states[0].id
    assert card.coaching_card_data["recipient_ids"] == []
    assert card.position_group is None
    assert card.roster_player_id is None


@pytest.mark.contract
@pytest.mark.django_db
@pytest.mark.parametrize("stage_config", ["renamed_roles", "legacy_two_stages"])
def test_removing_last_recipient_uses_stage_identity_and_supports_legacy_boards(
    session_client, recipient_card, stage_config
):
    card, states, _, url = recipient_card
    if stage_config == "renamed_roles":
        states[0].name = "Film Tagged"
        states[0].save(update_fields=["name"])
        states[1].name = "Delivered"
        states[1].save(update_fields=["name"])
    else:
        states[0].name = "Identified"
        states[0].save(update_fields=["name"])
        states[1].name = "Assigned"
        states[1].save(update_fields=["name"])
        State.objects.filter(project=card.project).update(lifecycle_role="")
        State.objects.filter(pk__in=[state.id for state in states[2:]]).update(deleted_at=timezone.now())

    response = session_client.patch(url, {"player_ids": []}, format="json")

    assert response.status_code == 200, response.data
    card.refresh_from_db()
    assert card.state_id == states[0].id
    assert card.coaching_card_data["recipient_ids"] == []
    history = CardStageHistory.objects.get(issue=card)
    assert history.from_stage_name == states[1].name
    assert history.to_stage_name == states[0].name


@pytest.mark.contract
@pytest.mark.django_db
@pytest.mark.parametrize("assigned_name", ["To Review", "Delivered", "Assigned"])
def test_removing_only_some_recipients_keeps_assigned_stage(session_client, recipient_card, assigned_name):
    card, states, players, url = recipient_card
    states[1].name = assigned_name
    states[1].save(update_fields=["name"])
    card.coaching_card_data["recipient_ids"] = [str(player.id) for player in players]
    card.coaching_card_data["recipients"] = [{"id": str(player.id), "name": player.player_name} for player in players]
    card.roster_player = None
    card.save()

    response = session_client.patch(url, {"player_ids": [str(players[1].id)]}, format="json")

    assert response.status_code == 200, response.data
    card.refresh_from_db()
    assert card.state_id == states[1].id
    assert card.coaching_card_data["recipient_ids"] == [str(players[1].id)]
    assert card.roster_player_id == players[1].id
    assert card.coaching_card_data["review"]["viewed_by"] == {}
    assert card.coaching_card_data["review"]["deadline_at"] is not None
    review = card.coaching_card_data["review"]
    assert parse_datetime(review["deadline_at"]) - parse_datetime(review["assigned_at"]) == timedelta(days=3)
    assert not CardStageHistory.objects.filter(issue=card).exists()


@pytest.mark.contract
@pytest.mark.django_db
def test_renamed_assigned_stage_still_requires_automatic_review(session_client, recipient_card):
    card, states, _, url = recipient_card
    response = session_client.post(f"{url}transition/", {"stage_id": str(states[2].id)}, format="json")
    assert response.status_code == 400
    assert "automatic" in response.data["stage_id"][0]
    assert states[1].name in response.data["stage_id"][0]
    card.refresh_from_db()
    assert card.state_id == states[1].id
    assert not CardStageHistory.objects.filter(issue=card).exists()


@pytest.mark.contract
@pytest.mark.django_db
def test_empty_save_retries_do_not_duplicate_history_and_reassignment_still_works(session_client, recipient_card):
    card, states, players, url = recipient_card
    for _ in range(2):
        response = session_client.patch(url, {"player_ids": []}, format="json")
        assert response.status_code == 200, response.data
        assert str(response.data["state_id"]) == str(states[0].id)
    assert CardStageHistory.objects.filter(issue=card).count() == 1

    response = session_client.patch(url, {"player_ids": [str(players[1].id)]}, format="json")

    assert response.status_code == 200, response.data
    card.refresh_from_db()
    assert card.state_id == states[1].id
    assert card.coaching_card_data["recipient_ids"] == [str(players[1].id)]
    assert card.coaching_card_data["review"]["deadline_at"] is not None
    assert CardStageHistory.objects.filter(issue=card).count() == 2


@pytest.mark.contract
@pytest.mark.django_db
def test_recipient_save_rolls_back_with_stage_if_automatic_transition_audit_fails(
    session_client, recipient_card, monkeypatch
):
    card, states, players, url = recipient_card
    original = deepcopy(card.coaching_card_data)

    def fail_audit(**kwargs):
        raise RuntimeError("Audit unavailable")

    monkeypatch.setattr(CardStageHistory.objects, "create", fail_audit)
    response = session_client.patch(url, {"player_ids": [], "title": "Must roll back"}, format="json")
    assert response.status_code == 500

    card.refresh_from_db()
    assert card.state_id == states[1].id
    assert card.name == "Pass protection"
    assert card.coaching_card_data == original
    assert card.roster_player_id == players[0].id
    assert not CardStageHistory.objects.filter(issue=card).exists()
