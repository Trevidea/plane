"""Player conversations share external issue comments without exposing staff notes."""

from uuid import uuid4
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from plane.db.models import Issue, IssueComment, Project, ProjectMember, RosterPlayer, State
from plane.db.models import User, Workspace, WorkspaceMember


class PlayerThreadTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.coach = User.objects.create(email="coach-thread@test.invalid", username="coach-thread")
        cls.user = User.objects.create(email="player-thread@test.invalid", username="player-thread")
        cls.other = User.objects.create(email="other-thread@test.invalid", username="other-thread")
        cls.workspace = Workspace.objects.create(name="School", slug="thread-school", owner=cls.coach)
        for user in (cls.coach, cls.user, cls.other):
            WorkspaceMember.objects.create(workspace=cls.workspace, member=user, role=20 if user == cls.coach else 5)
        cls.project = Project.objects.create(workspace=cls.workspace, name="Football", identifier="FB")
        ProjectMember.objects.create(project=cls.project, member=cls.coach, role=20)
        cls.player = RosterPlayer.objects.create(project=cls.project, user=cls.user, player_name="Player")
        cls.other_player = RosterPlayer.objects.create(project=cls.project, user=cls.other, player_name="Other")
        state = State.objects.create(project=cls.project, name="Action Required", group="started")
        cls.card = Issue.objects.create(
            project=cls.project, state=state, name="Keep shoulders square", category="Coaching Card",
            coaching_card_data={"recipient_ids": [str(cls.player.id)]},
        )
        cls.shared = IssueComment.objects.create(
            project=cls.project, issue=cls.card, actor=cls.coach, access="EXTERNAL", comment_html="<p>How did it go?</p>"
        )
        cls.internal = IssueComment.objects.create(
            project=cls.project, issue=cls.card, actor=cls.coach, access="INTERNAL", comment_html="<p>Staff only</p>"
        )

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.url = (
            f"/api/player/workspaces/{self.workspace.slug}/projects/{self.project.id}/"
            f"coaching-cards/{self.card.id}/thread/"
        )

    def test_player_can_read_shared_comments_without_project_membership(self):
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["total_count"], 1)
        message = response.json()["results"][0]
        self.assertEqual(message["id"], str(self.shared.id))
        self.assertEqual(message["actor_detail"]["id"], str(self.coach.id))
        self.assertNotIn("issue_detail", message)
        self.assertIn("no-store", response.headers["Cache-Control"])

    def test_player_can_post_and_update_then_delete_own_message(self):
        response = self.client.post(self.url, {"comment_html": "<p>Much better today.</p>"}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        comment = IssueComment.objects.get(pk=response.json()["id"])
        self.assertEqual(comment.actor_id, self.user.id)
        self.assertEqual(comment.access, "EXTERNAL")
        detail = f"{self.url}{comment.id}/"
        response = self.client.patch(detail, {"comment_html": "<p>Updated reply</p>"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertIsNotNone(response.json()["edited_at"])
        self.assertEqual(self.client.get(detail).status_code, 200)
        self.assertEqual(self.client.delete(detail).status_code, 204)
        self.assertEqual(self.client.get(detail).status_code, 404)

    def test_player_cannot_read_private_notes_or_change_someone_elses_comment(self):
        for comment in (self.shared, self.internal):
            detail = f"{self.url}{comment.id}/"
            self.assertIn(self.client.patch(detail, {"comment_html": "<p>No</p>"}, format="json").status_code, [403, 404])
            self.assertIn(self.client.delete(detail).status_code, [403, 404])
        self.assertEqual(self.client.get(f"{self.url}{self.internal.id}/").status_code, 404)

    def test_unassigned_player_cannot_read_or_write(self):
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(self.url).status_code, 404)
        self.assertEqual(self.client.post(self.url, {"comment_html": "<p>No</p>"}, format="json").status_code, 404)

    def test_anonymous_requests_require_authentication(self):
        self.client.force_authenticate(None)
        self.assertIn(self.client.get(self.url).status_code, [401, 403])
        self.assertIn(self.client.post(self.url, {}, format="json").status_code, [401, 403])

    def test_all_assigned_players_share_the_same_conversation(self):
        self.card.coaching_card_data = {"recipient_ids": [str(self.player.id), str(self.other_player.id)]}
        self.card.save(update_fields=["coaching_card_data"])
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(self.url).json()["results"][0]["id"], str(self.shared.id))

    def test_reassignment_and_revoked_membership_remove_access(self):
        membership = WorkspaceMember.objects.get(workspace=self.workspace, member=self.user)
        membership.is_active = False
        membership.save()
        self.assertEqual(self.client.get(self.url).status_code, 404)
        membership.is_active = True
        membership.save()
        self.card.coaching_card_data = {"recipient_ids": []}
        self.card.save(update_fields=["coaching_card_data"])
        self.assertEqual(self.client.get(self.url).status_code, 404)

    def test_inactive_player_archived_card_and_wrong_workspace_are_inaccessible(self):
        self.assertEqual(self.client.get(self.url.replace("thread-school", "wrong")).status_code, 404)
        self.card.archived_at = timezone.now()
        self.card.save(update_fields=["archived_at"])
        self.assertEqual(self.client.get(self.url).status_code, 404)
        self.card.archived_at = None
        self.card.save(update_fields=["archived_at"])
        self.player.status = "inactive"
        self.player.save()
        self.assertEqual(self.client.get(self.url).status_code, 404)

    def test_legacy_single_player_assignment_is_supported(self):
        self.card.coaching_card_data = {}
        self.card.roster_player = self.player
        self.card.save(update_fields=["coaching_card_data", "roster_player"])
        self.assertEqual(self.client.get(self.url).status_code, 200)

    def test_empty_html_and_oversized_messages_are_rejected(self):
        for value in ("", "<p> </p>", "<p>&nbsp;</p>", "<script>alert(1)</script>", "a" * 20001):
            response = self.client.post(self.url, {"comment_html": value}, format="json")
            self.assertEqual(response.status_code, 400, value[:50])
        self.assertEqual(self.client.post(self.url, {}, format="json").status_code, 400)

    def test_identity_visibility_and_parent_cannot_be_supplied_by_player(self):
        response = self.client.post(self.url, {
            "comment_html": "<p>Hello</p>", "actor": str(self.coach.id), "access": "INTERNAL", "issue": str(uuid4())
        }, format="json")
        self.assertEqual(response.status_code, 400)

    def test_pagination_validates_bounds_and_has_stable_order(self):
        second = IssueComment.objects.create(
            project=self.project, issue=self.card, actor=self.user, access="EXTERNAL", comment_html="<p>Second</p>"
        )
        first = self.client.get(self.url + "?limit=1&offset=0")
        next_page = self.client.get(self.url + "?limit=1&offset=1")
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json()["results"][0]["id"], str(self.shared.id))
        self.assertEqual(next_page.json()["results"][0]["id"], str(second.id))
        for query in ("?limit=0", "?limit=101", "?offset=-1"):
            self.assertEqual(self.client.get(self.url + query).status_code, 400)

    @patch("plane.app.views.issue.comment.model_activity.delay")
    @patch("plane.app.views.issue.comment.issue_activity.delay")
    def test_existing_coach_comments_are_shared_only_when_external(self, activity, webhook):
        self.client.force_authenticate(self.coach)
        coach_url = (
            f"/api/workspaces/{self.workspace.slug}/projects/{self.project.id}/issues/{self.card.id}/comments/"
        )
        response = self.client.post(coach_url, {"comment_html": "<p>Coach reply</p>", "access": "EXTERNAL"}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.client.force_authenticate(self.user)
        messages = self.client.get(self.url).json()["results"]
        self.assertIn(response.json()["id"], [message["id"] for message in messages])
