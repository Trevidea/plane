from uuid import uuid4
from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import CardStageHistory, Issue, Project, ProjectMember, RosterPlayer, State, User, WorkspaceMember
from plane.bgtasks.coaching_card_review_task import advance_expired_coaching_card_reviews
from plane.utils.coaching_card_lifecycle import default_project_state_definitions
from plane.utils.coaching_card_lifecycle import advance_card_after_review


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
    def test_creates_one_shared_issue_for_all_players_and_replays_idempotently(
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
        assert response.json()["created_count"] == 1
        cards = list(Issue.objects.filter(project=project, category="Coaching Card").order_by("sequence_id"))
        assert len(cards) == 1
        assert cards[0].roster_player_id is None
        assert cards[0].coaching_card_data["recipient_ids"] == [str(player.id) for player in players]
        assert len(cards[0].coaching_card_data["recipients"]) == 2
        assert cards[0].coaching_card_data["review"]["deadline_at"] is None
        assert all(card.state_id == event_state.id for card in cards)
        assert State.objects.filter(project=project).count() == 1
        assert all(card.parent_id == source_issue.id for card in cards)
        assert all(card.sg_event_id is None for card in cards)
        assert all(card.name == "Improve closeout footwork" for card in cards)
        assert cards[0].coaching_card_data["request_id"] == request_id
        assert cards[0].coaching_card_data["playlists"][0]["clips"][0]["result"] == "Made"
        assert cards[0].coaching_card_data["primary_clip"]["clip_id"] == "clip-1"
        assert cards[0].coaching_card_data["card_type"] == "Correction"
        assert cards[0].coaching_card_data["priority"] == "Game Plan Critical"
        assert cards[0].coaching_card_data["metadata"]["season"] == "2026-27"
        assert cards[0].coaching_card_data["metadata"]["author"]["id"] == str(create_user.id)
        assert cards[0].coaching_card_data["schema_version"] == 3

        replay = session_client.post(url, payload, format="json")

        assert replay.status_code == status.HTTP_200_OK
        assert replay.json()["created_count"] == 0
        assert replay.json()["idempotent_replay"] is True
        assert Issue.objects.filter(project=project, category="Coaching Card").count() == 1
        filtered = session_client.get(
            f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/",
            {
                "layout": "list",
                "coaching_cards": "true",
                "cursor": "100:0:0",
                "assignment": "player",
                "assignment_id": str(players[1].id),
            },
        )
        assert filtered.status_code == 200
        assert [str(issue["id"]) for issue in filtered.data["results"]] == [str(cards[0].id)]

        payload["request_id"] = str(uuid4())
        payload["player_ids"] = []
        unassigned = session_client.post(url, payload, format="json")
        assert unassigned.status_code == 201
        unassigned_card = Issue.objects.get(pk=unassigned.json()["cards"][0]["id"])
        assert unassigned_card.coaching_card_data["recipient_ids"] == []
        assert unassigned_card.coaching_card_data["review"]["deadline_at"] is None

    @pytest.mark.django_db
    def test_creates_position_group_card_with_selected_context(self, session_client, workspace, create_user):
        project = Project.objects.create(name="Basketball", identifier="BALL", workspace=workspace, sport="Basketball")
        ProjectMember.objects.create(project=project, member=create_user, role=20, is_active=True)
        state = State.objects.create(
            name="Scheduled", color="#333333", group="unstarted", default=True, project=project
        )
        source = Issue.objects.create(name="Game", project=project, state=state, sg_event_id=443)
        RosterPlayer.objects.create(project=project, player_name="Jordan", position="Guard")
        payload = {
            "request_id": str(uuid4()),
            "source_issue_id": str(source.id),
            "player_ids": [],
            "position_group": "Guard",
            "title": "Review defense",
            "card_type": "Correction",
            "priority": "Standard",
            "sport_label": "Basketball",
            "program": "Men's Basketball",
            "level": "Varsity",
            "season": "2026-27",
            "playlists": [{"id": "playlist-1", "name": "Plays", "clips": [_clip()]}],
        }
        url = f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/create-coaching-cards/"

        response = session_client.post(url, payload, format="json")

        assert response.status_code == status.HTTP_201_CREATED
        card = Issue.objects.get(project=project, category="Coaching Card")
        assert card.roster_player_id is None
        assert card.position_group == "Guard"
        assert len(card.coaching_card_data["recipients"]) == 1
        assert (card.program, card.level, card.year) == ("Men's Basketball", "Varsity", "2026-27")
        filtered = session_client.get(
            f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/",
            {
                "layout": "list",
                "coaching_cards": "true",
                "cursor": "100:0:0",
                "sport": "Basketball",
                "program": "Men's Basketball",
                "level": "Varsity",
                "season": "2026-27",
                "stage_id": str(card.state_id),
                "assignment": "group",
                "assignment_id": "Guard",
            },
        )
        assert filtered.status_code == 200
        assert [str(issue["id"]) for issue in filtered.data["results"]] == [str(card.id)]
        assert (
            session_client.get(
                f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/",
                {
                    "layout": "list",
                    "coaching_cards": "true",
                    "cursor": "100:0:0",
                    "assignment": "player",
                },
            ).data["total_count"]
            == 1
        )

        payload["request_id"] = str(uuid4())
        payload["player_ids"] = [str(RosterPlayer.objects.get(project=project).id)]
        assert session_client.post(url, payload, format="json").status_code == status.HTTP_400_BAD_REQUEST

        payload["request_id"] = str(uuid4())
        payload["player_ids"] = []
        payload["position_group"] = "Nonexistent"
        assert session_client.post(url, payload, format="json").status_code == status.HTTP_400_BAD_REQUEST

    @pytest.mark.django_db
    def test_transition_moves_one_stage_and_records_actor(self, session_client, workspace, create_user):
        project = Project.objects.create(name="Basketball", identifier="BALL", workspace=workspace, sport="Basketball")
        ProjectMember.objects.create(project=project, member=create_user, role=20, is_active=True)
        initial = State.objects.create(name="New", color="#333", group="backlog", sequence=1000, project=project)
        review = State.objects.create(name="Review", color="#444", group="started", sequence=2000, project=project)
        final = State.objects.create(name="Complete", color="#555", group="completed", sequence=3000, project=project)
        source = Issue.objects.create(
            name="Game",
            project=project,
            state=initial,
            sg_event_id=444,
            program="Men's Basketball",
            level="Varsity",
            year="2026-27",
        )
        player = RosterPlayer.objects.create(project=project, player_name="Jordan")
        payload = {
            "request_id": str(uuid4()),
            "source_issue_id": str(source.id),
            "player_ids": [str(player.id)],
            "title": "Review",
            "card_type": "Correction",
            "priority": "Standard",
            "playlists": [{"id": "playlist-1", "name": "Plays", "clips": [_clip()]}],
        }
        root = f"/api/workspaces/{workspace.slug}/projects/{project.id}"
        created = session_client.post(f"{root}/issues/create-coaching-cards/", payload, format="json")
        assert created.status_code == status.HTTP_201_CREATED
        card_id = created.json()["cards"][0]["id"]
        config = session_client.get(f"{root}/coaching-card-config/").json()
        assert config["initial_stage_id"] == str(initial.id)
        assert [stage["name"] for stage in config["stages"]] == ["New", "Review", "Complete"]

        url = f"{root}/coaching-cards/{card_id}/transition/"
        assert Issue.objects.get(id=card_id).state_id == initial.id
        assert session_client.post(url, {"stage_id": str(initial.id)}, format="json").status_code == 400
        assert session_client.post(url, {"stage_id": str(final.id)}, format="json").status_code == 400
        assert session_client.post(url, {"stage_id": str(review.id)}, format="json").status_code == 200
        card = Issue.objects.get(id=card_id)
        assert card.state_id == review.id
        history = CardStageHistory.objects.get(issue=card)
        assert (history.from_stage_id, history.to_stage_id, history.changed_by_id) == (
            initial.id,
            review.id,
            create_user.id,
        )
        assert session_client.post(url, {"stage_id": str(final.id)}, format="json").status_code == 200
        assert session_client.post(url, {"stage_id": str(review.id)}, format="json").status_code == 400
        assert (
            session_client.post(url, {"stage_id": str(initial.id), "reason": "Try again"}, format="json").status_code
            == 400
        )
        assert (
            session_client.post(
                url, {"stage_id": str(review.id), "reason": "Needs practice"}, format="json"
            ).status_code
            == 200
        )
        assert CardStageHistory.objects.filter(issue=card).count() == 3
        assert (
            session_client.get(f"{root}/coaching-cards/{card_id}/stage-history/").json()[-1]["reason"]
            == "Needs practice"
        )

        detail_url = f"{root}/coaching-cards/{card_id}/"
        updated = session_client.patch(
            detail_url, {"title": "Better defense", "position_group": "Guard"}, format="json"
        )
        assert updated.status_code == 400  # The group must exist in this roster.
        player.position = "Guard"
        player.save()
        updated = session_client.patch(
            detail_url, {"title": "Better defense", "position_group": "Guard"}, format="json"
        )
        assert updated.status_code == 200
        card.refresh_from_db()
        assert card.name == "Better defense"
        assert card.position_group == "Guard"
        assert card.roster_player_id is None
        assert card.coaching_card_data["playlists"][0]["clips"][0]["id"] == "clip-1"
        assert card.coaching_card_data["recipient_ids"] == [str(player.id)]
        assert session_client.patch(f"{root}/issues/{card_id}/", {"name": "Bypass"}, format="json").status_code == 400
        card.refresh_from_db()
        assert card.name == "Better defense"

        membership = ProjectMember.objects.get(project=project, member=create_user)
        membership.role = 5
        membership.save()
        WorkspaceMember.objects.filter(workspace=workspace, member=create_user).update(role=15)
        assert session_client.get(detail_url).status_code == 200
        assert session_client.get(f"{root}/coaching-card-config/").status_code == 200
        assert session_client.patch(f"{root}/coaching-card-config/", {"stages": []}, format="json").status_code == 405
        assert (
            session_client.patch(
                f"{root}/states/{config['initial_stage_id']}/", {"name": "Guest Rename"}, format="json"
            ).status_code
            == 403
        )
        assert session_client.post(url, {"stage_id": str(final.id)}, format="json").status_code == 403
        assert session_client.patch(detail_url, {"title": "Guest edit"}, format="json").status_code == 403

    @pytest.mark.django_db
    def test_stage_names_follow_existing_program_states(self, session_client, workspace, create_user):
        projects = [
            Project.objects.create(name=name, identifier=identifier, workspace=workspace, sport=sport)
            for name, identifier, sport in (
                ("American Football A", "AFA", "American Football"),
                ("American Football B", "AFB", "American Football"),
                ("Basketball", "BAS", "Basketball"),
            )
        ]
        for project in projects:
            ProjectMember.objects.create(project=project, member=create_user, role=20, is_active=True)
            State.objects.create(name="New", color="#333", group="backlog", project=project)
            State.objects.create(name="Backlog", color="#444", group="backlog", project=project)
            State.objects.create(name="Todo", color="#555", group="unstarted", project=project)

        def config_url(project):
            return f"/api/workspaces/{workspace.slug}/projects/{project.id}/coaching-card-config/"

        first = session_client.get(config_url(projects[0])).json()
        assert [stage["name"] for stage in first["stages"]] == ["New", "Backlog", "Todo"]
        assert list(State.objects.filter(project=projects[0]).order_by("sequence").values_list("name", flat=True)) == [
            "New",
            "Backlog",
            "Todo",
        ]
        assert [stage["id"] for stage in first["stages"]] == [
            str(state.id) for state in State.objects.filter(project=projects[0]).order_by("sequence")
        ]
        assert State.objects.filter(project=projects[0]).count() == 3

        state_url = f"/api/workspaces/{workspace.slug}/projects/{projects[0].id}/states/{first['initial_stage_id']}/"
        assert session_client.patch(state_url, {"name": "Film Intake"}, format="json").status_code == 200
        assert session_client.get(config_url(projects[0])).json()["stages"][0]["name"] == "Film Intake"
        assert session_client.get(config_url(projects[1])).json()["stages"][0]["name"] == "New"
        assert session_client.get(config_url(projects[2])).json()["stages"][0]["name"] == "New"
        assert State.objects.filter(project=projects[0]).count() == 3
        v1_state_url = (
            f"/api/v1/workspaces/{workspace.slug}/projects/{projects[0].id}/states/{first['initial_stage_id']}/"
        )
        assert session_client.patch(v1_state_url, {"name": "Coach Intake"}, format="json").status_code == 200
        assert session_client.get(config_url(projects[0])).json()["stages"][0]["name"] == "Coach Intake"
        assert session_client.get(config_url(projects[1])).json()["stages"][0]["name"] == "New"

    @pytest.mark.django_db
    def test_new_sport_program_uses_coaching_names_as_default_states(self, workspace):
        project = Project.objects.create(
            name="American Football", identifier="FOO", workspace=workspace, sport="American Football"
        )
        names = [state["name"] for state in default_project_state_definitions(project)]
        assert names == [
            "Identified",
            "Assigned",
            "In Work",
            "Ready for Coach Review",
            "Resolved",
            "Cancelled",
        ]

    @pytest.mark.django_db
    def test_project_create_endpoint_persists_sport_state_defaults(self, session_client, workspace):
        response = session_client.post(
            f"/api/workspaces/{workspace.slug}/projects/",
            {"name": "New Football Program", "identifier": "NFP", "sport": "American Football"},
            format="json",
        )
        assert response.status_code == 201, response.data
        project = Project.objects.get(identifier="NFP", workspace=workspace)
        states = list(
            State.objects.filter(project=project).order_by("sequence").values_list("name", "group", "default")
        )
        assert states == [
            ("Identified", "backlog", True),
            ("Assigned", "unstarted", False),
            ("In Work", "started", False),
            ("Ready for Coach Review", "started", False),
            ("Resolved", "completed", False),
            ("Cancelled", "cancelled", False),
        ]

        config_url = f"/api/workspaces/{workspace.slug}/projects/{project.id}/coaching-card-config/"
        config = session_client.get(config_url).json()
        assert [stage["name"] for stage in config["stages"]] == [name for name, _, _ in states[:-1]]
        assert session_client.patch(config_url, {"stages": []}, format="json").status_code == 405
        response = session_client.post(
            f"/api/workspaces/{workspace.slug}/projects/",
            {"name": "Second Football Program", "identifier": "SFP", "sport": "American Football"},
            format="json",
        )
        assert response.status_code == 201, response.data
        second = Project.objects.get(identifier="SFP", workspace=workspace)
        assert State.objects.filter(project=second, default=True).get().name == "Identified"

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
    assert len(cards) == 1
    assert cards[0].roster_player_id is None
    assert all(card.parent_id == (source.id if source else None) for card in cards)
    assert all(card.state_id == state.id for card in cards)
    data = cards[0].coaching_card_data
    assert data["recipient_ids"] == [str(player.id) for player in players]
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
    assert cards[0].level == ("Senior" if annotation_state == "saved" else "")
    if not source:
        assert data["source_issue"] is None
    replay = session_client.post(url, payload, format="json")
    assert replay.status_code == 200
    assert replay.data["idempotent_replay"] is True
    assert Issue.objects.filter(project=project, category="Coaching Card").count() == 1


@pytest.mark.contract
@pytest.mark.django_db
@pytest.mark.parametrize("project_sport", ["Basketball", ""])
@pytest.mark.parametrize("context", [None, {"sport": None, "level": None, "program": None, "season": None}])
def test_uploaded_video_card_creates_without_metadata(
    session_client, workspace, create_user, settings, tmp_path, project_sport, context
):
    import json
    from plane.utils.media_library import manifest_path

    settings.MEDIA_LIBRARY_ROOT = str(tmp_path)
    project = Project.objects.create(name="Practice", identifier="PRACTICE", workspace=workspace, sport=project_sport)
    ProjectMember.objects.create(project=project, member=create_user, role=20, is_active=True)
    state = State.objects.create(name="Identified", color="#333333", group="unstarted", project=project)
    player = RosterPlayer.objects.create(project=project, player_name="Jordan")
    path = manifest_path(str(project.id), "library")
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps({"artifacts": [{"name": "video-1", "title": "Practice", "format": "mp4"}]}))
    payload = {
        "request_id": str(uuid4()),
        "source_media": {"package_id": "library", "artifact_id": "video-1"},
        "player_ids": [str(player.id)],
        "title": "Review",
        "card_type": "Correction",
        "priority": "Standard",
    }
    if context is not None:
        payload["context"] = context
    response = session_client.post(
        f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/create-coaching-cards/", payload, format="json"
    )
    assert response.status_code == 201, response.data
    card = Issue.objects.get(project=project, category="Coaching Card")
    assert card.parent_id is None
    assert card.state_id == state.id
    assert card.level == ""
    assert card.year == ""
    assert card.coaching_card_data["source_media"]["artifact_id"] == "video-1"
    assert card.coaching_card_data["summary"]["clip_count"] == 1


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


