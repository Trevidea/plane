from unittest.mock import patch
from uuid import uuid4

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from plane.db.models import (
    Issue,
    PlayerRegistrationRequest,
    Project,
    ProjectMember,
    RosterEvent,
    RosterPlayer,
    User,
    Workspace,
    WorkspaceMember,
    WorkspaceMemberInvite,
)

NAME = "Jordan Lee"
YEAR = "2027"


@pytest.fixture
def programs(workspace, create_user):
    prior = Project.objects.create(
        workspace=workspace, name="Football 2025-2026", identifier="OLD", archived_at=timezone.now()
    )
    target = Project.objects.create(workspace=workspace, name="Football 2026-2027", identifier="NEW")
    ProjectMember.objects.create(project=target, member=create_user, role=20)
    root = f"/api/workspaces/{workspace.slug}/projects/{target.pk}/roster/"
    return prior, target, root


def returning(program, email, *, name=NAME, year=YEAR, role=1, jersey=None):
    user = User.objects.create(username=email, email=email)
    WorkspaceMember.objects.create(workspace=program.workspace, member=user, role=role)
    row = RosterPlayer.objects.create(
        project=program, user=user, player_name=name, class_year=year, jersey_number=jersey
    )
    return user, row


def lookup(client, root, name=NAME, year=YEAR):
    return client.post(root + "account-matches/", {"player_name": name, "graduation_year": year}, format="json")


def add(client, root, user, *, year=YEAR, email=""):
    return client.post(
        root,
        {"player_name": NAME, "class_year": year, "existing_account_id": str(user.pk), "email": email},
        format="json",
    )


@pytest.mark.django_db
def test_confirmed_returning_player_reuses_account_without_invite_or_claim(session_client, programs, create_user):
    prior, target, root = programs
    player, old_roster = returning(prior, "jordan@example.test", name=" Jordan\t  Lee ", jersey="12")
    old_tag = Issue.objects.create(project=prior, name="Old match", description={"roster_id": str(old_roster.pk)})
    card = Issue.objects.create(
        project=prior,
        name="Old card",
        category="Coaching Card",
        roster_player=old_roster,
        coaching_card_data={"recipient_ids": [str(old_roster.pk)]},
    )
    result = lookup(session_client, root, name="jordan lee")
    assert result.status_code == 200, result.data
    assert result.json() == {"results": [{"id": str(player.pk), "email": player.email}], "has_more": False}
    assert "no-store" in result.headers["Cache-Control"]
    with patch("plane.app.serializers.roster.attach_imported_roster_member") as invite:
        created = add(session_client, root, player)
        assert created.status_code == 201, created.data
        invite.assert_not_called()
    roster = RosterPlayer.objects.get(project=target, user=player)
    assert roster.pk != old_roster.pk
    assert roster.email == ""  # The login email and optional roster contact are independent.
    assert created.data["account_status"] == "linked"
    assert "existing_account_id" not in created.data
    assert ProjectMember.objects.get(project=target, member=player).role == 1
    assert RosterEvent.objects.filter(roster_player=roster, actor=create_user, action="account_linked").exists()
    assert not PlayerRegistrationRequest.objects.filter(project=target).exists()
    assert not WorkspaceMemberInvite.objects.filter(workspace=target.workspace).exists()
    assert add(session_client, root, player).status_code == 400
    assert RosterPlayer.objects.filter(project=target, user=player).count() == 1
    assert RosterPlayer.objects.get(pk=old_roster.pk).user_id == player.pk
    assert Issue.objects.get(pk=old_tag.pk).description == {"roster_id": str(old_roster.pk)}
    assert Issue.objects.get(pk=card.pk).roster_player_id == old_roster.pk
    player_client = APIClient()
    player_client.force_authenticate(player)
    assert str(target.pk) in {p["id"] for p in player_client.get("/api/player/programs/").json()["results"]}
    notices = player_client.get("/api/player/roster-notices/").json()["results"]
    assert [(notice["kind"], notice["program_id"]) for notice in notices] == [("team_added", str(target.pk))]


