from uuid import uuid4

import pytest
from rest_framework import status

from plane.db.models import Issue, Project, ProjectMember, RosterPlayer, State


def _clip(clip_id="clip-1"):
    return {
        "key": f"playlist-1:{clip_id}",
        "id": clip_id,
        "title": "Shot attempt",
        "thumbnail": "frame.jpg",
        "duration_seconds": 4.5,
        "timecode": "00:10-00:14.5",
        "team": "Home",
        "detail": "Three point",
        "result": "Made",
        "secondary_detail": "Left wing",
        "group": "Quarter 1",
    }


@pytest.mark.contract
class TestCoachingCardIssues:
    @pytest.mark.django_db
    def test_creates_one_existing_issue_per_player_and_replays_idempotently(
        self, session_client, workspace, create_user
    ):
        project = Project.objects.create(
            name="Basketball",
            identifier="BALL",
            workspace=workspace,
            sport="Basketball",
        )
        ProjectMember.objects.create(project=project, member=create_user, role=20, is_active=True)
        event_state = State.objects.create(
            name="Scheduled",
            color="#333333",
            group="unstarted",
            default=True,
            project=project,
        )
        source_issue = Issue.objects.create(
            name="Home vs Visitors",
            project=project,
            state=event_state,
            sg_event_id=441,
            level="Varsity",
            program="Men's Basketball",
            year="2026-27",
        )
        players = [
            RosterPlayer.objects.create(
                project=project,
                player_name="Jordan Ellis",
                jersey_number="12",
                position="Guard",
            ),
            RosterPlayer.objects.create(
                project=project,
                player_name="Taylor Reed",
                jersey_number="23",
                position="Forward",
            ),
        ]
        request_id = str(uuid4())
        payload = {
            "request_id": request_id,
            "source_issue_id": str(source_issue.id),
            "player_ids": [str(player.id) for player in players],
            "title": "Improve closeout footwork",
            "feedback": "Keep the shooting elbow aligned.",
            "card_type": "Correction",
            "priority": "Game Plan Critical",
            "sport_label": "Basketball",
            "playlists": [{"id": "playlist-1", "name": "Shot selection", "clips": [_clip()]}],
        }
        url = f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/create-coaching-cards/"

        response = session_client.post(url, payload, format="json")

        assert response.status_code == status.HTTP_201_CREATED
        assert response.json()["created_count"] == 2
        cards = list(Issue.objects.filter(project=project, category="Coaching Card").order_by("sequence_id"))
        assert len(cards) == 2
        assert {card.roster_player_id for card in cards} == {player.id for player in players}
        assert all(card.state.name == "New" for card in cards)
        assert all(card.parent_id == source_issue.id for card in cards)
        assert all(card.sg_event_id is None for card in cards)
        assert all(card.name == "Improve closeout footwork" for card in cards)
        assert cards[0].coaching_card_data["request_id"] == request_id
        assert cards[0].coaching_card_data["playlists"][0]["clips"][0]["result"] == "Made"
        assert cards[0].coaching_card_data["card_type"] == "Correction"
        assert cards[0].coaching_card_data["priority"] == "Game Plan Critical"
        assert cards[0].coaching_card_data["metadata"]["season"] == "2026-27"
        assert cards[0].coaching_card_data["metadata"]["author"]["id"] == str(create_user.id)
        assert (
            cards[0].coaching_card_data["metadata"]["serial_number"]
            != cards[1].coaching_card_data["metadata"]["serial_number"]
        )

        replay = session_client.post(url, payload, format="json")

        assert replay.status_code == status.HTTP_200_OK
        assert replay.json()["created_count"] == 0
        assert replay.json()["idempotent_replay"] is True
        assert Issue.objects.filter(project=project, category="Coaching Card").count() == 2

    @pytest.mark.django_db
    def test_rejects_roster_players_from_another_project(self, session_client, workspace, create_user):
        project = Project.objects.create(name="Basketball", identifier="BALL", workspace=workspace, sport="Basketball")
        other_project = Project.objects.create(
            name="Football",
            identifier="FOOT",
            workspace=workspace,
            sport="Football",
        )
        ProjectMember.objects.create(project=project, member=create_user, role=20, is_active=True)
        state = State.objects.create(
            name="Scheduled",
            color="#333333",
            group="unstarted",
            default=True,
            project=project,
        )
        source_issue = Issue.objects.create(name="Game", project=project, state=state, sg_event_id=442)
        other_player = RosterPlayer.objects.create(project=other_project, player_name="Other Player")
        payload = {
            "request_id": str(uuid4()),
            "source_issue_id": str(source_issue.id),
            "player_ids": [str(other_player.id)],
            "title": "Game review",
            "feedback": "Feedback",
            "card_type": "Positive Reinforcement",
            "priority": "Standard",
            "sport_label": "Basketball",
            "playlists": [{"id": "playlist-1", "name": "Plays", "clips": [_clip()]}],
        }

        response = session_client.post(
            f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/create-coaching-cards/",
            payload,
            format="json",
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "player_ids" in response.json()
        assert not Issue.objects.filter(project=project, category="Coaching Card").exists()


@pytest.mark.contract
@pytest.mark.django_db
@pytest.mark.parametrize("linked", [False, True])
@pytest.mark.parametrize("annotation_state", ["saved", "empty", "missing"])
def test_uploaded_video_cards_snapshot_annotations_and_replay(
    session_client, workspace, create_user, settings, tmp_path, linked, annotation_state
):
    import json
    from plane.utils.media_library import manifest_path

    settings.MEDIA_LIBRARY_ROOT = str(tmp_path)
    project = Project.objects.create(name="Basketball", identifier="BALL", workspace=workspace, sport="Basketball")
    ProjectMember.objects.create(project=project, member=create_user, role=20, is_active=True)
    state = State.objects.create(name="Scheduled", color="#333333", group="unstarted", default=True, project=project)
    source = Issue.objects.create(project=project, state=state, name="Practice") if linked else None
    players = [RosterPlayer.objects.create(project=project, player_name=name) for name in ("Jordan", "Taylor")]
    annotations = [{"id": "audio-1", "type": "audio", "startTime": 1, "endTime": 4, "content": "/saved/audio.webm"}]
    metadata = {
        "sport": "Basketball",
        "season": "2026",
        "duration_seconds": 30,
        "category": "Practice",
        "location": "Home",
        "tags": ["Footwork", "Defense"],
        "start_date": "2026-09-28",
        "start_time": "10:30",
        "created_by": str(create_user.id),
    }
    if annotation_state != "missing":
        metadata["annotations"] = annotations if annotation_state == "saved" else []
    if source:
        metadata["work_item_id"] = str(source.id)
    path = manifest_path(str(project.id), "library")
    path.parent.mkdir(parents=True)
    path.write_text(
        json.dumps({"artifacts": [{"name": "video-1", "title": "Practice video", "format": "mp4", "meta": metadata}]})
    )
    payload = {
        "request_id": str(uuid4()),
        "source_media": {"package_id": "library", "artifact_id": "video-1"},
        "player_ids": [str(player.id) for player in players],
        "title": "Footwork",
        "feedback": "Stay low",
        "card_type": "Correction",
        "priority": "Standard",
    }
    if annotation_state == "saved":
        payload["context"] = {"sport": "Soccer", "level": "Senior", "program": "Women", "season": "2027"}
    url = f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/create-coaching-cards/"
    response = session_client.post(url, payload, format="json")
    assert response.status_code == 201, response.data
    cards = list(Issue.objects.filter(project=project, category="Coaching Card"))
    assert len(cards) == 2
    assert all(card.parent_id == (source.id if source else None) for card in cards)
    assert all(card.state.name == "New" for card in cards)
    data = cards[0].coaching_card_data
    assert data["source_media"]["annotations"] == (annotations if annotation_state == "saved" else [])
    assert data["source_media"]["artifact_id"] == "video-1"
    assert data["source_media"]["metadata"]["tags"] == ["Footwork", "Defense"]
    assert data["source_media"]["metadata"]["location"] == "Home"
    assert data["schema_version"] == 3
    assert data["summary"]["clip_count"] == 1
    assert data["metadata"]["season"] == ("2027" if annotation_state == "saved" else "2026")
    assert data["metadata"]["sport"] == ("Soccer" if annotation_state == "saved" else "Basketball")
    assert data["metadata"]["category"] == "Practice"
    assert data["metadata"]["tags"] == ["Footwork", "Defense"]
    assert cards[0].level == ("Senior" if annotation_state == "saved" else None)
    if not source:
        assert data["source_issue"] is None
    replay = session_client.post(url, payload, format="json")
    assert replay.status_code == 200
    assert replay.data["idempotent_replay"] is True
    assert Issue.objects.filter(project=project, category="Coaching Card").count() == 2


@pytest.mark.contract
@pytest.mark.django_db
@pytest.mark.parametrize(
    "invalid",
    ["nonvideo", "missing", "traversal", "conflicting", "playlists", "foreign_player", "foreign_media"],
)
def test_uploaded_video_card_rejects_invalid_sources(
    session_client, workspace, create_user, settings, tmp_path, invalid
):
    import json
    from plane.utils.media_library import manifest_path

    settings.MEDIA_LIBRARY_ROOT = str(tmp_path)
    project = Project.objects.create(name="Basketball", identifier="BALL", workspace=workspace)
    ProjectMember.objects.create(project=project, member=create_user, role=20, is_active=True)
    other = Project.objects.create(name="Other", identifier="OTHER", workspace=workspace)
    player = RosterPlayer.objects.create(
        project=other if invalid == "foreign_player" else project, player_name="Jordan"
    )
    annotations = [{"id": "a", "type": "arrow", "startTime": 0, "endTime": 2}]
    path = manifest_path(str(other.id if invalid == "foreign_media" else project.id), "library")
    path.parent.mkdir(parents=True)
    path.write_text(
        json.dumps(
            {
                "artifacts": [
                    {
                        "name": "video-1",
                        "title": "Practice",
                        "format": "json" if invalid == "nonvideo" else "mp4",
                        "meta": {"annotations": annotations},
                    }
                ]
            }
        )
    )
    payload = {
        "request_id": str(uuid4()),
        "source_media": {
            "package_id": "../library" if invalid == "traversal" else "library",
            "artifact_id": "missing" if invalid == "missing" else "video-1",
        },
        "player_ids": [str(player.id)],
        "title": "Footwork",
        "card_type": "Correction",
        "priority": "Standard",
    }
    if invalid == "conflicting":
        payload["source_issue_id"] = str(uuid4())
    if invalid == "playlists":
        payload["playlists"] = [{"id": "fake", "name": "Fake", "clips": [_clip()]}]
    response = session_client.post(
        f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/create-coaching-cards/", payload, format="json"
    )
    assert response.status_code in (400, 404), response.data
    assert not Issue.objects.filter(project=project, category="Coaching Card").exists()