@pytest.mark.contract
class TestCoachingCardLifecycle:
    @pytest.mark.django_db
    def test_strict_stage_rules_and_reopen_reason_are_enforced_by_api(self, session_client, workspace, create_user):
        project = Project.objects.create(name="Football", identifier="FOOT", workspace=workspace, sport="Football")
        ProjectMember.objects.create(project=project, member=create_user, role=20, is_active=True)
        stages = [
            State.objects.create(name=name, color="#333", group="started", sequence=index * 1000, project=project)
            for index, name in enumerate(["Identified", "Assigned", "In Work", "Ready for Coach Review", "Resolved"])
        ]
        player = RosterPlayer.objects.create(project=project, player_name="Jordan")
        card = Issue.objects.create(
            name="Pass protection",
            project=project,
            state=stages[0],
            category="Coaching Card",
            coaching_card_data={"kind": "coaching_card", "recipient_ids": []},
        )
        root = f"/api/workspaces/{workspace.slug}/projects/{project.id}/coaching-cards/{card.id}"
        url = f"{root}/transition/"
        assert session_client.post(url, {"stage_id": str(stages[1].id)}, format="json").status_code == 400
        assert session_client.post(url, {"stage_id": str(stages[4].id)}, format="json").status_code == 400
        card.refresh_from_db()
        assert card.state_id == stages[0].id
        assert CardStageHistory.objects.filter(issue=card).count() == 0

        assigned = session_client.patch(f"{root}/", {"player_ids": [str(player.id)]}, format="json")
        assert assigned.status_code == 200
        card.refresh_from_db()
        assert card.state_id == stages[1].id
        for target in stages[2:]:
            rejected = session_client.post(url, {"stage_id": str(target.id)}, format="json")
            assert rejected.status_code == 400
            assert "automatic" in rejected.json()["stage_id"][0]
        assert (
            session_client.patch(
                f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/{card.id}/",
                {"state_id": str(stages[2].id)},
                format="json",
            ).status_code
            == 400
        )
        assert CardStageHistory.objects.filter(issue=card).count() == 1

        for reason in ("", "   ", "x" * 2001):
            assert (
                session_client.post(url, {"stage_id": str(stages[0].id), "reason": reason}, format="json").status_code
                == 400
            )
        reopened = session_client.post(
            url, {"stage_id": str(stages[0].id), "reason": "  Wrong recipients  ", "sort_order": 42.5}, format="json"
        )
        assert reopened.status_code == 200
        card.refresh_from_db()
        assert card.state_id == stages[0].id
        assert card.sort_order == 42.5
        assert card.coaching_card_data["review"]["deadline_at"] is None
        history = session_client.get(f"{root}/stage-history/").json()
        assert history[-1]["reason"] == "Wrong recipients"
        assert history[-1]["changed_by_id"] == str(create_user.id)
        assert history[-1]["from_stage_name"] == "Assigned"
        assert history[-1]["to_stage_name"] == "Identified"
        assert (
            session_client.post(url, {"stage_id": str(stages[0].id), "sort_order": 80}, format="json").status_code
            == 200
        )
        assert CardStageHistory.objects.filter(issue=card).count() == 2

        card.state = stages[4]
        card.save()
        assert (
            session_client.post(url, {"stage_id": str(stages[0].id), "reason": "Needs work"}, format="json").status_code
            == 400
        )
        assert (
            session_client.post(url, {"stage_id": str(stages[3].id), "reason": "Needs work"}, format="json").status_code
            == 200
        )

    @pytest.mark.django_db
    def test_linked_player_review_advances_shared_card(self, session_client, workspace, create_user):
        project = Project.objects.create(name="Football", identifier="FOOT", workspace=workspace, sport="Football")
        ProjectMember.objects.create(project=project, member=create_user, role=20, is_active=True)
        initial = State.objects.create(
            name="Film Tagged", color="#333", group="backlog", sequence=1000, project=project
        )
        assigned = State.objects.create(
            name="Assigned", color="#444", group="unstarted", sequence=2000, project=project
        )
        reviewed = State.objects.create(
            name="Player Reviewed", color="#555", group="started", sequence=3000, project=project
        )
        source = Issue.objects.create(
            name="Game", project=project, state=initial, program="Football", level="Varsity", year="2026-27"
        )
        player = RosterPlayer.objects.create(project=project, player_name="Jordan")
        root = f"/api/workspaces/{workspace.slug}/projects/{project.id}"
        created = session_client.post(
            f"{root}/issues/create-coaching-cards/",
            {
                "request_id": str(uuid4()),
                "source_issue_id": str(source.id),
                "player_ids": [str(player.id)],
                "title": "Review game film",
                "card_type": "Correction",
                "priority": "Standard",
                "playlists": [{"id": "playlist-1", "name": "Plays", "clips": [_clip()]}],
            },
            format="json",
        )
        assert created.status_code == 201
        card_id = created.json()["cards"][0]["id"]
        card = Issue.objects.get(pk=card_id)
        assert card.state_id == assigned.id
        review_url = f"{root}/coaching-cards/{card_id}/review-complete/"
        assert session_client.post(review_url).status_code == 404
        player_account = User.objects.create(email="player-review@example.com", username="player-review")
        WorkspaceMember.objects.create(workspace=workspace, member=player_account, role=5, is_active=True)
        linked = session_client.patch(f"{root}/roster/{player.id}/", {"user": str(player_account.id)}, format="json")
        assert linked.status_code == 200
        player_client = APIClient()
        player_client.force_authenticate(user=player_account)
        Issue.objects.create(
            name="Another player's card",
            project=project,
            state=assigned,
            category="Coaching Card",
            coaching_card_data={"recipient_ids": [str(uuid4())], "kind": "coaching_card"},
        )
        mine = player_client.get(f"{root}/coaching-cards/mine/")
        assert mine.status_code == 200
        assert mine.json()["total_count"] == 1
        assert mine.json()["results"][0]["id"] == str(card.id)
        assert "recipient_ids" not in mine.json()["results"][0]["coaching_card_data"]
        assert "viewed_by" not in mine.json()["results"][0]["coaching_card_data"]["review"]
        reviewed_response = player_client.post(review_url)
        assert reviewed_response.status_code == 200
        assert reviewed_response.json()["review"]["viewed_count"] == 1
        assert "viewed_by" not in reviewed_response.json()["review"]
        assert player_client.post(review_url).status_code == 200
        assert player_client.get(f"{root}/issues/").status_code == 403
        WorkspaceMember.objects.filter(workspace=workspace, member=player_account).update(is_active=False)
        assert player_client.post(review_url).status_code == 404
        assert player_client.get(f"{root}/coaching-cards/mine/").status_code == 404
        card.refresh_from_db()
        assert card.state_id == reviewed.id
        assert len(card.coaching_card_data["review"]["viewed_by"]) == 1
        assert card.coaching_card_data["review"]["completion_reason"] == "all_viewed"
        assert CardStageHistory.objects.filter(issue=card, changed_by__isnull=True).count() == 1

    @pytest.mark.django_db
    def test_review_deadline_advances_once_and_reopen_cancels_pending_review(self, workspace, create_user):
        project = Project.objects.create(name="Football", identifier="FOOT", workspace=workspace, sport="Football")
        initial = State.objects.create(
            name="Film Tagged", color="#333", group="backlog", sequence=1000, project=project
        )
        assigned = State.objects.create(
            name="Assigned", color="#444", group="unstarted", sequence=2000, project=project
        )
        reviewed = State.objects.create(
            name="Player Reviewed", color="#555", group="started", sequence=3000, project=project
        )
        now = timezone.now()
        player_id = str(uuid4())
        data = {
            "schema_version": 3,
            "kind": "coaching_card",
            "stage_id": str(assigned.id),
            "recipient_ids": [player_id],
            "review": {
                "assigned_at": (now - timedelta(days=3)).isoformat(),
                "deadline_at": now.isoformat(),
                "viewed_by": {},
            },
        }
        card = Issue.objects.create(
            name="Review", project=project, state=assigned, category="Coaching Card", coaching_card_data=data
        )
        advance_expired_coaching_card_reviews()
        card.refresh_from_db()
        assert card.state_id == reviewed.id
        assert card.coaching_card_data["review"]["completion_reason"] == "three_day_timeout"
        advance_expired_coaching_card_reviews()
        assert CardStageHistory.objects.filter(issue=card).count() == 1

        second = Issue.objects.create(
            name="Coach move", project=project, state=assigned, category="Coaching Card", coaching_card_data=data
        )
        from plane.utils.coaching_card_lifecycle import transition_coaching_card

        transition_coaching_card(second, initial.id, create_user, "Wrong recipients")
        assert second.coaching_card_data["review"]["deadline_at"] is None
        assert not advance_card_after_review(second, now + timedelta(hours=1))

        future_data = {
            **data,
            "review": {
                "assigned_at": now.isoformat(),
                "deadline_at": (now + timedelta(days=3)).isoformat(),
                "viewed_by": {player_id: now.isoformat()},
            },
            "recipient_ids": [player_id, str(uuid4())],
        }
        third = Issue.objects.create(
            name="Broadcast", project=project, state=assigned, category="Coaching Card", coaching_card_data=future_data
        )
        assert not advance_card_after_review(third, now)
        future_data["review"]["viewed_by"][future_data["recipient_ids"][1]] = now.isoformat()
        third.coaching_card_data = future_data
        third.save(update_fields=["coaching_card_data"])
        assert advance_card_after_review(third, now)
        assert third.state_id == reviewed.id
        assert third.coaching_card_data["review"]["completion_reason"] == "all_viewed"

    @pytest.mark.django_db
    def test_legacy_assigned_stage_advances_to_in_work(self, workspace):
        project = Project.objects.create(name="Football", identifier="FOOT", workspace=workspace, sport="Football")
        State.objects.create(name="Identified", color="#333", group="backlog", sequence=1000, project=project)
        assigned = State.objects.create(
            name="Assigned", color="#444", group="unstarted", sequence=2000, project=project
        )
        in_work = State.objects.create(name="In Work", color="#555", group="started", sequence=3000, project=project)
        now = timezone.now()
        card = Issue.objects.create(
            name="Legacy review",
            project=project,
            state=assigned,
            category="Coaching Card",
            coaching_card_data={
                "schema_version": 3,
                "kind": "coaching_card",
                "stage_id": str(assigned.id),
                "recipient_ids": [str(uuid4())],
                "review": {
                    "assigned_at": (now - timedelta(days=3)).isoformat(),
                    "deadline_at": now.isoformat(),
                    "viewed_by": {},
                },
            },
        )

        assert advance_card_after_review(card, now)
        card.refresh_from_db()
        assert card.state_id == in_work.id
        assert card.coaching_card_data["review"]["completion_reason"] == "three_day_timeout"
        assert not advance_card_after_review(card, now + timedelta(days=1))
        assert CardStageHistory.objects.filter(issue=card).count() == 1


@pytest.mark.contract
@pytest.mark.django_db
def test_rejects_missing_card_context(session_client, workspace, create_user):
    project = Project.objects.create(name="Basketball", identifier="BALL", workspace=workspace, sport="Basketball")
    ProjectMember.objects.create(project=project, member=create_user, role=20, is_active=True)
    state = State.objects.create(name="Scheduled", color="#333", group="unstarted", project=project)
    source = Issue.objects.create(name="Game", project=project, state=state, sg_event_id=445)
    player = RosterPlayer.objects.create(project=project, player_name="Jordan")
    payload = {
        "request_id": str(uuid4()),
        "source_issue_id": str(source.id),
        "player_ids": [str(player.id)],
        "title": "Review",
        "card_type": "Correction",
        "priority": "Standard",
        "playlists": [{"id": "playlist-1", "name": "Plays", "clips": [_clip()]}],
    }
    response = session_client.post(
        f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/create-coaching-cards/",
        payload,
        format="json",
    )
    assert response.status_code == 400
    assert "level" in response.json() and "season" in response.json()
    assert not Issue.objects.filter(project=project, category="Coaching Card").exists()
