import pytest

from plane.utils.media_library import (
    get_document_icon_source,
    get_document_thumbnail_hint,
    manifest_path,
    read_manifest,
    strip_inline_image_annotation_content,
    write_manifest_atomic,
)

PNG_DATA_URL = "data:image/png;base64,aGVsbG8="


@pytest.mark.unit
class TestGetDocumentThumbnailHint:
    def test_returns_explicit_thumbnail_hint_when_present(self):
        assert (
            get_document_thumbnail_hint(
                "json",
                {"source": "plane-coach", "thumbnail": "attachment/custom-icon.png"},
            )
            == "attachment/custom-icon.png"
        )

    def test_uses_video_icon_for_plane_coach_json_documents(self):
        assert get_document_thumbnail_hint("json", {"source": "plane-coach"}) == "attachment/video-icon.png"

    def test_uses_poster_hint_before_plane_coach_json_fallback(self):
        assert (
            get_document_thumbnail_hint(
                "json",
                {"source": "plane-coach", "poster_url": "/coach/defualt.jpg"},
            )
            == "/coach/defualt.jpg"
        )

    def test_does_not_override_non_plane_coach_documents(self):
        assert get_document_thumbnail_hint("json", {"source": "manual-upload"}) is None

    def test_does_not_override_non_json_plane_coach_documents(self):
        assert get_document_thumbnail_hint("pdf", {"source": "plane-coach"}) is None


@pytest.mark.unit
class TestGetDocumentIconSource:
    def test_resolves_plane_coach_public_thumbnail_hint(self):
        icon_source = get_document_icon_source("json", "/coach/defualt.jpg")

        assert icon_source is not None
        assert icon_source.name == "defualt.jpg"


@pytest.mark.unit
class TestInlineImageAnnotationContent:
    def test_strips_only_embedded_image_annotation_content(self):
        payload = {
            "annotations": [
                {"type": "image", "content": PNG_DATA_URL, "title": "Embedded image"},
                {"type": "image", "content": "https://example.test/annotation.png", "title": "Linked image"},
                {"type": "text", "content": PNG_DATA_URL},
            ]
        }

        cleaned = strip_inline_image_annotation_content(payload)

        assert "content" not in cleaned["annotations"][0]
        assert cleaned["annotations"][1]["content"] == "https://example.test/annotation.png"
        assert cleaned["annotations"][2]["content"] == PNG_DATA_URL
        assert payload["annotations"][0]["content"] == PNG_DATA_URL

    def test_manifest_writer_does_not_persist_embedded_image_annotation_content(self, settings, tmp_path):
        settings.MEDIA_LIBRARY_ROOT = str(tmp_path)
        manifest_file = manifest_path("project-1", "package-1")
        write_manifest_atomic(
            manifest_file,
            {
                "id": "package-1",
                "projectId": "project-1",
                "artifacts": [
                    {
                        "name": "clip-1",
                        "title": "clip.mp4",
                        "format": "mp4",
                        "path": "projects/project-1/packages/package-1/artifacts/clip-1.mp4",
                        "link": None,
                        "action": "play",
                        "metadata_ref": "clip-1",
                        "created_at": "2026-08-24T00:00:00Z",
                        "updated_at": "2026-08-24T00:00:00Z",
                    }
                ],
                "metadata": {
                    "clip-1": {
                        "annotations": [{"type": "image", "content": PNG_DATA_URL}],
                    }
                },
            },
        )

        assert PNG_DATA_URL not in manifest_file.read_text(encoding="utf-8")
        assert "content" not in read_manifest(manifest_file)["metadata"]["clip-1"]["annotations"][0]
