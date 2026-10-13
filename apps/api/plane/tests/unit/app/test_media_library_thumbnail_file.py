from types import SimpleNamespace

import pytest
from rest_framework.exceptions import NotFound
from rest_framework.test import APIRequestFactory

from plane.app.views.media_library import MediaArtifactFileAPIView
from plane.utils.media_library import manifest_path, write_manifest_atomic


def _write_thumbnail(settings, tmp_path, path, format_value="thumbnail"):
    settings.MEDIA_LIBRARY_ROOT = str(tmp_path)
    manifest_file = manifest_path("project-1", "package-1")
    manifest_file.parent.mkdir(parents=True, exist_ok=True)
    write_manifest_atomic(
        manifest_file,
        {"artifacts": [{"name": "poster-1", "path": path, "format": format_value, "action": "preview"}]},
    )


def _get_thumbnail(*, query=None, headers=None, artifact_path=None):
    request = SimpleNamespace(query_params=query or {}, headers=headers or {}, META={})
    return MediaArtifactFileAPIView.get.__wrapped__(
        MediaArtifactFileAPIView(), request, "football", "project-1", "package-1", "poster-1", artifact_path
    )


@pytest.mark.parametrize(
    "path",
    [
        "https://media.example/poster.jpg?token=AbC%2F123",
        "http://localhost:1437/api/blobs/media/upload/thumbnails/poster.jpg",
        "/sports/api/blobs/media/upload/thumbnails/poster.jpg",
        "/api/blobs/media/upload/thumbnails/poster.jpg",
        "/blobs/media/upload/thumbnails/poster.jpg",
    ],
)
def test_served_thumbnail_redirects_without_remote_fetch(settings, tmp_path, path):
    _write_thumbnail(settings, tmp_path, path)

    response = _get_thumbnail()

    assert response.status_code == 302
    assert response["Location"] == path


@pytest.mark.parametrize("path", ["javascript:alert(1)", "//other.example/poster.jpg", "/etc/passwd", "missing.jpg"])
def test_unserved_thumbnail_paths_remain_not_found(settings, tmp_path, path):
    _write_thumbnail(settings, tmp_path, path)

    with pytest.raises(NotFound):
        _get_thumbnail()


def test_external_video_preview_is_not_redirected(settings, tmp_path):
    _write_thumbnail(settings, tmp_path, "https://media.example/video.mp4", "mp4")

    with pytest.raises(NotFound):
        _get_thumbnail()


@pytest.mark.parametrize("options", [{"query": {"download": "1"}}, {"artifact_path": "../poster.jpg"}])
def test_redirect_does_not_bypass_download_or_nested_path_handling(settings, tmp_path, options):
    _write_thumbnail(settings, tmp_path, "/sports/api/blobs/media/upload/thumbnails/poster.jpg")

    with pytest.raises(NotFound):
        _get_thumbnail(**options)


def test_local_thumbnail_range_response_is_preserved(settings, tmp_path):
    _write_thumbnail(settings, tmp_path, "poster.jpg")
    (tmp_path / "poster.jpg").write_bytes(b"thumbnail")

    response = _get_thumbnail(headers={"range": "bytes=0-3"})
    try:
        assert response.status_code == 206
        assert response["Content-Type"] == "image/jpeg"
        assert response["Content-Range"] == "bytes 0-3/9"
        assert b"".join(response.streaming_content) == b"thum"
    finally:
        response.close()


def test_thumbnail_redirect_requires_authentication(settings, tmp_path):
    _write_thumbnail(settings, tmp_path, "/sports/api/blobs/media/upload/thumbnails/poster.jpg")

    response = MediaArtifactFileAPIView.as_view()(
        APIRequestFactory().get("/"),
        slug="football",
        project_id="project-1",
        package_id="package-1",
        artifact_id="poster-1",
    )

    assert response.status_code in {401, 403}
    assert not response.has_header("Location")
