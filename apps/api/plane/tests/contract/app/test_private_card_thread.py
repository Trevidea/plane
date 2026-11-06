"""Private conversations are isolated from assigned peers and generic card comments."""

from django.test import TestCase
from rest_framework.test import APIClient
from plane.db.models import (
    Issue,
    IssueComment,
    Project,
    ProjectMember,
    RosterPlayer,
    State,
    User,
    Workspace,
    WorkspaceMember,
)


class PrivateCardThreadTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.coach = User.objects.create(email="private-coach@fixture.invalid", username="private-coach")
        cls.other_coach = User.objects.create(email="private-other@fixture.invalid", username="private-other")
        cls.players = [
            User.objects.create(email=f"private-player-{i}@fixture.invalid", username=f"private-player-{i}")
            for i in range(2)
        ]
        cls.workspace = Workspace.objects.create(name="Private fixture", slug="private-fixture", owner=cls.coach)
        cls.project = Project.objects.create(workspace=cls.workspace, name="Program", identifier="PRV")
        for user in [cls.coach, cls.other_coach, *cls.players]:
            WorkspaceMember.objects.create(
                workspace=cls.workspace, member=user, role=20 if user in [cls.coach, cls.other_coach] else 1
            )
        for user in [cls.coach, cls.other_coach]:
            ProjectMember.objects.create(project=cls.project, member=user, role=20)
        for user in cls.players:
            ProjectMember.objects.create(project=cls.project, member=user, role=1)
        cls.rosters = [
            RosterPlayer.objects.create(project=cls.project, user=user, player_name=f"Player {i}")
            for i, user in enumerate(cls.players)
        ]
        cls.state = State.objects.create(project=cls.project, name="Assigned", group="unstarted")
        cls.card = Issue.objects.create(
            project=cls.project,
            state=cls.state,
            name="Private card",
            category="Coaching Card",
            coaching_card_data={"recipient_ids": [str(p.id) for p in cls.rosters]},
            created_by_id=cls.coach.id,
        )

        cls.card.save(created_by_id=cls.coach.id)

    def setUp(self):
        self.client = APIClient()
        self.url = (
            f"/api/player/workspaces/{self.workspace.slug}/projects/{self.project.id}/"
            f"coaching-cards/{self.card.id}/private-thread/"
        )
        self.coach_url = (
            f"/api/workspaces/{self.workspace.slug}/projects/{self.project.id}/"
            f"coaching-cards/{self.card.id}/private-threads/{self.players[0].id}/"
        )

    def send(self, user, text="Private reply", url=None):
        self.client.force_authenticate(user)
        return self.client.post(
            url or self.url, {"visibility": "private", "comment_html": f"<p>{text}</p>"}, format="json"
        )

    def test_assigned_peers_cannot_read_counts_or_guess_private_message_ids(self):
        sent = self.send(self.players[0])
        self.assertEqual(sent.status_code, 201)
        message_id = sent.json()["id"]
        self.assertEqual(sent.json()["recipient_id"], str(self.players[0].id))
        self.assertEqual(sent.json()["coach_id"], str(self.coach.id))
        self.assertEqual(sent.json()["visibility"], "private")
        self.client.force_authenticate(self.players[1])
        page = self.client.get(self.url)
        self.assertEqual(page.status_code, 200)
        self.assertEqual(page.json()["total_count"], 0)
        self.assertEqual(page.json()["results"], [])
        for action in ["get", "patch", "delete"]:
            response = (
                getattr(self.client, action)(
                    self.url + message_id + "/",
                    {"visibility": "private", "comment_html": "<p>Override</p>"},
                    format="json",
                )
                if action == "patch"
                else getattr(self.client, action)(self.url + message_id + "/")
            )
            self.assertEqual(response.status_code, 404)
        self.assertEqual(self.client.get(self.coach_url).status_code, 404)

    def test_coach_reply_visible_only_to_its_recipient_and_never_generic_comments(self):
        self.assertEqual(self.send(self.players[0]).status_code, 201)
        reply = self.send(self.coach, "Coach reply", self.coach_url)
        self.assertEqual(reply.status_code, 201)
        self.client.force_authenticate(self.players[0])
        page = self.client.get(self.url).json()
        self.assertEqual(page["total_count"], 2)
        self.assertEqual(page["results"][-1]["actor"], str(self.coach.id))
        self.assertFalse(IssueComment.objects.filter(issue=self.card).exists())
        self.client.force_authenticate(self.other_coach)
        self.assertEqual(self.client.get(self.coach_url).status_code, 404)
        self.assertEqual(self.send(self.other_coach, url=self.coach_url).status_code, 404)

    def test_legacy_shared_comments_are_not_mislabeled_private(self):
        IssueComment.objects.create(
            project=self.project,
            issue=self.card,
            actor=self.coach,
            access="EXTERNAL",
            comment_html="<p>Old shared note</p>",
        )
        self.client.force_authenticate(self.players[0])
        self.assertEqual(self.client.get(self.url).json()["total_count"], 0)

    def test_client_cannot_forge_audience_actor_or_shared_visibility(self):
        self.client.force_authenticate(self.players[0])
        for change in [
            {"actor": str(self.coach.id)},
            {"recipient_id": str(self.players[1].id)},
            {"visibility": "shared"},
            {"access": "EXTERNAL"},
        ]:
            payload = {"visibility": "private", "comment_html": "<p>Reply</p>", **change}
            self.assertEqual(self.client.post(self.url, payload, format="json").status_code, 400)
        self.assertEqual(self.client.post(self.url, {"comment_html": "<p>Reply</p>"}, format="json").status_code, 400)

    def test_assignment_revocation_blocks_both_participants(self):
        sent = self.send(self.players[0])
        self.assertEqual(sent.status_code, 201)
        message_id = sent.json()["id"]
        self.card.coaching_card_data = {"recipient_ids": [str(self.rosters[1].id)]}
        self.card.save(update_fields=["coaching_card_data"], disable_auto_set_user=True)
        for actor, url, detail in [
            (self.players[0], self.url, self.url + message_id + "/"),
            (self.coach, self.coach_url, self.coach_url + "messages/" + message_id + "/"),
        ]:
            self.client.force_authenticate(actor)
            self.assertEqual(self.client.get(url).status_code, 404)
            self.assertEqual(self.send(actor, url=url).status_code, 404)
            self.assertEqual(self.client.get(detail).status_code, 404)
            self.assertEqual(
                self.client.patch(
                    detail, {"visibility": "private", "comment_html": "<p>Revoked edit</p>"}, format="json"
                ).status_code,
                404,
            )
            self.assertEqual(self.client.delete(detail).status_code, 404)

    def test_account_relink_does_not_transfer_old_private_messages(self):
        self.assertEqual(self.send(self.players[0]).status_code, 201)
        replacement = User.objects.create(email="private-replacement@fixture.invalid", username="private-replacement")
        WorkspaceMember.objects.create(workspace=self.workspace, member=replacement, role=1)
        ProjectMember.objects.create(project=self.project, member=replacement, role=1)
        self.rosters[0].user = replacement
        self.rosters[0].save(update_fields=["user"])
        self.client.force_authenticate(replacement)
        self.assertEqual(self.client.get(self.url).json()["total_count"], 0)

    def test_authorship_limits_edits_and_delete_to_the_sender(self):
        message = self.send(self.players[0]).json()
        detail = self.url + message["id"] + "/"
        self.assertEqual(
            self.client.patch(
                detail, {"visibility": "private", "comment_html": "<p>Edited</p>"}, format="json"
            ).status_code,
            200,
        )
        self.client.force_authenticate(self.coach)
        coach_detail = self.coach_url + "messages/" + message["id"] + "/"
        self.assertEqual(self.client.get(coach_detail).status_code, 200)
        self.assertEqual(self.client.delete(coach_detail).status_code, 403)
        self.client.force_authenticate(self.players[0])
        self.assertEqual(self.client.delete(detail).status_code, 204)

    def test_ineligible_recipient_removes_coach_and_player_access(self):
        self.assertEqual(self.send(self.players[0]).status_code, 201)
        self.rosters[0].status = "inactive"
        self.rosters[0].save(update_fields=["status"])
        self.assertEqual(self.client.get(self.url).status_code, 404)
        self.client.force_authenticate(self.coach)
        self.assertEqual(self.client.get(self.coach_url).status_code, 404)

    def test_pagination_is_private_before_counting_and_cache_is_not_shared(self):
        for i in range(3):
            self.assertEqual(self.send(self.players[0], str(i)).status_code, 201)
        self.assertEqual(self.send(self.players[1], "Other player").status_code, 201)
        self.client.force_authenticate(self.players[0])
        page = self.client.get(self.url + "?limit=1&offset=1")
        self.assertEqual(page.json()["total_count"], 3)
        self.assertEqual(page.json()["results"][0]["comment_stripped"], "1")
        self.assertIn("no-store", page.headers["Cache-Control"])
        self.client.force_authenticate(None)
        self.assertIn(self.client.get(self.url).status_code, [401, 403])

    def test_only_authoring_coach_can_list_current_private_recipients(self):
        url = self.coach_url.rsplit(str(self.players[0].id) + "/", 1)[0]
        self.client.force_authenticate(self.coach)
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual({r["id"] for r in response.json()["recipients"]}, {str(user.id) for user in self.players})
        for user in [self.other_coach, self.players[0]]:
            self.client.force_authenticate(user)
            self.assertEqual(self.client.get(url).status_code, 403 if user == self.players[0] else 404)

    def test_assigned_card_response_exposes_authoritative_coach_identity(self):
        self.client.force_authenticate(self.players[0])
        url = f"/api/workspaces/{self.workspace.slug}/projects/{self.project.id}/coaching-cards/mine/"
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["results"][0]["coach_id"], str(self.coach.id))
