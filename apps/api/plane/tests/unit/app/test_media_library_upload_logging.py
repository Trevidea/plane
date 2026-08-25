import logging

import pytest

from plane.app.views.media_library import (
    MediaSourceValidationError,
    _TRANSCODE_SOURCE_FORMATS,
    _get_upload_trace_fields,
    _inspect_transcode_source,
    _log_media_upload_event,
)


class DummyRequest:
    headers = {
        "X-Upload-ID": " upload-20260818T130800Z-game-clip ",
        "X-Request-ID": " upload-20260818T130800Z-game-clip-try-1 ",
        "Cookie": "session=secret",
        "Authorization": "Bearer secret",
    }


def test_get_upload_trace_fields_preserves_safe_correlation_fields():
    trace = _get_upload_trace_fields(
        DummyRequest(),
        {
            "upload_client": "plane-web",
            "authorization": "Bearer secret",
            "cookie": "session=secret",
        },
    )

    assert trace == {
        "upload_id": "upload-20260818T130800Z-game-clip",
        "request_id": "upload-20260818T130800Z-game-clip-try-1",
        "upload_client": "plane-web",
    }


def test_log_media_upload_event_uses_structured_payload(caplog):
    with caplog.at_level(logging.INFO):
        _log_media_upload_event(
            logging.INFO,
            "request_received",
            {"upload_id": "upload-1", "request_id": "request-1"},
            workspace_slug="workspace",
            secret_token="must-not-log",
            duration_ms=25,
        )

    assert "media_library_upload_request_received" in caplog.text
    assert "upload-1" in caplog.text
    assert "request-1" in caplog.text
    assert "workspace" in caplog.text
    assert "must-not-log" not in caplog.text


def test_transcode_source_formats_include_mp4_and_mov():
    assert {"mp4", "mov"}.issubset(_TRANSCODE_SOURCE_FORMATS)


def _mov_probe(width=1920, height=1080, video_codec="h264", audio_codec="aac"):
    return {
        "format": {"format_name": "mov,mp4,m4a,3gp,3g2,mj2", "duration": "10.0"},
        "streams": [
            {
                "codec_type": "video",
                "codec_name": video_codec,
                "width": width,
                "height": height,
                "avg_frame_rate": "30/1",
            },
            {"codec_type": "audio", "codec_name": audio_codec},
        ],
    }


@pytest.mark.parametrize(("width", "height"), [(1920, 1080), (1280, 720)])
def test_inspect_transcode_source_accepts_mov_at_or_below_1080p(monkeypatch, tmp_path, width, height):
    monkeypatch.setattr("plane.app.views.media_library._probe_transcode_source", lambda _path: _mov_probe(width, height))

    metadata = _inspect_transcode_source(tmp_path / "clip.mov")

    assert metadata["width"] == width
    assert metadata["height"] == height
    assert metadata["duration"] == "00:00:10"


def test_inspect_transcode_source_rejects_4k_mov(monkeypatch, tmp_path):
    monkeypatch.setattr("plane.app.views.media_library._probe_transcode_source", lambda _path: _mov_probe(3840, 2160))

    with pytest.raises(MediaSourceValidationError) as exc:
        _inspect_transcode_source(tmp_path / "clip.mov")

    assert exc.value.code == "SOURCE_RESOLUTION_UNSUPPORTED"
    assert exc.value.message == "This video is 4K. The current upload limit is 1080p."


def test_inspect_transcode_source_rejects_unsupported_mov_codec(monkeypatch, tmp_path):
    monkeypatch.setattr(
        "plane.app.views.media_library._probe_transcode_source",
        lambda _path: _mov_probe(1920, 1080, video_codec="vp9"),
    )

    with pytest.raises(MediaSourceValidationError) as exc:
        _inspect_transcode_source(tmp_path / "clip.MOV")

    assert exc.value.code == "SOURCE_CODEC_UNSUPPORTED"
