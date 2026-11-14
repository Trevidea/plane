from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from rest_framework.exceptions import NotFound

from plane.app.views import media_library as views
from plane.utils.media_library import manifest_path, write_manifest_atomic
from plane.utils.user_plane_read_data import sanitize_shared_data


def test_shared_data_redacts_contacts_progress_and_credentials():
    data = {
        "feedback": "Shared",
        "review": {"viewed_by": {"player": "today"}},
        "recipients": [{"id": "p", "name": "P", "email": "private", "user_id": "secret"}],
        "meta": {"authorization": "secret", "upstream_headers": {"Cookie": "secret"}},
    }
    assert sanitize_shared_data(data) == {
        "feedback": "Shared",
        "review": {},
        "recipients": [{"id": "p", "name": "P"}],
        "meta": {},
    }
    assert data["review"]["viewed_by"] == {"player": "today"}


def test_readonly_video_file_does_not_repair_faststart(settings, tmp_path, monkeypatch):
    settings.MEDIA_LIBRARY_ROOT = str(tmp_path)
    file = tmp_path / "video.mp4"
    file.write_bytes(b"existing media")
    manifest = manifest_path("project-1", "package-1")
    manifest.parent.mkdir(parents=True)
    write_manifest_atomic(
        manifest,
        {
            "artifacts": [{"name": "video", "path": str(file), "format": "mp4"}],
        },
    )
    monkeypatch.setattr(views, "has_user_role", lambda *args: True)
    repair = Mock(side_effect=AssertionError("read must not repair media"))
    monkeypatch.setattr(views, "_ensure_mp4_faststart", repair)
    request = SimpleNamespace(user=object(), query_params={}, headers={}, META={})
    response = views.MediaArtifactFileAPIView.get.__wrapped__(
        views.MediaArtifactFileAPIView(),
        request,
        "workspace",
        "project-1",
        "package-1",
        "video",
    )
    response.close()
    repair.assert_not_called()
    assert file.read_bytes() == b"existing media"


def test_readonly_external_download_never_transcodes(settings, tmp_path, monkeypatch):
    settings.MEDIA_LIBRARY_ROOT = str(tmp_path)
    manifest = manifest_path("project-1", "package-1")
    manifest.parent.mkdir(parents=True)
    write_manifest_atomic(
        manifest,
        {
            "artifacts": [{"name": "video", "path": "https://example.com/video.mov", "format": "mov"}],
        },
    )
    monkeypatch.setattr(views, "has_user_role", lambda *args: True)
    conversion = Mock(side_effect=AssertionError("read must not convert media"))
    monkeypatch.setattr(views, "transcode_video_to_mp4", conversion)
    request = SimpleNamespace(user=object(), query_params={"download": "1"}, headers={}, META={})
    with pytest.raises(NotFound):
        views.MediaArtifactFileAPIView.get.__wrapped__(
            views.MediaArtifactFileAPIView(),
            request,
            "workspace",
            "project-1",
            "package-1",
            "video",
        )
    conversion.assert_not_called()
