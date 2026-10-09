from unittest.mock import patch

import pytest
from django.utils import timezone

from plane.db.models import FileAsset, Issue, Project, ProjectMember, State


@pytest.mark.contract
@pytest.mark.django_db
def test_issue_details_only_expand_completed_attachments(session_client, workspace, create_user):
    project = Project.objects.create(name="Attachments", identifier="ATT", workspace=workspace)
    ProjectMember.objects.create(project=project, member=create_user, role=20)
    state = State.objects.create(name="Todo", color="#000000", group="unstarted", default=True, project=project)
    issue = Issue.objects.create(name="Attachment test", project=project, workspace=workspace, state=state)
    common = {
        "workspace": workspace,
        "project": project,
        "issue": issue,
        "entity_type": FileAsset.EntityTypeContext.ISSUE_ATTACHMENT,
        "attributes": {"name": "video.mp4", "size": 100},
    }
    completed = FileAsset.objects.create(**common, asset="completed.mp4", is_uploaded=True)
    FileAsset.objects.create(**common, asset="unfinished.mp4", is_uploaded=False)
    FileAsset.objects.create(**common, asset="deleted.mp4", is_uploaded=True, is_deleted=True, deleted_at=timezone.now())

    with patch("plane.app.views.issue.base.recent_visited_task.delay"):
        response = session_client.get(
            f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/{issue.id}/",
            {"expand": "issue_attachments"},
        )

    assert response.status_code == 200
    assert [item["id"] for item in response.json()["issue_attachments"]] == [str(completed.id)]
    assert response.json()["attachment_count"] == 1
