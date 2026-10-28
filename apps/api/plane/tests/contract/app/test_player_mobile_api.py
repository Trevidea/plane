from uuid import uuid4

import pytest
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APIClient

from plane.db.models import APIActivityLog, Issue, Project, RosterPlayer, State, WorkspaceMember
from plane.license.models import Instance


@pytest.fixture
def player_program(workspace, create_user):
    project = Project.objects.create(workspace=workspace, name="Player Program", identifier="PLAYER")
    state = State.objects.create(project=project, name="Assigned", color="#2299aa")
    player = RosterPlayer.objects.create(project=project, user=create_user, player_name="Test Player")
    card = Issue.objects.create(
        project=project,
        state=state,
        name="Footwork",
        category="Coaching Card",
        coaching_card_data={"recipient_ids": [str(player.id)], "review": {}},
    )
    return project, player, card


@pytest.fixture
def player_login_client(player_program):
    cache.clear()
    Instance.objects.create(
        instance_name="Test",
        instance_id=str(uuid4()),
        current_version="test",
        last_checked_at=timezone.now(),
        is_setup_done=True,
    )
    return APIClient(enforce_csrf_checks=True)


def _sign_in(client, password="test-password", **headers):
    bootstrap = client.get("/auth/player/session/", secure=True)
    return client.post(
        "/auth/player/sign-in/",
        {"email": "test@plane.so", "password": password},
        format="json",
        secure=True,
        HTTP_X_CSRFTOKEN=bootstrap.json()["csrf_token"],
        HTTP_ORIGIN="https://testserver",
        **headers,
    )


