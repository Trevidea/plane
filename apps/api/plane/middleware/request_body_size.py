from django.conf import settings
from django.core.exceptions import RequestDataTooBig
from django.http import JsonResponse


class RequestBodySizeLimitMiddleware:
    """
    Middleware to catch RequestDataTooBig exceptions and return
    413 Request Entity Too Large instead of 400 Bad Request.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        content_length = self._get_content_length(request)
        body_size_limit = self._get_body_size_limit()
        if body_size_limit is not None and content_length is not None and content_length > body_size_limit:
            return JsonResponse(
                {
                    "error": "REQUEST_BODY_TOO_LARGE",
                    "detail": "The size of the request body exceeds the maximum allowed size.",
                },
                status=413,
            )

        try:
            return self.get_response(request)
        except RequestDataTooBig:
            return JsonResponse(
                {
                    "error": "REQUEST_BODY_TOO_LARGE",
                    "detail": "The size of the request body exceeds the maximum allowed size.",
                },
                status=413,
            )

    @staticmethod
    def _get_body_size_limit():
        value = getattr(settings, "DATA_UPLOAD_MAX_MEMORY_SIZE", None)
        if value in (None, ""):
            return None
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _get_content_length(request):
        raw_value = request.META.get("CONTENT_LENGTH")
        if raw_value in (None, ""):
            return None
        try:
            return int(raw_value)
        except (TypeError, ValueError):
            return None