@pytest.mark.django_db
def test_scope_year_and_ambiguity_do_not_link_automatically(session_client, programs, create_user):
    prior, target, root = programs
    first, _ = returning(prior, "first@example.test")
    second, _ = returning(prior, "second@example.test")
    different_year, _ = returning(prior, "different@example.test", year="2028")
    school = Workspace.objects.create(owner=create_user, name="Other school", slug="other-school")
    foreign_program = Project.objects.create(workspace=school, name="Football", identifier="OT")
    foreign, _ = returning(foreign_program, "foreign@example.test")

    result = lookup(session_client, root)
    assert result.status_code == 200, result.data
    assert {row["id"] for row in result.json()["results"]} == {str(first.pk), str(second.pk)}
    assert not RosterPlayer.objects.filter(project=target).exists()
    assert lookup(session_client, root, year="Senior").status_code == 400
    assert add(session_client, root, foreign).status_code == 400
    assert add(session_client, root, different_year).status_code == 400
    assert add(session_client, root, first, email=second.email).status_code == 400
    assert not RosterPlayer.objects.filter(project=target).exists()
    assert add(session_client, root, second, email=second.email).status_code == 201


@pytest.mark.django_db
def test_returning_match_cannot_bypass_staff_permission_or_revoked_access(session_client, programs):
    prior, target, root = programs
    player, _ = returning(prior, "jordan@example.test")
    guest = User.objects.create(username="program-only", email="owner@example.test")
    WorkspaceMember.objects.create(workspace=target.workspace, member=guest, role=5)
    ProjectMember.objects.create(project=target, member=guest, role=20)
    limited = APIClient()
    limited.force_authenticate(guest)
    assert lookup(limited, root).status_code == 403
    assert add(limited, root, player).status_code == 403
    assert lookup(session_client, root).json()["results"]
    ProjectMember.objects.create(project=target, member=player, role=1, is_active=False)
    assert lookup(session_client, root).json()["results"] == []
    assert add(session_client, root, player).status_code == 400
    assert not RosterPlayer.objects.filter(project=target).exists()


@pytest.mark.django_db
def test_pending_claim_cannot_be_linked_by_add_or_import(session_client, programs):
    prior, target, root = programs
    player, _ = returning(prior, "jordan@example.test")
    pending = RosterPlayer.objects.create(project=target, player_name=NAME, status="pending")
    PlayerRegistrationRequest.objects.create(project=target, roster_player=pending, user=player)
    assert lookup(session_client, root).json()["results"] == []
    assert add(session_client, root, player).status_code == 400
    uploaded = session_client.post(
        root + "import/",
        {"players": [{"player_name": NAME, "class_year": YEAR, "existing_account_id": str(player.pk)}]},
        format="json",
    )
    assert uploaded.status_code == 400
    assert RosterPlayer.objects.filter(project=target).count() == 1
    assert not ProjectMember.objects.filter(project=target, member=player).exists()


@pytest.mark.django_db
def test_import_preview_groups_returning_matches_without_writing(session_client, programs):
    prior, target, root = programs
    first, _ = returning(prior, "first@example.test")
    second, _ = returning(prior, "second@example.test")
    response = session_client.post(root + "import-matches/", {"rows": [
        {"player_name": NAME, "graduation_year": YEAR},
        {"player_name": "New Player", "graduation_year": YEAR},
    ]}, format="json")
    assert response.status_code == 200, response.content
    assert "no-store" in response.headers["Cache-Control"]
    matched, new = response.json()["rows"]
    assert matched == {"results": [
        {"id": str(first.pk), "email": first.email, "previous_program": prior.name},
        {"id": str(second.pk), "email": second.email, "previous_program": prior.name},
    ], "has_more": False}
    assert new == {"results": [], "has_more": False}
    assert not RosterPlayer.objects.filter(project=target).exists()


