from uuid import uuid4

from django.test import TestCase
from rest_framework.test import APIClient

from plane.db.models import Issue, IssueActivity, Project, ProjectMember, State, User, Workspace, WorkspaceMember


class CoachingCardClipsAPITests(TestCase):
    def setUp(self):
        self.user = User.objects.create(email=f"clips-{uuid4()}@example.com", first_name="Coach")
        self.workspace = Workspace.objects.create(name="Clips test", slug=f"clips-{uuid4()}", owner=self.user)
        WorkspaceMember.objects.create(workspace=self.workspace, member=self.user, role=20)
        self.project = Project.objects.create(name="Football", identifier="CLIP", workspace=self.workspace, sport="American Football")
        self.member = ProjectMember.objects.create(project=self.project, member=self.user, role=20)
        self.state = State.objects.create(name="Assigned", color="#333333", group="started", project=self.project)
        self.card = Issue.objects.create(name="Footwork", category="Coaching Card", project=self.project, state=self.state,
            coaching_card_data={"kind": "coaching_card", "schema_version": 3,
                "playlists": [{"id": "game", "name": "Game", "clips": [{"id": "original", "key": "original", "title": "Original", "source_url": "/original.m3u8"}]}],
                "primary_clip": {"playlist_id": "game", "clip_id": "original", "source_url": "/original.m3u8"},
                "review": {"viewed_by": {"player": "today"}}, "summary": {"clip_count": 1}})
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.url = f"/api/workspaces/{self.workspace.slug}/projects/{self.project.id}/coaching-cards/{self.card.id}/clips/"
        self.payload = {"request_id": str(uuid4()), "title": "Practice check", "clip_type": "practice_check",
                        "source_url": "https://film.example/practice.m3u8", "start_seconds": 18, "end_seconds": 31,
                        "note": "Watch the first step", "tags": ["Footwork"]}

    def test_add_retry_edit_remove_are_durable_and_keep_lifecycle(self):
        response = self.client.post(self.url, self.payload, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.card.refresh_from_db()
        added = self.card.coaching_card_data["playlists"][-1]["clips"][0]
        self.assertEqual(added["created_by"]["id"], str(self.user.id))
        self.assertEqual(added["duration_seconds"], 13)
        replay = self.client.post(self.url, self.payload, format="json")
        self.assertEqual(replay.data["coaching_card_data"]["summary"]["clip_count"], 2)
        self.assertEqual(IssueActivity.objects.filter(issue=self.card, field="coaching_clip").count(), 1)
        url = f"{self.url}{added['association_id']}/"
        edited = self.client.patch(url, {"clip_type": "verified_on_film", "note": "Corrected"}, format="json")
        self.assertEqual(edited.status_code, 200, edited.data)
        self.card.refresh_from_db()
        saved = self.card.coaching_card_data["playlists"][-1]["clips"][0]
        self.assertEqual(saved["created_at"], added["created_at"])
        self.assertEqual(saved["note"], "Corrected")
        self.assertEqual(self.client.delete(url).status_code, 200)
        self.card.refresh_from_db()
        self.assertEqual(self.card.coaching_card_data["summary"]["clip_count"], 1)
        self.assertEqual(self.card.coaching_card_data["review"], {"viewed_by": {"player": "today"}})
        self.assertEqual(self.card.state_id, self.state.id)

    def test_remove_original_then_last_does_not_resurrect_primary(self):
        self.client.post(self.url, self.payload, format="json")
        response = self.client.delete(f"{self.url}legacy:0:0/")
        self.assertEqual(response.status_code, 200, response.data)
        clip = response.data["coaching_card_data"]["playlists"][0]["clips"][0]
        self.assertEqual(response.data["coaching_card_data"]["primary_clip"]["clip_id"], clip["id"])
        response = self.client.delete(f"{self.url}{clip['association_id']}/")
        self.assertIsNone(response.data["coaching_card_data"]["primary_clip"])
        self.assertEqual(response.data["coaching_card_data"]["playlists"], [])

    def test_invalid_range_and_unknown_association(self):
        response = self.client.post(self.url, {**self.payload, "end_seconds": 18}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.client.delete(f"{self.url}missing/").status_code, 404)
        self.card.refresh_from_db()
        self.assertEqual(self.card.coaching_card_data["summary"]["clip_count"], 1)

    def test_guest_cannot_mutate(self):
        self.member.role = 5
        self.member.save()
        WorkspaceMember.objects.filter(workspace=self.workspace, member=self.user).update(role=5)
        self.assertEqual(self.client.post(self.url, self.payload, format="json").status_code, 403)

    def test_other_project_card_is_not_accessible(self):
        other = Project.objects.create(name="Other", identifier="OTHER", workspace=self.workspace)
        ProjectMember.objects.create(project=other, member=self.user, role=20)
        wrong_url = self.url.replace(str(self.project.id), str(other.id))
        self.assertEqual(self.client.post(wrong_url, self.payload, format="json").status_code, 404)

    def test_archived_card_cannot_mutate(self):
        from django.utils import timezone
        self.card.archived_at = timezone.now().date()
        self.card.save()
        self.assertEqual(self.client.post(self.url, self.payload, format="json").status_code, 404)

    def test_replacement_can_clear_uploaded_identity_and_end_time(self):
        response = self.client.post(self.url, self.payload, format="json")
        self.card.refresh_from_db()
        clip = self.card.coaching_card_data["playlists"][-1]["clips"][0]
        clip["source_media"] = {"package_id": "old-library", "artifact_id": "old-video"}
        self.card.save()
        response = self.client.patch(f"{self.url}{clip['association_id']}/", {
            "source_url": "https://film.example/replacement.m3u8", "source_media": None,
            "stream_id": "", "start_segment": None, "end_segment": None,
            "source_start_seconds": None, "start_seconds": 0, "end_seconds": None,
            "playback_mode": "source",
        }, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        updated = response.data["coaching_card_data"]["playlists"][-1]["clips"][0]
        self.assertIsNone(updated["source_media"])
        self.assertIsNone(updated["duration_seconds"])
        self.assertEqual(updated["source_url"], "https://film.example/replacement.m3u8")
