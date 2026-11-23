from datetime import UTC, date, datetime
from unittest.mock import patch

import pytest

from plane.db.models import Issue, Project, ProjectMember, State


@pytest.fixture
def event_project(workspace, create_user):
    project = Project.objects.create(workspace=workspace, name="Football", identifier="FOOT", event_season="2026-2027")
    ProjectMember.objects.create(project=project, member=create_user, role=20)
    State.objects.create(project=project, name="Scheduled", default=True, group="unstarted")
    return project


@pytest.mark.django_db
def test_create_and_reschedule_preserve_selected_date(session_client, event_project):
    root = f"/api/workspaces/{event_project.workspace.slug}/projects/{event_project.pk}/issues/"
    event = {"name": "Game", "start_time": "2027-01-01T15:30:00Z"}
    with (
        patch("plane.utils.issue_datetime.timezone.now", return_value=datetime(2026, 11, 20, 12, tzinfo=UTC)),
        patch("plane.app.views.issue.base.service_gateway_event_sync") as sync,
        patch("plane.app.views.issue.base.issue_activity.delay"),
        patch("plane.app.views.issue.base.model_activity.delay"),
    ):
        invalid = session_client.post(root, {**event, "start_date": "2028-09-17"}, format="json")
        assert invalid.status_code == 400
        assert "2026-2027" in invalid.data["start_date"][0]
        assert not Issue.objects.filter(project=event_project).exists()
        sync.assert_not_called()

        created = session_client.post(root, {**event, "start_date": "2027-03-15"}, format="json")
        assert created.status_code == 201, created.data
        assert sync.call_args.kwargs["event_data"]["start_date"] == date(2027, 3, 15)
        issue = Issue.objects.get(pk=created.data["id"])
        url = f"{root}{issue.pk}/"
        sync.reset_mock()

        invalid = session_client.patch(url, {"start_date": "2028-09-17"}, format="json")
        assert invalid.status_code == 400
        assert "2026-2027" in invalid.data["start_date"][0]
        sync.assert_not_called()
        issue.refresh_from_db()
        assert issue.start_date == date(2027, 3, 15)

        updated = session_client.patch(url, {"start_date": "2027-03-20"}, format="json")
        assert updated.status_code == 204, updated.data
        assert sync.call_args.kwargs["event_data"]["start_date"] == date(2027, 3, 20)
        issue.refresh_from_db()
        assert issue.start_date == date(2027, 3, 20)


@pytest.mark.django_db
def test_legacy_event_can_be_renamed_without_rewriting_its_date(session_client, event_project):
    original_date = date(2028, 9, 17)
    issue = Issue.objects.create(project=event_project, name="Legacy game", start_date=original_date)
    url = f"/api/workspaces/{event_project.workspace.slug}/projects/{event_project.pk}/issues/{issue.pk}/"
    with (
        patch("plane.app.views.issue.base.service_gateway_event_sync") as sync,
        patch("plane.app.views.issue.base.issue_activity.delay"),
    ):
        response = session_client.patch(url, {"name": "Renamed game"}, format="json")
        assert response.status_code == 204, response.data
        assert sync.call_args.kwargs["event_data"]["start_date"] == original_date

    issue.refresh_from_db()
    assert issue.name == "Renamed game"
    assert issue.start_date == original_date


@pytest.mark.django_db
def test_bulk_reschedule_rejects_entire_batch_before_saving_or_queuing_activity(session_client, event_project):
    root = f"/api/workspaces/{event_project.workspace.slug}/projects/{event_project.pk}/issue-dates/"
    original_date = date(2027, 3, 15)
    first, second = [
        Issue.objects.create(project=event_project, name=name, start_date=original_date)
        for name in ("Game One", "Game Two")
    ]
    with patch("plane.app.views.issue.base.issue_activity.delay") as activity:
        response = session_client.post(
            root,
            {
                "updates": [
                    {"id": str(first.pk), "start_date": "2027-03-20"},
                    {"id": str(second.pk), "start_date": "2028-09-17"},
                ]
            },
            format="json",
        )
        assert response.status_code == 400
        assert "2026-2027" in response.data["start_date"]
        activity.assert_not_called()
    first.refresh_from_db()
    second.refresh_from_db()
    assert first.start_date == second.start_date == original_date
