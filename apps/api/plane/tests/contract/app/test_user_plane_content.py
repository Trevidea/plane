"""Shared Plane content is readable without exposing personal roster data."""

import pytest
from plane.db.models import Project, ProjectMember, RosterPlayer, WorkspaceMember, Issue, IssueComment, State


@pytest.fixture
def user_program(workspace, create_user):
    WorkspaceMember.objects.filter(workspace=workspace, member=create_user).update(role=1)
    project = Project.objects.create(name="Shared", identifier="SHR", workspace=workspace)
    ProjectMember.objects.create(project=project, member=create_user, role=1, is_active=True)
    State.objects.create(project=project, workspace=workspace, name="Open", group="unstarted", default=True)
    return project


@pytest.mark.contract
@pytest.mark.django_db
class TestUserPlaneContent:
    def test_roster_shows_labels_without_private_account_fields(self, session_client, workspace, user_program):
        RosterPlayer.objects.create(
            project=user_program,
            player_name="Shared Player",
            jersey_number="7",
            height="6ft",
            weight="190 lbs",
            email="private@example.com",
            notes="private injury note",
            status="injured",
        )
        response = session_client.get(f"/api/workspaces/{workspace.slug}/projects/{user_program.id}/roster/")
        assert response.status_code == 200, response.data
        row = response.json()[0]
        assert row["player_name"] == "Shared Player"
        assert row["jersey_number"] == "7"
        assert row["height"] == "6ft"
        assert row["weight"] == "190 lbs"
        assert not set(row) & {"email", "account_email", "account_status", "user", "notes", "status"}

    def test_shared_issue_detail_sanitizes_recipient_progress(self, session_client, workspace, user_program):
        issue = Issue.objects.create(
            project=user_program,
            workspace=workspace,
            name="Shared card",
            coaching_card_data={
                "feedback": "Shared feedback",
                "review": {"viewed_by": {"other-player": "today"}},
                "recipients": [
                    {
                        "id": "player",
                        "name": "Player",
                        "email": "private@example.com",
                        "user_id": "secret",
                    }
                ],
            },
        )
        response = session_client.get(f"/api/workspaces/{workspace.slug}/projects/{user_program.id}/issues/{issue.id}/")
        assert response.status_code == 200, response.data
        card = response.json()["coaching_card_data"]
        assert card["feedback"] == "Shared feedback"
        assert "viewed_by" not in card["review"]
        assert "private@example.com" not in str(card)
        assert "secret" not in str(card)

    def test_internal_comments_are_hidden(self, session_client, workspace, user_program, create_user):
        issue = Issue.objects.create(project=user_program, workspace=workspace, name="Shared")
        for access in ("INTERNAL", "EXTERNAL"):
            IssueComment.objects.create(
                project=user_program,
                workspace=workspace,
                issue=issue,
                actor=create_user,
                access=access,
                comment_html=f"<p>{access}</p>",
            )
        response = session_client.get(
            f"/api/workspaces/{workspace.slug}/projects/{user_program.id}/issues/{issue.id}/comments/"
        )
        assert response.status_code == 200, response.data
        assert "INTERNAL" not in str(response.json())
        assert "EXTERNAL" in str(response.json())

    def test_media_get_does_not_create_library(self, session_client, workspace, user_program, settings, tmp_path):
        settings.MEDIA_LIBRARY_ROOT = str(tmp_path)
        response = session_client.get(f"/api/workspaces/{workspace.slug}/projects/{user_program.id}/media-library/")
        assert response.status_code == 200, response.data
        assert list(tmp_path.iterdir()) == []
        assert response.json()["artifacts"] == []

    def test_roster_only_program_reads_do_not_create_membership(
        self,
        session_client,
        workspace,
        user_program,
        create_user,
    ):
        ProjectMember.objects.filter(project=user_program, member=create_user).update(is_active=False)
        RosterPlayer.objects.create(project=user_program, player_name="Linked Player", user=create_user)
        issue = Issue.objects.create(project=user_program, workspace=workspace, name="Shared feedback")
        response = session_client.get(f"/api/workspaces/{workspace.slug}/projects/{user_program.id}/issues/{issue.id}/")
        assert response.status_code == 200, response.data
        assert not ProjectMember.objects.filter(project=user_program, member=create_user, is_active=True).exists()
        assert ProjectMember.objects.filter(project=user_program, member=create_user).count() == 1

    def test_generic_shared_content_writes_are_denied(self, session_client, workspace, user_program):
        issue = Issue.objects.create(project=user_program, workspace=workspace, name="Shared")
        base = f"/api/workspaces/{workspace.slug}/projects/{user_program.id}"
        response = session_client.patch(f"{base}/issues/{issue.id}/", {"name": "Changed"}, format="json")
        assert response.status_code == 403
        assert session_client.post(f"{base}/media-library/", {}, format="json").status_code == 403
        assert session_client.post(f"{base}/roster/", {"player_name": "New"}, format="json").status_code == 403
        issue.refresh_from_db()
        assert issue.name == "Shared"

    def test_project_asset_does_not_expose_private_page_file(
        self,
        session_client,
        workspace,
        user_program,
        create_user,
    ):
        from plane.db.models import FileAsset, Page, ProjectPage, User

        owner = User.objects.create(email="page-owner@example.com", username="page-owner-content")
        page = Page.objects.create(workspace=workspace, name="Private", access=1, owned_by=owner)
        ProjectPage.objects.create(project=user_program, page=page, workspace=workspace)
        asset = FileAsset.objects.create(
            workspace=workspace,
            project=user_program,
            page=page,
            entity_type="PAGE_DESCRIPTION",
            is_uploaded=True,
        )
        response = session_client.get(
            f"/api/assets/v2/workspaces/{workspace.slug}/projects/{user_program.id}/{asset.id}/"
        )
        assert response.status_code in (403, 404)

    def test_orphan_issue_upload_is_not_shared_program_content(self, session_client, workspace, user_program):
        from plane.db.models import FileAsset

        orphan = FileAsset.objects.create(
            workspace=workspace,
            project=user_program,
            entity_type="ISSUE_ATTACHMENT",
            asset="unattached-private.bin",
            is_uploaded=True,
        )
        response = session_client.get(
            f"/api/assets/v2/workspaces/{workspace.slug}/projects/{user_program.id}/{orphan.id}/?response=json"
        )
        assert response.status_code == 404, response.data

    @pytest.mark.parametrize("suffix", ["issues/", "v2/issues/", "issues-detail/"])
    def test_shared_board_lists_include_other_coaches_items(self, session_client, workspace, user_program, suffix):
        issue = Issue.objects.create(project=user_program, workspace=workspace, name="Other coach's shared feedback")
        response = session_client.get(f"/api/workspaces/{workspace.slug}/projects/{user_program.id}/{suffix}")
        assert response.status_code == 200, response.data
        assert str(issue.id) in str(response.json())
