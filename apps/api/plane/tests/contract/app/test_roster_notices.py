import pytest
from django.db import transaction
from rest_framework.test import APIClient

from plane.db.models import Project, ProjectMember, RosterNotice, RosterNoticeKind, RosterPlayer, User, Workspace, WorkspaceMember
from plane.utils.roster_notices import notify_join_requested, notify_player


@pytest.mark.django_db
def test_staff_notice_permissions_deduplication_and_idempotent_csrf_write(create_user, workspace):
    team = Project.objects.create(workspace=workspace, name="JV", identifier="JV")
    other = User.objects.create(email="other-staff@example.test", username="other-staff")
    restricted = User.objects.create(email="operator@example.test", username="operator")
    WorkspaceMember.objects.update_or_create(workspace=workspace, member=create_user, defaults={"role": 20})
    WorkspaceMember.objects.create(workspace=workspace, member=other, role=20)
    WorkspaceMember.objects.create(workspace=workspace, member=restricted, role=5)
    ProjectMember.objects.create(project=team, member=restricted, role=20)
    permission = ProjectMember.objects.create(project=team, member=create_user, role=20)
    fixture = RosterPlayer.objects.create(project=team, player_name="Not stored in notice")
    notify_join_requested(fixture, other.pk, fixture.pk)
    notify_join_requested(fixture, other.pk, fixture.pk)
    row = RosterNotice.objects.get()
    assert row.receiver_id == create_user.pk

    client = APIClient(enforce_csrf_checks=True)
    client.force_login(create_user)
    root = f"/api/workspaces/{workspace.slug}/roster-notices/"
    response = client.get(root)
    assert response.json()["unread_count"] == 1
    assert "Not stored in notice" not in response.content.decode()
    assert "no-store" in response.headers["Cache-Control"]
    foreign = Workspace.objects.create(name="Another school", slug="foreign-notices", owner=other)
    assert client.get(f"/api/workspaces/{foreign.slug}/roster-notices/").json()["results"] == []
    path = f"{root}{row.pk}/read/"
    assert client.post(path, {}, format="json").status_code == 403
    token = client.get("/auth/get-csrf-token/").json()["csrf_token"]
    first = client.post(path, {}, format="json", HTTP_X_CSRFTOKEN=token)
    assert first.status_code == 200, first.content
    again = client.post(path, {}, format="json", HTTP_X_CSRFTOKEN=token)
    assert first.json() == again.json()
    assert client.get(root).json()["unread_count"] == 0

    permission.is_active = False
    permission.save(update_fields=["is_active"])
    assert client.get(root).json()["results"] == []
    assert client.post(path, {}, format="json", HTTP_X_CSRFTOKEN=token).status_code == 404


@pytest.mark.django_db
def test_no_op_status_edit_and_retry_removal_do_not_resend(session_client, workspace, create_user):
    team = Project.objects.create(workspace=workspace, name="Varsity", identifier="V")
    athlete = User.objects.create(email="status@example.test", username="status-athlete")
    ProjectMember.objects.create(project=team, member=create_user, role=20)
    WorkspaceMember.objects.create(workspace=workspace, member=athlete, role=1)
    player = RosterPlayer.objects.create(project=team, player_name="Player", user=athlete, jersey_number="12")
    roster = f"/api/workspaces/{workspace.slug}/projects/{team.pk}/roster/{player.pk}/"
    for _ in range(2):
        response = session_client.patch(roster, {"status": "inactive"}, format="json")
        assert response.status_code == 200, response.content
    for _ in range(2):
        response = session_client.delete(roster)
        assert response.status_code in (200, 404), response.content
    client = APIClient()
    client.force_authenticate(athlete)
    result = client.get("/api/player/roster-notices/").json()
    assert [(row["kind"], row["status"]) for row in result["results"]] == [
        ("status_changed", "removed"),
        ("status_changed", "inactive"),
    ]


@pytest.mark.django_db(transaction=True)
def test_notice_lag_observes_committed_delivery_only(create_user, workspace, monkeypatch):
    from plane.utils import roster_notices

    team = Project.objects.create(workspace=workspace, name="JV", identifier="NOTICE")
    player = RosterPlayer.objects.create(project=team, player_name="Private Name", user=create_user)
    records = []
    monkeypatch.setattr(roster_notices, "emit", lambda name, **kwargs: records.append((name, kwargs)))
    ticks = iter([20.0, 21.25, 22.0, 22.5])
    monkeypatch.setattr(roster_notices, "perf_counter", lambda: next(ticks))
    with transaction.atomic():
        notify_player(player, RosterNoticeKind.TEAM_ADDED, player.pk)
        assert not records
    notify_player(player, RosterNoticeKind.TEAM_ADDED, player.pk)  # Already created.
    with transaction.atomic():
        notify_player(player, RosterNoticeKind.REQUEST_APPROVED, player.pk)
        transaction.set_rollback(True)
    assert records == [("roster.notice.committed", {
        "service": "plane-api", "duration_ms": 1250,
        "fields": {"roster_timing": "notification-lag.v1"},
        "context_override": {},
    })]