@pytest.mark.django_db
def test_mixed_import_links_confirmed_row_and_replays_without_second_write(session_client, programs, create_user):
    prior, target, root = programs
    account, old_row = returning(prior, "returning@example.test")
    payload = {"import_id": str(uuid4()), "players": [
        {"player_name": NAME, "class_year": YEAR, "existing_account_id": str(account.pk)},
        {"player_name": "Email Player", "email": "new@example.test"},
        {"player_name": "QR Player"},
    ]}
    with patch("plane.app.serializers.roster.attach_imported_roster_member") as invite:
        first = session_client.post(root + "import/", payload, format="json")
        assert first.status_code == 201, first.data
        again = session_client.post(root + "import/", payload, format="json")
        assert again.status_code == 201, again.data
        assert again.json() == first.json()
        assert [call.args[0].email for call in invite.call_args_list] == ["new@example.test"]
        changed = session_client.post(root + "import/", {**payload, "players": payload["players"][:1]}, format="json")
        assert changed.status_code == 409, changed.data
    assert RosterPlayer.objects.filter(project=target).count() == 3
    roster = RosterPlayer.objects.get(project=target, user=account)
    assert RosterEvent.objects.filter(roster_player=roster, actor=create_user, action="account_linked").count() == 1
    assert ProjectMember.objects.filter(project=target, member=account, role=1).count() == 1
    assert not PlayerRegistrationRequest.objects.filter(project=target).exists()
    old_row.refresh_from_db()
    assert old_row.user_id == account.pk


@pytest.mark.django_db
def test_import_match_errors_rollback_the_entire_batch(session_client, programs):
    prior, target, root = programs
    account, _ = returning(prior, "returning@example.test")
    row = {"player_name": NAME, "class_year": YEAR, "existing_account_id": str(account.pk)}
    payload = {"import_id": str(uuid4()), "players": [row, {**row, "email": "wrong@example.test"}]}
    rejected = session_client.post(root + "import/", payload, format="json")
    assert rejected.status_code == 400
    assert "Row 2" in str(rejected.data)
    assert not RosterPlayer.objects.filter(project=target).exists()
    assert not ProjectMember.objects.filter(project=target, member=account).exists()
    payload["players"] = [{**row, "email": "wrong@example.test"}]
    mismatched = session_client.post(root + "import/", payload, format="json")
    assert mismatched.status_code == 400
    assert mismatched.json()["row_error"]["index"] == "0"
    payload["players"] = [row]
    assert session_client.post(root + "import/", payload, format="json").status_code == 201


@pytest.mark.django_db
@pytest.mark.parametrize("confirmed_first", [True, False])
def test_import_rejects_another_row_using_selected_accounts_email(session_client, programs, confirmed_first):
    prior, target, root = programs
    account, _ = returning(prior, "returning@example.test")
    rows = [
        {"player_name": NAME, "class_year": YEAR, "existing_account_id": str(account.pk)},
        {"player_name": "Other Player", "email": account.email},
    ]
    if not confirmed_first:
        rows.reverse()
    rejected = session_client.post(root + "import/", {"players": rows}, format="json")
    assert rejected.status_code == 400
    assert f"Row {2 if confirmed_first else 1}" in str(rejected.data)
    assert not RosterPlayer.objects.filter(project=target).exists()


@pytest.mark.django_db
def test_preview_respects_previous_program_visibility(programs):
    prior, target, root = programs
    prior.network = 0
    prior.save(update_fields=["network"])
    account, _ = returning(prior, "returning@example.test")
    coach = User.objects.create(username="other-coach", email="coach@example.test")
    WorkspaceMember.objects.create(workspace=target.workspace, member=coach, role=15)
    ProjectMember.objects.create(project=target, member=coach, role=15)
    client = APIClient()
    client.force_authenticate(coach)
    body = {"rows": [{"player_name": NAME, "graduation_year": YEAR}]}
    response = client.post(root + "import-matches/", body, format="json")
    assert response.status_code == 200
    assert response.json()["rows"][0]["results"] == [
        {"id": str(account.pk), "email": account.email, "previous_program": None}
    ]
    ProjectMember.objects.create(project=prior, member=coach, role=15)
    response = client.post(root + "import-matches/", body, format="json")
    assert response.json()["rows"][0]["results"][0]["previous_program"] == prior.name
