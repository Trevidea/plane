# Python imports
import logging
import time
import hashlib
import json
from contextlib import ExitStack

# Django imports
from django.http import HttpRequest

# Third party imports
from rest_framework.request import Request

# Module imports
from plane.utils.ip_address import get_client_ip
from plane.db.models import APIActivityLog
from plane.utils.diagnostic_logging import context, current, emit, outgoing_headers

api_logger = logging.getLogger("plane.api.request")


class RequestLoggerMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def _should_log_route(self, request: Request | HttpRequest) -> bool:
        """
        Determines whether a route should be logged based on the request and status code.
        """
        # Don't log health checks
        if request.path == "/" and request.method == "GET":
            return False
        return True

    def __call__(self, request):
        if not self._should_log_route(request):
            return self.get_response(request)
        from django.db import connections

        token = current.set(context(request.headers))
        started, status_code = time.perf_counter(), 500
        database = {"count": 0, "duration": 0.0, "errors": 0}

        def observe(execute, sql, params, many, execution_context):
            begin = time.perf_counter()
            try:
                return execute(sql, params, many, execution_context)
            except BaseException:
                database["errors"] += 1
                raise
            finally:
                database["count"] += 1
                database["duration"] += (time.perf_counter() - begin) * 1000

        try:
            with ExitStack() as stack:
                for connection in connections.all():
                    stack.enter_context(connection.execute_wrapper(observe))
                response = self.get_response(request)
            status_code = response.status_code
            for key, value in outgoing_headers().items():
                if not response.has_header(key):
                    response[key] = value
            return response
        finally:
            emit(
                "api.request.completed",
                duration_ms=(time.perf_counter() - started) * 1000,
                outcome="error" if status_code >= 400 else "ok",
                fields={"status_code": status_code, "action": request.method},
            )
            if database["count"]:
                emit(
                    "db.request.completed",
                    duration_ms=database["duration"],
                    outcome="error" if database["errors"] else "ok",
                    fields={
                        "query_count": database["count"],
                        "error_count": database["errors"],
                        "dependency": "postgres",
                    },
                )
            current.reset(token)


class APITokenLogMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        self.process_request(request, response, None)
        return response

    def _safe_decode_body(self, content):
        """
        Safely decodes request/response body content, handling binary data.
        Returns None if content is None, or a string representation of the content.
        """
        # If the content is None, return None
        if content is None:
            return None

        # If the content is an empty bytes object, return None
        if content == b"":
            return None

        # Check if content is binary by looking for common binary file signatures
        if content.startswith(b"\x89PNG") or content.startswith(b"\xff\xd8\xff") or content.startswith(b"%PDF"):
            return "[Binary Content]"

        try:
            return content.decode("utf-8")
        except UnicodeDecodeError:
            return "[Could not decode content]"

    def process_request(self, request, response, request_body):
        # Player session responses contain CSRF state; login bodies contain passwords.
        if request.path.startswith("/auth/player/"):
            return
        api_key_header = "X-Api-Key"
        api_key = request.headers.get(api_key_header)
        # If the API key is present, log the request
        if api_key:
            try:
                APIActivityLog.objects.create(
                    token_identifier="sha256:" + hashlib.sha256(api_key.encode()).hexdigest(),
                    path=request.path,
                    method=request.method,
                    query_params=json.dumps(sorted(request.GET.keys())[:64]),
                    headers=json.dumps({"Content-Type": request.headers.get("Content-Type", "")[:100]}),
                    body=None,
                    response_body=None,
                    response_code=response.status_code,
                    ip_address=get_client_ip(request=request),
                    user_agent=request.META.get("HTTP_USER_AGENT", None),
                )

            except Exception:
                emit("audit.write.failed", outcome="error", fields={"error_code": "AUDIT_STORAGE_FAILED"})
                # If the token does not exist, you can decide whether to log this as an invalid attempt

        return None
