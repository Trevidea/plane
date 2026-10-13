import json
from uuid import uuid4

import pytest

from plane.db.models import Issue, Project, ProjectMember, State
from plane.utils.media_library import manifest_path


@pytest.mark.django_db
@pytest.mark.parametrize("empty_board", [False, True])
@pytest.mark.parametrize("source_kind", ["event", "video"])
@pytest.mark.parametrize("selection", [{}, {"player_ids": [], "position_group": ""}])
def test_unassigned_card_uses_first_program_state_and_initializes_an_empty_board(
    session_client, workspace, create_user, settings, tmp_path, empty_board, source_kind, selection
):
    project = Project.objects.create(name="Football", identifier="FIRST", sport="Football", workspace=workspace)
    ProjectMember.objects.create(project=project, member=create_user, role=20, is_active=True)
    if not empty_board:
        State.objects.create(project=project, name="Hidden legacy intake", group="backlog", color="#333")
        initial = State.objects.create(
            project=project,
            name="Coach intake",
            group="backlog",
            color="#333",
            default=True,
            lifecycle_role="identified",
        )
        State.objects.create(
            project=project, name="Coach assignment", group="unstarted", color="#333", lifecycle_role="assigned"
        )
    source = Issue.objects.create(project=project, name="Saved video source", state=None if empty_board else initial)
    payload = {
        "request_id": str(uuid4()),
        "title": "Unassigned review",
        "card_type": "Correction",
        "priority": "Standard",
        **selection,
    }
    if source_kind == "video":
        settings.MEDIA_LIBRARY_ROOT = str(tmp_path)
        path = manifest_path(str(project.id), "library")
        path.parent.mkdir(parents=True)
        path.write_text(
            json.dumps(
                {
                    "artifacts": [
                        {"name": "video-1", "title": "Video", "format": "mp4", "meta": {"work_item_id": str(source.id)}}
                    ]
                }
            )
        )
        payload["source_media"] = {"package_id": "library", "artifact_id": "video-1"}
    else:
        payload.update(
            source_issue_id=str(source.id),
            playlists=[
                {"id": "plays", "name": "Plays", "clips": [{"key": "plays:clip", "id": "clip", "title": "Clip"}]}
            ],
        )
    url = f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/create-coaching-cards/"
    response = session_client.post(url, payload, format="json")
    assert response.status_code == 201, response.data
    card = Issue.objects.get(pk=response.data["cards"][0]["id"])
    first = State.objects.get(project=project, lifecycle_role="identified")
    assert card.state_id == first.id
    assert str(card.state_id) == card.coaching_card_data["stage_id"]
    config = session_client.get(f"/api/workspaces/{workspace.slug}/projects/{project.id}/coaching-card-config/")
    assert config.data["initial_stage_id"] == str(first.id)
    assert card.parent_id == source.id
    assert card.coaching_card_data["recipient_ids"] == []
    assert card.position_group is None
    assert card.coaching_card_data["review"]["assigned_at"] is None
    assert card.coaching_card_data["review"]["deadline_at"] is None
    state_count = State.objects.filter(project=project).count()
    assert state_count == (6 if empty_board else 3)
    replay = session_client.post(url, payload, format="json")
    assert replay.status_code == 200
    assert replay.data["idempotent_replay"] is True
    assert replay.data["cards"][0]["id"] == response.data["cards"][0]["id"]
    assert State.objects.filter(project=project).count() == state_count
    assert Issue.objects.filter(project=project, category="Coaching Card").count() == 1


@pytest.mark.django_db
def test_empty_board_reads_and_invalid_card_requests_do_not_create_states(session_client, workspace, create_user):
    project = Project.objects.create(name="Football", identifier="EMPTY", sport="Football", workspace=workspace)
    ProjectMember.objects.create(project=project, member=create_user, role=20, is_active=True)
    response = session_client.get(f"/api/workspaces/{workspace.slug}/projects/{project.id}/coaching-card-config/")
    assert response.status_code == 400
    assert not State.objects.filter(project=project).exists()
    source = Issue.objects.create(project=project, name="Event without a state")
    response = session_client.post(
        f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/create-coaching-cards/",
        {
            "request_id": str(uuid4()),
            "source_issue_id": str(source.id),
            "player_ids": [str(uuid4())],
            "title": "Invalid roster choice",
            "card_type": "Correction",
            "priority": "Standard",
            "playlists": [
                {"id": "plays", "name": "Plays", "clips": [{"key": "plays:clip", "id": "clip", "title": "Clip"}]}
            ],
        },
        format="json",
    )
    assert response.status_code == 400
    assert "player_ids" in response.data
    assert not State.objects.filter(project=project).exists()
