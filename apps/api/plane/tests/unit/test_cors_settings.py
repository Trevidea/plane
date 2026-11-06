import pytest
from django.conf import settings


@pytest.mark.unit
def test_media_upload_trace_headers_are_allowed_for_cors():
    allowed_headers = {header.lower() for header in settings.CORS_ALLOW_HEADERS}

    assert "x-request-id" in allowed_headers
    assert "x-upload-id" in allowed_headers
    assert {
        "x-trace-id",
        "x-kanavio-operation-id",
        "x-kanavio-operation-kind",
        "x-kanavio-scope",
        "x-kanavio-environment",
        "x-video-name",
        "x-video-size",
    } <= allowed_headers


@pytest.mark.unit
def test_private_video_preflight_allows_upload_headers_for_the_configured_origin():
    from django.test import Client, override_settings

    origin = "http://plane.fixture.test"
    with override_settings(CORS_ALLOWED_ORIGINS=[origin], CORS_ALLOW_ALL_ORIGINS=False):
        response = Client().options(
            "/api/workspaces/school/projects/card/private-threads/player/attachments/",
            HTTP_ORIGIN=origin,
            HTTP_ACCESS_CONTROL_REQUEST_METHOD="POST",
            HTTP_ACCESS_CONTROL_REQUEST_HEADERS="content-type,x-video-name,x-video-size",
        )
        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == origin
        assert response.headers["access-control-allow-credentials"] == "true"
        headers = {header.strip().lower() for header in response.headers["access-control-allow-headers"].split(",")}
        assert {"content-type", "x-video-name", "x-video-size"} <= headers

        denied = Client().options(
            "/api/workspaces/school/projects/card/private-threads/player/attachments/",
            HTTP_ORIGIN="https://untrusted.fixture.test",
            HTTP_ACCESS_CONTROL_REQUEST_METHOD="POST",
            HTTP_ACCESS_CONTROL_REQUEST_HEADERS="content-type,x-video-name,x-video-size",
        )
        assert "access-control-allow-origin" not in denied.headers
