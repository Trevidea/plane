from types import SimpleNamespace

from plane.app.views.media_library import _record_media_artifact_view, _viewer_key_for_request
from plane.utils.media_library import manifest_path, write_manifest_atomic


def _write_manifest(settings, tmp_path):
    settings.MEDIA_LIBRARY_ROOT = str(tmp_path)
    manifest_file = manifest_path("project-1", "package-1")
    manifest_file.parent.mkdir(parents=True, exist_ok=True)
    write_manifest_atomic(
        manifest_file,
        {
            "id": "package-1",
            "projectId": "project-1",
            "artifacts": [
                {
                    "name": "clip-1",
                    "title": "clip-1.mov",
                    "format": "m3u8",
                    "path": "media/clip-1/master.m3u8",
                    "link": None,
                    "action": "play_hls",
                    "metadata_ref": "clip-1",
                    "created_at": "2026-08-24T00:00:00Z",
                    "updated_at": "2026-08-24T00:00:00Z",
                }
            ],
            "metadata": {"clip-1": {}},
        },
    )
    return manifest_file


def test_authenticated_view_is_counted_once_per_dedupe_window(settings, tmp_path):
    manifest_file = _write_manifest(settings, tmp_path)

    first = _record_media_artifact_view("project-1", "package-1", "clip-1", "user:user-1")
    second = _record_media_artifact_view("project-1", "package-1", "clip-1", "user:user-1")

    assert first == {"views": 1, "counted": True}
    assert second == {"views": 1, "counted": False}
    assert '"views": 1' in manifest_file.read_text(encoding="utf-8")


def test_anonymous_session_view_is_deduped(settings, tmp_path):
    _write_manifest(settings, tmp_path)

    first = _record_media_artifact_view("project-1", "package-1", "clip-1", "session:viewer-1")
    second = _record_media_artifact_view("project-1", "package-1", "clip-1", "session:viewer-1")

    assert first["counted"] is True
    assert second == {"views": 1, "counted": False}


def test_distinct_viewers_increment_the_same_media_counter(settings, tmp_path):
    _write_manifest(settings, tmp_path)

    _record_media_artifact_view("project-1", "package-1", "clip-1", "user:user-1")
    result = _record_media_artifact_view("project-1", "package-1", "clip-1", "user:user-2")

    assert result == {"views": 2, "counted": True}


def test_viewer_key_prefers_authenticated_user_over_session_id():
    request = SimpleNamespace(
        user=SimpleNamespace(is_authenticated=True, id="user-1"),
        headers={"X-Media-Viewer-Session": "viewer-1"},
        META={},
    )

    assert _viewer_key_for_request(request, {"session_id": "viewer-2"}) == "user:user-1"
