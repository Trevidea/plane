import io
import json
from urllib.error import HTTPError
import pytest
from plane.utils import event_first_frame_thumbnail as thumbnails


class WorkerImage(io.BytesIO):
    status = 200
    headers = {"Content-Type": "image/jpeg"}


def fetch(meta=None, **overrides):
    options = dict(
        meta=meta or {"event": {"primaryStreamName": "stream-first", "devices": [{"streamName": "stream-second"}]}},
        event_payload={},
        identity=("project", "package", "event"),
        worker_base="http://thumbnail-service:5000",
        hls_base="http://llhls-server:59919",
        timeout=10,
    )
    return thumbnails.get_event_first_frame_thumbnail(**(options | overrides))


def test_saved_volume_cache_does_not_generate(monkeypatch):
    calls = []
    monkeypatch.setattr(
        thumbnails.urlrequest, "urlopen",
        lambda request, **kwargs: calls.append(request) or WorkerImage(b"\xff\xd8\xffcached"),
    )
    assert fetch() == b"\xff\xd8\xffcached"
    assert len(calls) == 1
    assert calls[0].method == "GET"
    assert "/thumbnails/event-first-frame-" in calls[0].full_url


def test_missing_frame_generates_first_stream_at_zero(monkeypatch):
    calls = []
    def open_request(request, **kwargs):
        calls.append(request)
        if len(calls) == 1:
            raise HTTPError(request.full_url, 404, "missing", {}, None)
        return WorkerImage(b"\xff\xd8\xffframe")
    monkeypatch.setattr(thumbnails.urlrequest, "urlopen", open_request)
    assert fetch() == b"\xff\xd8\xffframe"
    assert [request.method for request in calls] == ["GET", "POST", "GET"]
    payload = json.loads(calls[1].data)
    assert payload == {
        "url": "http://llhls-server:59919/stream-first/llhls.m3u8",
        "timestamp": 0,
        "first_segment": True,
        "filename": calls[0].full_url.rsplit("/", 1)[1],
    }
    assert calls[2].full_url == calls[0].full_url


@pytest.mark.parametrize(
    "stream", ["../escape", "https://evil.test/a", "stream/other", "stream?url=evil", "", "a" * 181]
)
def test_bad_stream_never_fetches(monkeypatch, stream):
    monkeypatch.setattr(thumbnails.urlrequest, "urlopen", lambda *args, **kwargs: pytest.fail("unexpected fetch"))
    assert fetch(meta={"event": {"primaryStreamName": stream}}) is None


def test_first_device_and_media_reference_resolve_same_stream(monkeypatch):
    calls = []
    monkeypatch.setattr(
        thumbnails.urlrequest, "urlopen",
        lambda request, **kwargs: calls.append(request.full_url) or WorkerImage(b"\xff\xd8\xffframe"),
    )
    fetch(meta={"event": {"devices": [{"streamName": "stream-first"}, {"streamName": "stream-second"}]}})
    first_url = calls[-1]
    fetch(meta={"event": {"mediaReferences": [{"streamName": "stream-first"}]}})
    assert calls[-1] == first_url
    fetch(meta={"event": {"primaryStreamName": "stream-second"}})
    assert calls[-1] != first_url


@pytest.mark.parametrize("hls_base", ["", "file:///data", "https://user:secret@host", "https://host/?url=evil"])
def test_bad_hls_configuration_never_fetches(monkeypatch, hls_base):
    monkeypatch.setattr(thumbnails.urlrequest, "urlopen", lambda *args, **kwargs: pytest.fail("unexpected fetch"))
    assert fetch(hls_base=hls_base) is None


def test_unavailable_or_invalid_frame_is_graceful(monkeypatch):
    monkeypatch.setattr(thumbnails.urlrequest, "urlopen", lambda request, **kwargs: WorkerImage(b"not a frame"))
    assert fetch() is None
    def unavailable(request, **kwargs):
        raise HTTPError(request.full_url, 503, "unavailable", {}, None)
    monkeypatch.setattr(thumbnails.urlrequest, "urlopen", unavailable)
    assert fetch() is None


