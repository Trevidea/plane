from types import SimpleNamespace

import pytest
from django.core.exceptions import RequestDataTooBig
from django.http import HttpResponse
from django.test import override_settings

from plane.middleware.request_body_size import RequestBodySizeLimitMiddleware


class BodyAccessFailingRequest:
    META = {"CONTENT_LENGTH": "1024"}

    @property
    def body(self):
        raise AssertionError("request.body should not be read in request body size middleware")


@pytest.mark.unit
class TestRequestBodySizeLimitMiddleware:
    @override_settings(DATA_UPLOAD_MAX_MEMORY_SIZE=2048)
    def test_allows_request_without_reading_body(self):
        response = HttpResponse(status=204)
        middleware = RequestBodySizeLimitMiddleware(lambda request: response)

        assert middleware(BodyAccessFailingRequest()) is response

    @override_settings(DATA_UPLOAD_MAX_MEMORY_SIZE=2048)
    def test_rejects_oversized_content_length(self):
        request = SimpleNamespace(META={"CONTENT_LENGTH": "2049"})
        middleware = RequestBodySizeLimitMiddleware(lambda request: HttpResponse(status=204))

        response = middleware(request)

        assert response.status_code == 413
        assert b"REQUEST_BODY_TOO_LARGE" in response.content

    @override_settings(DATA_UPLOAD_MAX_MEMORY_SIZE=2048)
    def test_catches_downstream_request_data_too_big(self):
        request = SimpleNamespace(META={})

        def get_response(_request):
            raise RequestDataTooBig("too large")

        middleware = RequestBodySizeLimitMiddleware(get_response)

        response = middleware(request)

        assert response.status_code == 413
        assert b"REQUEST_BODY_TOO_LARGE" in response.content
