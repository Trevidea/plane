"""The player feed reuses stage audits without granting project access."""

from datetime import timedelta
from uuid import uuid4

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from plane.db.models import CardStageHistory, Issue, Project, ProjectMember, RosterPlayer, State
from plane.db.models import User, Workspace, WorkspaceMember


class PlayerActivityTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.coach = User.objects.create(
            email="activity-coach@test.invalid", username="activity-coach", display_name="Coach"
        )
        cls.user = User.objects.create(email="activity-player@test.invalid", username="activity-player")
        cls.workspace = Workspace.objects.create(name="School", slug="activity-school", owner=cls.coach)
        cls.membership = WorkspaceMember.objects.create(workspace=cls.workspace, member=cls.user, role=5)
        cls.project = Project.objects.create(workspace=cls.workspace, name="Football", identifier="FB")
        cls.player = RosterPlayer.objects.create(project=cls.project, user=cls.user, player_name="Player")
        cls.state = State.objects.create(project=cls.project, name="Action Required", group="started")
        cls.card = Issue.objects.create(
            project=cls.project,
            state=cls.state,
            name="Square shoulders",
            category="Coaching Card",
            coaching_card_data={"recipient_ids": [str(cls.player.id)]},
        )
        cls.event = cls.audit(cls.card)

    @classmethod
    def audit(cls, card, **kwargs):
        return CardStageHistory.objects.create(
            issue=card,
            from_stage_id=uuid4(),
            from_stage_name="Assigned",
            to_stage_id=cls.state.id,
            to_stage_name="Action Required",
            changed_by=cls.coach,
            reason="Focus on technique",
            **kwargs,
        )

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.url = f"/api/player/workspaces/{self.workspace.slug}/projects/{self.project.id}/activity/"

    def test_scoped_feed_without_project_membership_uses_existing_audit(self):
        self.assertFalse(ProjectMember.objects.filter(project=self.project, member=self.user).exists())
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertIn("no-store", response.headers["Cache-Control"])
        data = response.json()
        self.assertEqual(
            (data["project_id"], data["total_count"], data["limit"], data["offset"]), (str(self.project.id), 1, 50, 0)
        )
        event = data["results"][0]
        self.assertEqual(event["id"], str(self.event.id))
        self.assertEqual(
            event["card"], {"id": str(self.card.id), "title": self.card.name, "sequence_id": self.card.sequence_id}
        )
        self.assertEqual(event["actor"], {"id": str(self.coach.id), "display_name": "Coach"})
        self.assertEqual(event["from_stage"], "Assigned")
        self.assertEqual(event["to_stage"], "Action Required")
        self.assertEqual(event["reason"], "Focus on technique")
        self.assertEqual(set(event), {"id", "card", "actor", "from_stage", "to_stage", "changed_at", "reason"})

    def test_other_cards_and_programs_are_excluded_before_counting(self):
        other = Issue.objects.create(
            project=self.project,
            state=self.state,
            name="Staff card",
            category="Coaching Card",
            coaching_card_data={"recipient_ids": [str(uuid4())]},
        )
        self.audit(other)
        other_project = Project.objects.create(workspace=self.workspace, name="Other", identifier="OT")
        foreign = Issue.objects.create(
            project=other_project,
            name="Foreign",
            category="Coaching Card",
            coaching_card_data={"recipient_ids": [str(self.player.id)]},
        )
        self.audit(foreign)
        self.assertEqual(self.client.get(self.url).json()["total_count"], 1)
        self.assertEqual(
            self.client.get(self.url.replace(str(self.project.id), str(other_project.id))).status_code, 404
        )
        self.assertEqual(self.client.get(self.url.replace(self.workspace.slug, "wrong-workspace")).status_code, 404)

    def test_recipient_list_is_authoritative_over_legacy_foreign_key(self):
        self.card.roster_player = self.player
        for payload, expected in (
            ({}, 1),
            ({"recipient_ids": None}, 1),
            ({"recipient_ids": []}, 0),
            ({"recipient_ids": [str(uuid4())]}, 0),
        ):
            self.card.coaching_card_data = payload
            self.card.save(update_fields=["roster_player", "coaching_card_data"])
            self.assertEqual(self.client.get(self.url).json()["total_count"], expected)

    def test_reassignment_archival_and_deletion_remove_events(self):
        self.card.coaching_card_data = {"recipient_ids": []}
        self.card.save(update_fields=["coaching_card_data"])
        self.assertEqual(self.client.get(self.url).json()["results"], [])
        self.card.coaching_card_data = {"recipient_ids": [str(self.player.id)]}
        self.card.archived_at = timezone.now().date()
        self.card.save(update_fields=["coaching_card_data", "archived_at"])
        self.assertEqual(self.client.get(self.url).json()["total_count"], 0)
        self.card.archived_at = None
        self.card.save(update_fields=["archived_at"])
        self.card.delete()
        self.assertEqual(self.client.get(self.url).json()["total_count"], 0)

    def test_eligibility_revocation_and_anonymous_requests_fail(self):
        for status in ("inactive", "graduated"):
            self.player.status = status
            self.player.save()
            self.assertEqual(self.client.get(self.url).status_code, 404)
        self.player.status = "injured"
        self.player.save()
        self.assertEqual(self.client.get(self.url).status_code, 200)
        self.membership.is_active = False
        self.membership.save()
        self.assertEqual(self.client.get(self.url).status_code, 404)
        self.client.force_authenticate(None)
        self.assertIn(self.client.get(self.url).status_code, (401, 403))

    def test_archived_program_and_inactive_account_fail(self):
        self.project.archived_at = timezone.now()
        self.project.save(update_fields=["archived_at"])
        self.assertEqual(self.client.get(self.url).status_code, 404)
        self.project.archived_at = None
        self.project.save(update_fields=["archived_at"])
        self.user.is_active = False
        self.user.save(update_fields=["is_active"])
        self.assertEqual(self.client.get(self.url).status_code, 404)

    def test_pagination_is_bounded_newest_first_with_stable_ties(self):
        timestamp = timezone.now() + timedelta(minutes=1)
        events = [self.audit(self.card, changed_at=timestamp), self.audit(self.card, changed_at=timestamp)]
        expected = sorted([str(event.id) for event in events], reverse=True) + [str(self.event.id)]
        actual = [
            self.client.get(self.url + f"?limit=1&offset={offset}").json()["results"][0]["id"] for offset in range(3)
        ]
        self.assertEqual(actual, expected)
        self.assertEqual(self.client.get(self.url + "?offset=100").json()["results"], [])
        for query in ("?limit=0", "?limit=101", "?offset=-1", "?offset=2147483648"):
            self.assertEqual(self.client.get(self.url + query).status_code, 400)

    def test_automatic_events_have_no_actor_and_feed_is_read_only(self):
        self.event.changed_by = None
        self.event.save(update_fields=["changed_by"])
        self.assertIsNone(self.client.get(self.url).json()["results"][0]["actor"])
        self.assertEqual(self.client.post(self.url, {}, format="json").status_code, 405)