def _event_request(settings, tmp_path, *, query=None, meta=None):
    from types import SimpleNamespace
    from plane.utils.media_library import manifest_path, write_manifest_atomic
    from plane.app.views.media_library import MediaArtifactFileAPIView
    settings.MEDIA_LIBRARY_ROOT = str(tmp_path)
    settings.MEDIA_EVENT_HLS_BASE_URL = "http://llhls-server:59919"
    manifest_file = manifest_path("project-1", "package-1")
    manifest_file.parent.mkdir(parents=True, exist_ok=True)
    artifact = {
        "name": "event-1", "format": "json", "path": "event.json",
        "meta": meta or {"artifact_type": "completed-event-json", "event": {"primaryStreamName": "stream-first"}},
    }
    write_manifest_atomic(manifest_file, {"artifacts": [artifact]})
    (tmp_path / "event.json").write_text('{"primaryStreamName":"stream-first"}')
    request = SimpleNamespace(query_params=query or {"thumbnail": "first-stream"}, headers={}, META={})
    return MediaArtifactFileAPIView.get.__wrapped__(
        MediaArtifactFileAPIView(), request, "football", "project-1", "package-1", "event-1"
    )


def test_authenticated_artifact_query_returns_first_stream_image(settings, tmp_path, monkeypatch):
    from plane.app.views import media_library
    calls = []
    monkeypatch.setattr(
        media_library, "get_event_first_frame_thumbnail",
        lambda **kwargs: calls.append(kwargs) or b"\xff\xd8\xffframe", raising=False,
    )
    response = _event_request(settings, tmp_path)
    assert response["Content-Type"] == "image/jpeg"
    assert response.content == b"\xff\xd8\xffframe"
    assert calls[0]["identity"] == ("project-1", "package-1", "event-1")


def test_event_image_query_requires_authentication(settings, tmp_path, monkeypatch):
    from plane.app.views import media_library
    from rest_framework.test import APIRequestFactory
    monkeypatch.setattr(
        media_library, "get_event_first_frame_thumbnail",
        lambda **kwargs: pytest.fail("unauthorized generation"), raising=False,
    )
    response = media_library.MediaArtifactFileAPIView.as_view()(
        APIRequestFactory().get("/?thumbnail=first-stream"),
        slug="football", project_id="project-1", package_id="package-1", artifact_id="event-1",
    )
    assert response.status_code in {401, 403}


def test_unavailable_frame_returns_not_found(settings, tmp_path, monkeypatch):
    from plane.app.views import media_library
    from rest_framework.exceptions import NotFound
    monkeypatch.setattr(media_library, "get_event_first_frame_thumbnail", lambda **kwargs: None, raising=False)
    with pytest.raises(NotFound):
        _event_request(settings, tmp_path)


def test_non_event_artifact_cannot_request_stream_frame(settings, tmp_path, monkeypatch):
    from plane.app.views import media_library
    from rest_framework.exceptions import NotFound
    monkeypatch.setattr(
        media_library, "get_event_first_frame_thumbnail",
        lambda **kwargs: pytest.fail("non-event generation"), raising=False,
    )
    with pytest.raises(NotFound):
        _event_request(settings, tmp_path, meta={"source": "upload"})


def test_tag_thumbnail_and_request_urls_are_not_stream_sources(monkeypatch):
    monkeypatch.setattr(thumbnails.urlrequest, "urlopen", lambda *args, **kwargs: pytest.fail("unexpected fetch"))
    meta = {"event": {"tags": [{"thumbnailUrl": "https://evil.test/frame.jpg"}], "url": "https://evil.test/video.m3u8"}}
    assert fetch(meta=meta) is None


@pytest.mark.parametrize("meta", [
    {"rawEvent": {"stream_name": "stream-first"}},
    {"event": {"rawEvent": {"streamName": "stream-first"}}},
])
def test_nested_raw_event_first_stream_is_supported(monkeypatch, meta):
    monkeypatch.setattr(
        thumbnails.urlrequest, "urlopen", lambda request, **kwargs: WorkerImage(b"\xff\xd8\xffframe")
    )
    assert fetch(meta=meta) == b"\xff\xd8\xffframe"


def test_incomplete_event_metadata_uses_saved_event_json(settings, tmp_path, monkeypatch):
    from plane.app.views import media_library
    calls = []
    monkeypatch.setattr(
        media_library, "get_event_first_frame_thumbnail",
        lambda **kwargs: calls.append(kwargs) or b"\xff\xd8\xffframe",
    )
    _event_request(settings, tmp_path, meta={"artifact_type": "completed-event-json", "event": {}})
    assert calls[0]["event_payload"] == {"primaryStreamName": "stream-first"}
