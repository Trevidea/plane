import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    "coaching_card_media", Path(__file__).resolve().parents[2] / "utils" / "coaching_card_media.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class UploadedVideoCardTests(unittest.TestCase):
    def setUp(self):
        self.annotation = {
            "id": "audio-1",
            "type": "audio",
            "startTime": 1,
            "endTime": 4,
            "content": "/saved/audio.webm",
        }
        self.artifact = {"name": "video-1", "title": "Practice", "format": "mp4"}
        self.meta = {"annotations": [self.annotation], "duration_seconds": 42, "sport": "Basketball"}

    def test_builds_video_entry_and_snapshots_saved_annotations(self):
        result = module.build_uploaded_video_card_source(self.artifact, self.meta, "library", "/frame.jpg")
        self.assertEqual(result["source_media"]["artifact_id"], "video-1")
        self.assertEqual(result["source_media"]["annotations"], [self.annotation])
        self.meta["annotations"][0]["content"] = "/changed.webm"
        self.assertEqual(result["source_media"]["annotations"][0]["content"], "/saved/audio.webm")
        self.assertEqual(result["playlists"][0]["clips"][0]["duration_seconds"], 42)
        self.assertEqual(result["playlists"][0]["clips"][0]["thumbnail"], "/frame.jpg")

    def test_snapshots_uploaded_video_metadata(self):
        metadata = {
            **self.meta,
            "category": "Practice",
            "location": "Home",
            "program": "Women's Basketball",
            "level": "Varsity",
            "season": "2026-27",
            "start_date": "2026-09-28",
            "start_time": "10:30",
            "created_by": "member-1",
            "tags": ["Footwork", "Review"],
        }
        result = module.build_uploaded_video_card_source(self.artifact, metadata, "library")
        source_metadata = result["source_media"]["metadata"]
        self.assertEqual(source_metadata["category"], "Practice")
        self.assertEqual(source_metadata["location"], "Home")
        self.assertEqual(source_metadata["tags"], ["Footwork", "Review"])
        self.assertEqual(source_metadata["start_date"], "2026-09-28")
        self.assertEqual(source_metadata["created_by"], "member-1")
        metadata["tags"].append("Later")
        self.assertEqual(source_metadata["tags"], ["Footwork", "Review"])

    def test_selected_card_context_overrides_source_metadata(self):
        source = {"sport": "Basketball", "season": "2026"}
        selected = {"sport": "Soccer", "season": None}
        self.assertEqual(module.choose_card_context_value("sport", source, selected), "Soccer")
        self.assertEqual(module.choose_card_context_value("season", source, selected), "")
        self.assertEqual(module.choose_card_context_value("program", source, selected, "Basketball"), "Basketball")

    def test_accepts_videos_without_annotations(self):
        for metadata in ({}, {"annotations": None}, {"annotations": []}):
            with self.subTest(metadata=metadata):
                result = module.build_uploaded_video_card_source(self.artifact, metadata, "library")
                self.assertEqual(result["source_media"]["annotations"], [])

    def test_accepts_video_mime_formats_and_playback_actions(self):
        for artifact in (
            {**self.artifact, "format": "stream"},
            {**self.artifact, "format": "video/mp4"},
            {**self.artifact, "format": "video/x-matroska"},
            {**self.artifact, "format": ".mp4"},
            {**self.artifact, "format": "application/vnd.apple.mpegurl"},
            {**self.artifact, "format": "application/x-mpegurl"},
            {**self.artifact, "format": "", "action": "play_streaming"},
            {**self.artifact, "format": "application/octet-stream", "action": "open_mp4"},
            {**self.artifact, "format": "application/octet-stream", "path": "https://example.test/video.mp4?token=1"},
        ):
            with self.subTest(artifact=artifact):
                result = module.build_uploaded_video_card_source(artifact, self.meta, "library")
                self.assertEqual(result["source_media"]["artifact_id"], "video-1")

    def test_rejects_nonvideo_and_malformed_annotations(self):
        for format_value in ("json", "png", "pdf"):
            with self.assertRaises(ValueError):
                module.build_uploaded_video_card_source({**self.artifact, "format": format_value}, self.meta, "library")
        for annotations in (
            "invalid",
            [None],
            [{"id": "bad"}],
            [{**self.annotation, "endTime": float("nan")}],
            [{**self.annotation, "startTime": -1}],
        ):
            with self.assertRaises(ValueError):
                module.build_uploaded_video_card_source(self.artifact, {"annotations": annotations}, "library")

    def test_missing_media_metadata_is_optional(self):
        result = module.build_uploaded_video_card_source(self.artifact, {"annotations": [self.annotation]}, "library")
        clip = result["playlists"][0]["clips"][0]
        self.assertIsNone(clip["duration_seconds"])
        self.assertIsNone(clip["thumbnail"])
        self.assertEqual(result["source_media"]["title"], "Practice")

    def test_parses_duration_labels_without_accepting_invalid_durations(self):
        for duration, expected in [("01:02", 62), ("1:02:03", 3723), ("bad", None), (-3, None), (float("inf"), None)]:
            result = module.build_uploaded_video_card_source(
                self.artifact, {**self.meta, "duration_seconds": duration}, "library"
            )
            self.assertEqual(result["playlists"][0]["clips"][0]["duration_seconds"], expected)


if __name__ == "__main__":
    unittest.main()
