import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    "coaching_card_clips", Path(__file__).resolve().parents[2] / "utils" / "coaching_card_clips.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CoachingClipTests(unittest.TestCase):
    def setUp(self):
        self.data = {
            "stage_id": "assigned", "review": {"viewed_by": {"player": "today"}},
            "playlists": [{"id": "game", "name": "Game", "clips": [
                {"id": "original", "key": "original", "title": "Original", "source_url": "/game.m3u8"}
            ]}],
            "primary_clip": {"playlist_id": "game", "clip_id": "original", "source_url": "/game.m3u8"},
            "summary": {"clip_count": 1},
        }
        self.values = {"request_id": "request-1", "title": "Practice", "clip_type": "practice_check",
                       "source_url": "https://film.example/practice.m3u8", "start_seconds": 18, "end_seconds": 31}

    def mutate(self, data=None, operation="add", values=None, association_id=None):
        return module.mutate_card_clips(data or self.data, operation, values or self.values,
                                        {"id": "coach", "name": "Coach"}, "2026-10-06", association_id)

    def test_append_preserves_review_and_stage_without_mutating_input(self):
        result = self.mutate()
        self.assertEqual(result["stage_id"], self.data["stage_id"])
        self.assertEqual(result["review"], self.data["review"])
        self.assertEqual(result["summary"]["clip_count"], 2)
        self.assertEqual(self.data["summary"]["clip_count"], 1)
        added = result["playlists"][-1]["clips"][0]
        self.assertEqual(added["duration_seconds"], 13)
        self.assertEqual(added["created_by"]["id"], "coach")

    def test_append_retry_is_idempotent(self):
        result = self.mutate()
        replay = self.mutate(result)
        self.assertEqual(result, replay)

    def test_edit_retains_creation_identity(self):
        result = self.mutate()
        added = result["playlists"][-1]["clips"][0]
        edited = self.mutate(result, "edit", {"note": "Watch the first step", "clip_type": "verified_on_film"}, added["association_id"])
        clip = edited["playlists"][-1]["clips"][0]
        self.assertEqual(clip["note"], "Watch the first step")
        self.assertEqual(clip["created_by"], added["created_by"])
        self.assertEqual(clip["created_at"], added["created_at"])

    def test_remove_primary_then_last_clip_clears_primary(self):
        result = self.mutate()
        original = result["playlists"][0]["clips"][0]["association_id"]
        result = self.mutate(result, "remove", association_id=original)
        added = result["playlists"][0]["clips"][0]
        self.assertEqual(result["primary_clip"]["clip_id"], added["id"])
        result = self.mutate(result, "remove", association_id=added["association_id"])
        self.assertIsNone(result["primary_clip"])
        self.assertEqual(result["summary"]["clip_count"], 0)
        self.assertEqual(result["playlists"], [])

    def test_duplicate_upstream_ids_have_stable_distinct_associations(self):
        self.data["playlists"][0]["clips"].append(dict(self.data["playlists"][0]["clips"][0]))
        normalized = module.normalize_card_clips(self.data)
        ids = [clip["association_id"] for clip in normalized["playlists"][0]["clips"]]
        self.assertEqual(len(set(ids)), 2)
        self.assertEqual(normalized, module.normalize_card_clips(normalized))

    def test_invalid_or_nonfinite_interval_is_rejected(self):
        for start, end in [(18, 18), (-1, 10), (float("nan"), 10), (1, float("inf"))]:
            with self.subTest(start=start, end=end), self.assertRaises(ValueError):
                self.mutate(values={**self.values, "start_seconds": start, "end_seconds": end})

    def test_unsupported_source_scheme_is_rejected(self):
        with self.assertRaises(ValueError):
            self.mutate(values={**self.values, "source_url": "javascript:alert(1)"})

    def test_missing_association_is_not_silently_removed(self):
        with self.assertRaises(KeyError):
            self.mutate(operation="remove", association_id="missing")

    def test_legacy_primary_source_and_range_survive_unrelated_append(self):
        clip = self.data["playlists"][0]["clips"][0]
        clip["source_url"] = ""
        self.data["primary_clip"].update(source_url="/primary.m3u8", start_seconds=20, end_seconds=24)
        result = self.mutate()
        self.assertEqual(result["primary_clip"]["source_url"], "/primary.m3u8")
        self.assertEqual(result["primary_clip"]["start_seconds"], 20)
        self.assertEqual(result["primary_clip"]["end_seconds"], 24)

    def test_clearing_end_removes_stale_derived_duration(self):
        result = self.mutate()
        clip = result["playlists"][-1]["clips"][0]
        result = self.mutate(result, "edit", {"start_seconds": 0, "end_seconds": None}, clip["association_id"])
        self.assertIsNone(result["playlists"][-1]["clips"][0]["duration_seconds"])

    def test_explicit_source_replacement_clears_old_media_identity(self):
        result = self.mutate(values={**self.values, "source_media": {"package_id": "library", "artifact_id": "old"}})
        clip = result["playlists"][-1]["clips"][0]
        result = self.mutate(result, "edit", {"source_url": "https://film.example/new.m3u8", "source_media": None}, clip["association_id"])
        self.assertIsNone(result["playlists"][-1]["clips"][0]["source_media"])


if __name__ == "__main__":
    unittest.main()