@pytest.mark.contract
@pytest.mark.django_db
class TestPlayerMobileAPI:
    def test_real_session_login_restore_and_logout(self, player_login_client, create_user, settings):
        client = player_login_client
        bootstrap = client.get("/auth/player/session/", secure=True)
        assert bootstrap.json()["is_authenticated"] is False
        assert "no-store" in bootstrap["Cache-Control"]
        response = _sign_in(client)
        assert response.status_code == 200
        assert response.json()["user"]["id"] == str(create_user.id)
        cookie = response.cookies[settings.SESSION_COOKIE_NAME]
        assert cookie["httponly"]
        restored = client.get("/auth/player/session/", secure=True)
        assert restored.json()["is_authenticated"] is True
        assert "email" not in restored.json()["user"]
        signed_out = client.post(
            "/auth/player/sign-out/",
            {},
            format="json",
            secure=True,
            HTTP_X_CSRFTOKEN=restored.json()["csrf_token"],
            HTTP_ORIGIN="https://testserver",
        )
        assert signed_out.status_code == 200
        assert client.get("/auth/player/session/", secure=True).json()["is_authenticated"] is False

    def test_login_and_logout_require_csrf(self, player_login_client):
        client = player_login_client
        assert client.post("/auth/player/sign-in/", {}, format="json", secure=True).status_code == 403
        assert _sign_in(client).status_code == 200
        assert client.post("/auth/player/sign-out/", {}, format="json", secure=True).status_code == 403
        assert client.get("/auth/player/session/", secure=True).json()["is_authenticated"] is True

    def test_bad_credentials_and_disabled_user_do_not_authenticate(self, player_login_client, create_user):
        assert _sign_in(player_login_client, password="wrong").status_code == 401
        create_user.is_active = False
        create_user.save(update_fields=["is_active"])
        assert _sign_in(player_login_client).status_code == 401

    def test_account_throttle(self, player_login_client, settings):
        settings.PLAYER_SIGN_IN_ACCOUNT_RATE = "1/min"
        assert _sign_in(player_login_client, password="wrong").status_code == 401
        assert _sign_in(player_login_client, password="wrong").status_code == 429

    def test_malformed_credentials_return_validation_error(self, player_login_client):
        client = player_login_client
        csrf = client.get("/auth/player/session/", secure=True).json()["csrf_token"]
        response = client.post(
            "/auth/player/sign-in/",
            ["not", "an", "object"],
            format="json",
            secure=True,
            HTTP_X_CSRFTOKEN=csrf,
            HTTP_ORIGIN="https://testserver",
        )
        assert response.status_code == 400

    def test_password_and_csrf_are_not_written_to_api_activity_logs(self, player_login_client):
        assert _sign_in(player_login_client, HTTP_X_API_KEY="untrusted-header").status_code == 200
        assert not APIActivityLog.objects.filter(path__startswith="/auth/player/").exists()

    def test_coach_cookie_is_not_a_player_session(self, player_program, create_user, settings):
        client = APIClient()
        client.force_login(create_user)
        cookie = client.cookies.pop(settings.SESSION_COOKIE_NAME)
        client.cookies[settings.COACH_SESSION_COOKIE_NAME] = cookie.value
        assert client.get("/auth/player/session/").json()["is_authenticated"] is False
        assert client.get("/api/player/programs/").status_code in (401, 403)

    def test_discovery_uses_explicit_linkage_not_coach_project_access(self, session_client, player_program, workspace):
        project, player, _ = player_program
        Project.objects.create(workspace=workspace, name="Other Program", identifier="OTHER")
        response = session_client.get("/api/player/programs/?limit=1&offset=0")
        assert response.status_code == 200
        assert response.json()["total_count"] == 1
        row = response.json()["results"][0]
        assert row["id"] == str(project.id)
        assert row["player_id"] == str(player.id)
        assert row["stages"][0]["name"] == "Assigned"
        assert "no-store" in response["Cache-Control"]
        assert session_client.get("/api/player/programs/?limit=101").status_code == 400

    @pytest.mark.parametrize(
        "revocation", ["inactive", "pending", "membership", "archive", "roster_delete", "project_delete"]
    )
    def test_revocation_is_consistent_for_discovery_cards_and_review(
        self, session_client, player_program, workspace, create_user, revocation
    ):
        project, player, card = player_program
        if revocation in ("inactive", "pending"):
            player.status = revocation
            player.save(update_fields=["status"])
        elif revocation == "membership":
            WorkspaceMember.objects.filter(workspace=workspace, member=create_user).update(is_active=False)
        elif revocation == "archive":
            project.archived_at = timezone.now()
            project.save(update_fields=["archived_at"])
        elif revocation == "project_delete":
            project.delete()
        else:
            player.delete()
        assert session_client.get("/api/player/programs/").json()["results"] == []
        base = f"/api/workspaces/{workspace.slug}/projects/{project.id}/coaching-cards"
        assert session_client.get(f"{base}/mine/").status_code == 404
        assert session_client.post(f"{base}/{card.id}/review-complete/", {}, format="json").status_code == 404

    def test_unlinked_user_cannot_sign_in_to_player_app(self, player_login_client, player_program):
        _, player, _ = player_program
        player.user = None
        player.save(update_fields=["user"])
        assert _sign_in(player_login_client).status_code == 403

    def test_mine_lists_only_assigned_cards_without_project_membership(self, session_client, player_program, workspace):
        project, _, card = player_program
        Issue.objects.create(project=project, state=card.state, name="Other player's card", category="Coaching Card")
        response = session_client.get(f"/api/workspaces/{workspace.slug}/projects/{project.id}/coaching-cards/mine/")
        assert response.status_code == 200
        assert response.json()["total_count"] == 1
        assert response.json()["results"][0]["id"] == str(card.id)
        assert "no-store" in response["Cache-Control"]
        assert "recipient_ids" not in response.json()["results"][0]["coaching_card_data"]

    def test_linked_player_reads_stage_config_without_coach_project_role(
        self, session_client, player_program, workspace
    ):
        project, _, card = player_program
        project.sport = "Basketball"
        project.save(update_fields=["sport"])
        state_count = State.objects.filter(project=project).count()
        response = session_client.get(
            f"/api/player/workspaces/{workspace.slug}/projects/{project.id}/coaching-card-config/"
        )
        assert response.status_code == 200
        assert response.json()["stages"][0]["id"] == str(card.state_id)
        assert "no-store" in response["Cache-Control"]
        assert State.objects.filter(project=project).count() == state_count

    def test_stage_config_rejects_unlinked_and_wrong_workspace(self, session_client, player_program, workspace):
        project, player, _ = player_program
        path = f"/api/player/workspaces/{workspace.slug}/projects/{project.id}/coaching-card-config/"
        assert session_client.get(path.replace(workspace.slug, "other-workspace")).status_code == 404
        player.user = None
        player.save(update_fields=["user"])
        assert session_client.get(path).status_code == 404
