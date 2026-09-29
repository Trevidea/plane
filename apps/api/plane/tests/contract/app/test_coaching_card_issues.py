from uuid import uuid4

import pytest
from rest_framework import status

from plane.db.models import CardStageHistory, Issue, Project, ProjectMember, RosterPlayer, State, WorkspaceMember
from plane.utils.coaching_card_lifecycle import default_project_state_definitions


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
            == 0
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
        initial = State.objects.create(name="New", color="#333", group="backlog", project=project)
        middle = State.objects.create(name="Review", color="#444", group="started", project=project)
        final = State.objects.create(name="Complete", color="#555", group="completed", project=project)
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
        assert session_client.post(url, {"stage_id": str(final.id)}, format="json").status_code == 400
        assert session_client.post(url, {"stage_id": str(middle.id)}, format="json").status_code == 200
        card = Issue.objects.get(id=card_id)
        assert card.state_id == middle.id
        history = CardStageHistory.objects.get(issue=card)
        assert (history.from_stage_id, history.to_stage_id, history.changed_by_id) == (
            initial.id,
            middle.id,
            create_user.id,
        )
        assert session_client.post(url, {"stage_id": str(initial.id)}, format="json").status_code == 400
        assert CardStageHistory.objects.filter(issue=card).count() == 1

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
        states = list(State.objects.filter(project=project).order_by("sequence").values_list("name", "default"))
        assert states == [
            ("Identified", True),
            ("Assigned", False),
            ("In Work", False),
            ("Ready for Coach Review", False),
            ("Resolved", False),
            ("Cancelled", False),
        ]

        config_url = f"/api/workspaces/{workspace.slug}/projects/{project.id}/coaching-card-config/"
        config = session_client.get(config_url).json()
        assert [stage["name"] for stage in config["stages"]] == [name for name, _ in states[:-1]]
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

    @pytest.mark.django_db
    def test_rejects_missing_card_context(self, session_client, workspace, create_user):
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
