"""Saved event drawings reach assigned players without exposing event/library data."""

import json
from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from plane.db.models import Issue, Project, RosterPlayer, State, User, Workspace, WorkspaceMember
from plane.utils.media_library import read_manifest


class PlayerAnnotationContractTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create(email="annotations@fixture.test", username="annotations")
        cls.workspace = Workspace.objects.create(name="School", slug="annotation-school", owner=cls.user)
        WorkspaceMember.objects.create(workspace=cls.workspace, member=cls.user, role=5)
        cls.project = Project.objects.create(workspace=cls.workspace, name="Football", identifier="ANN")
        cls.player = RosterPlayer.objects.create(project=cls.project, user=cls.user, player_name="Player")
        cls.state = State.objects.create(project=cls.project, name="Assigned", group="started")
        cls.event = Issue.objects.create(project=cls.project, state=cls.state, name="Event")
        cls.card = Issue.objects.create(
            project=cls.project,
            state=cls.state,
            name="Card",
            category="Coaching Card",
            roster_player=cls.player,
            coaching_card_data={
                "source_issue": {"id": str(cls.event.id)},
                "playlists": [
                    {
                        "id": "quarter",
                        "name": "Quarter",
                        "clips": [
                            {
                                "id": "tag-1",
                                "title": "Field goal",
                                "source_url": "quarter.m3u8",
                                "start_seconds": 181,
                                "end_seconds": 189,
                                "duration_seconds": 8,
                            },
                            {
                                "id": "tag-2",
                                "title": "Punt",
                                "source_url": "quarter.m3u8",
                                "start_seconds": 165,
                                "end_seconds": 173,
                                "duration_seconds": 8,
                            },
                        ],
                    }
                ],
            },
        )

    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        setting = override_settings(MEDIA_LIBRARY_ROOT=self.temp.name)
        setting.enable()
        self.addCleanup(setting.disable)
        self.root = Path(self.temp.name) / "projects" / str(self.project.id) / "packages" / "film"
        self.root.mkdir(parents=True)
        self.drawing = {
            "id": "arrow",
            "type": "arrow",
            "startTime": 9,
            "endTime": 11,
            "x": 120,
            "y": 240,
            "width": 180,
            "height": 50,
            "style": {"stroke": "#ff0000", "strokeWidth": 4},
        }
        self.meta = {
            "custom_playlists": [
                {
                    "id": "quarter",
                    "clips": [
                        {"id": "tag-1", "startSeconds": 181, "endSeconds": 189, "durationSeconds": 8},
                        {"id": "tag-2", "startSeconds": 165, "endSeconds": 173, "durationSeconds": 8},
                    ],
                }
            ]
        }
        self.payload = {
            "customPlaylistAnnotations": {
                "quarter": {"annotationViewKey": "custom-playlist:quarter", "annotations": [self.drawing]}
            },
            "private_event_notes": "Do not expose",
        }
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.url = f"/api/workspaces/{self.workspace.slug}/projects/{self.project.id}/coaching-cards/mine/"
        self.write_event()

    def write_event(self, path=None):
        event = self.root / "event.json"
        event.write_text(json.dumps(self.payload))
        self.manifest = {
            "artifacts": [
                {
                    "name": "event",
                    "format": "json",
                    "path": str(path or event),
                    "work_item_id": str(self.event.id),
                    "metadata_ref": "event",
                }
            ],
            "metadata": {"event": self.meta},
        }
        (self.root / "manifest.json").write_text(json.dumps(self.manifest))

    def clips(self):
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("private_event_notes", json.dumps(response.json()))
        return response.json()["results"][0]["coaching_card_data"]["playlists"][0]["clips"]

    def test_saved_playlist_drawing_reaches_only_the_correct_tag_in_recording_time(self):
        before = deepcopy(self.card.coaching_card_data)
        clips = self.clips()
        self.assertEqual(clips[0].get("annotations"), [])
        expected = {**self.drawing, "startTime": 166, "endTime": 168}
        self.assertEqual(clips[1].get("annotations"), [expected])
        self.card.refresh_from_db()
        self.assertEqual(self.card.coaching_card_data, before)

    def test_saved_updates_and_deletions_are_visible_without_recreating_the_card(self):
        self.clips()
        self.payload["customPlaylistAnnotations"]["quarter"]["annotations"] = []
        self.write_event()
        self.assertEqual(self.clips()[1].get("annotations"), [])

    def test_legacy_manifest_playlist_drawings_are_supported(self):
        self.payload = {}
        self.meta["custom_playlists"][0]["annotations"] = [self.drawing]
        self.write_event()
        self.assertEqual(self.clips()[1].get("annotations", [])[0]["startTime"], 166)

    def test_a_different_playlist_view_never_supplies_drawings(self):
        self.payload = {
            "customPlaylistAnnotations": {
                "other": {"annotationViewKey": "custom-playlist:other", "annotations": [self.drawing]}
            }
        }
        self.write_event()
        self.assertFalse(any(c.get("annotations") for c in self.clips()))

    def test_stream_drawings_use_recording_time_and_only_the_matching_stream(self):
        data = deepcopy(self.card.coaching_card_data)
        data["playlists"][0]["clips"][1]["stream_id"] = "camera-a"
        Issue.objects.filter(pk=self.card.pk).update(coaching_card_data=data)
        drawing = {**self.drawing, "startTime": 166, "endTime": 168}
        self.payload = {
            "mediaReferences": [
                {"streamId": "camera-b", "annotations": [self.drawing]},
                {"streamId": "camera-a", "annotations": [drawing]},
            ]
        }
        self.write_event()
        self.assertEqual(self.clips()[1].get("annotations"), [drawing])

    def test_malformed_drawings_are_skipped_without_breaking_card_playback(self):
        self.payload["customPlaylistAnnotations"]["quarter"]["annotations"] += [
            {"type": "text"},
            None,
            {**self.drawing, "startTime": "bad"},
        ]
        self.write_event()
        self.assertEqual(len(self.clips()[1].get("annotations", [])), 1)

    def test_cross_project_source_and_files_outside_project_are_ignored(self):
        other = Project.objects.create(workspace=self.workspace, name="Other", identifier="OTH")
        Issue.objects.filter(pk=self.event.pk).update(project=other)
        self.assertFalse(any(c.get("annotations") for c in self.clips()))
        Issue.objects.filter(pk=self.event.pk).update(project=self.project)
        outside = Path(self.temp.name) / "other-event.json"
        outside.write_text(json.dumps(self.payload))
        self.write_event(path=outside)
        self.assertFalse(any(c.get("annotations") for c in self.clips()))

    def test_unassigned_players_cannot_read_the_card(self):
        Issue.objects.filter(pk=self.card.pk).update(roster_player=None)
        self.assertEqual(self.client.get(self.url).json()["results"], [])

    def test_an_assigned_subset_retains_the_full_export_offsets(self):
        self.meta["custom_playlists"][0]["url"] = "quarter.m3u8"
        self.write_event()
        data = deepcopy(self.card.coaching_card_data)
        data["playlists"][0]["clips"] = [data["playlists"][0]["clips"][1]]
        Issue.objects.filter(pk=self.card.pk).update(coaching_card_data=data)
        clip = self.clips()[0]
        self.assertEqual(clip.get("playlist_start_seconds"), 8)
        self.assertEqual(clip.get("playlist_duration_seconds"), 16)
        self.assertEqual(clip["annotations"][0]["startTime"], 166)

    def test_empty_playlist_defaults_do_not_hide_matching_stream_drawings(self):
        self.payload = {
            "mediaReferences": [
                {"streamId": "camera-a", "annotations": [{**self.drawing, "startTime": 166, "endTime": 168}]}
            ]
        }
        self.meta["custom_playlists"][0]["annotations"] = []
        data = deepcopy(self.card.coaching_card_data)
        data["playlists"][0]["clips"][1]["stream_id"] = "camera-a"
        Issue.objects.filter(pk=self.card.pk).update(coaching_card_data=data)
        self.write_event()
        self.assertEqual(len(self.clips()[1].get("annotations", [])), 1)

    def test_invalid_event_json_and_oversized_files_do_not_break_cards(self):
        (self.root / "event.json").write_text("broken json")
        self.assertFalse(any(c.get("annotations") for c in self.clips()))
        (self.root / "event.json").write_text(" " * (5 * 1024 * 1024 + 1))
        self.assertFalse(any(c.get("annotations") for c in self.clips()))

    def test_unique_stream_inference_requires_the_saved_playlist_source_and_tag(self):
        self.meta["custom_playlists"][0]["url"] = "quarter.m3u8"
        self.payload = {
            "mediaReferences": [
                {"streamId": "camera-a", "annotations": [{**self.drawing, "startTime": 166, "endTime": 168}]}
            ]
        }
        self.write_event()
        self.assertEqual(len(self.clips()[1].get("annotations", [])), 1)
        self.payload["mediaReferences"].append({"streamId": "camera-b", "annotations": [self.drawing]})
        self.write_event()
        self.assertFalse(any(c.get("annotations") for c in self.clips()))

    def test_changed_source_does_not_inherit_old_playlist_drawings_or_offsets(self):
        self.meta["custom_playlists"][0]["url"] = "quarter.m3u8"
        self.write_event()
        data = deepcopy(self.card.coaching_card_data)
        data["playlists"][0]["clips"][1]["source_url"] = "replacement.m3u8"
        Issue.objects.filter(pk=self.card.pk).update(coaching_card_data=data)
        clip = self.clips()[1]
        self.assertFalse(clip.get("annotations"))
        self.assertNotIn("playlist_start_seconds", clip)

    def test_drawings_crossing_tag_boundaries_are_clipped_to_assigned_footage(self):
        self.payload["customPlaylistAnnotations"]["quarter"]["annotations"] = [
            {**self.drawing, "startTime": 7, "endTime": 10}
        ]
        self.write_event()
        first, second = self.clips()
        self.assertEqual((first["annotations"][0]["startTime"], first["annotations"][0]["endTime"]), (188, 189))
        self.assertEqual((second["annotations"][0]["startTime"], second["annotations"][0]["endTime"]), (165, 167))

    def test_a_second_camera_without_stream_id_prevents_unique_camera_inference(self):
        self.meta["custom_playlists"][0]["url"] = "quarter.m3u8"
        self.payload = {
            "mediaReferences": [
                {"streamId": "camera-a", "annotations": [{**self.drawing, "startTime": 166, "endTime": 168}]},
                {"streamName": "camera-b", "previewUrl": "https://fixture.invalid/b.m3u8"},
            ]
        }
        self.write_event()
        self.assertFalse(any(c.get("annotations") for c in self.clips()))

    def test_one_manifest_index_is_shared_by_distinct_events_on_the_same_page(self):
        event = Issue.objects.create(project=self.project, state=self.state, name="Second event")
        data = deepcopy(self.card.coaching_card_data)
        data["source_issue"] = {"id": str(event.id)}
        Issue.objects.create(
            project=self.project,
            state=self.state,
            name="Second card",
            category="Coaching Card",
            roster_player=self.player,
            coaching_card_data=data,
        )
        self.manifest["artifacts"].append(
            {**self.manifest["artifacts"][0], "name": "second-event", "work_item_id": str(event.id)}
        )
        (self.root / "manifest.json").write_text(json.dumps(self.manifest))
        with patch("plane.utils.player_card_annotations.read_manifest", wraps=read_manifest) as read:
            self.clips()
        self.assertEqual(read.call_count, 1)

    def test_a_page_of_annotated_cards_stays_below_the_mobile_response_limit(self):
        self.payload["customPlaylistAnnotations"]["quarter"]["annotations"] = [
            {**self.drawing, "id": str(i), "type": "text", "content": "x" * 4096} for i in range(300)
        ]
        self.write_event()
        Issue.objects.create(
            project=self.project,
            state=self.state,
            name="Second card",
            category="Coaching Card",
            roster_player=self.player,
            coaching_card_data=self.card.coaching_card_data,
        )
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertLess(len(response.content), 2 * 1024 * 1024)
