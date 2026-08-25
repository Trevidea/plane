import pytest
from django.conf import settings


@pytest.mark.unit
def test_media_upload_trace_headers_are_allowed_for_cors():
    allowed_headers = {header.lower() for header in settings.CORS_ALLOW_HEADERS}

    assert "x-request-id" in allowed_headers
    assert "x-upload-id" in allowed_headers
