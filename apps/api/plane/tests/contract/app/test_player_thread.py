"""Player conversations share external issue comments without exposing staff notes."""

from django.test import TestCase
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
            project=cls.project,
            state=state,
            name="Keep shoulders square",
            category="Coaching Card",
            coaching_card_data={"recipient_ids": [str(cls.player.id)]},
        )
        cls.shared = IssueComment.objects.create(
            project=cls.project,
            issue=cls.card,
            actor=cls.coach,
            access="EXTERNAL",
            comment_html="<p>How did it go?</p>",
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

    def test_legacy_player_reads_cannot_expose_shared_history_or_counts(self):
        for path in [self.url, self.url + str(self.shared.id) + "/"]:
            response = self.client.get(path)
            self.assertEqual(response.status_code, 410)
            self.assertEqual(response.json()["code"], "private_thread_required")
            self.assertNotIn("results", response.json())
            self.assertNotIn("total_count", response.json())

    def test_old_builds_cannot_create_edit_or_delete_shared_comments(self):
        count = IssueComment.objects.filter(issue=self.card).count()
        response = self.client.post(self.url, {"comment_html": "<p>Old app reply</p>"}, format="json")
        self.assertEqual(response.status_code, 410)
        detail = self.url + str(self.shared.id) + "/"
        self.assertEqual(
            self.client.patch(detail, {"comment_html": "<p>Overwrite</p>"}, format="json").status_code, 410
        )
        self.assertEqual(self.client.delete(detail).status_code, 410)
        self.assertEqual(IssueComment.objects.filter(issue=self.card).count(), count)
        self.shared.refresh_from_db()
        self.assertNotEqual(self.shared.comment_html, "<p>Overwrite</p>")

    def test_retired_routes_still_require_authentication(self):
        self.client.force_authenticate(None)
        self.assertIn(self.client.get(self.url).status_code, [401, 403])
