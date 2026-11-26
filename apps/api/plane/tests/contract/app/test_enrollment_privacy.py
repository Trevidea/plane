"""Private request data never belongs in API-token audit or diagnostics."""

from unittest import TestCase
from unittest.mock import patch

from django.http import JsonResponse
from django.test import RequestFactory

from plane.middleware.logger import APITokenLogMiddleware, RequestLoggerMiddleware


def test_sensitive_enrollment_and_photo_requests_keep_only_operational_telemetry():
    def downstream(_request):
        return JsonResponse({"secret": "sensitive-response-marker"}, status=400)

    factory = RequestFactory()
    diagnostic = RequestLoggerMiddleware(APITokenLogMiddleware(downstream))
    project = "12345678-1111-4111-8111-123456789abc"
    paths = (
        "/auth/player-invitation/?token=ticket-marker",
        "/auth/player-registration/accept/",
        "/auth/player/password-reset/",
        f"/api/workspaces/fixture/projects/{project}/roster/import/",
        "/api/assets/v2/user-assets/",
        "/api/player/enrollment-diagnostics/",
    )
    operation = "enr-" + "1" * 32
    with patch("plane.middleware.logger.APIActivityLog.objects.create") as audit:
        with TestCase().assertLogs("plane.api.request", level="INFO") as captured:
            for path in paths:
                request = factory.post(
                    path,
                    data={
                        "password": "pass-marker", "code": "code-marker",
                        "email": "student-marker@example.test", "name": "photo-marker.jpg",
                        "rows": [{"full_name": "roster-row-marker"}],
                    },
                    content_type="application/json",
                    HTTP_X_API_KEY="api-key-marker",
                    HTTP_X_REQUEST_ID="short-code-header-marker",
                    HTTP_X_TRACE_ID="profile-header-marker",
                    HTTP_X_KANAVIO_OPERATION_ID=operation,
                    HTTP_X_KANAVIO_SCOPE="workspace-marker/program",
                    HTTP_X_KANAVIO_ENVIRONMENT="student-label-marker",
                )
                assert diagnostic(request).status_code == 400
        audit.assert_not_called()
        records = [record for record in captured.records if hasattr(record, "operation_id")]
        assert records
        assert all(record.scope == "unscoped" and record.operation_id == operation for record in records)
        assert not any("-marker" in str(record.__dict__) for record in records)
        diagnostic(factory.get("/api/workspaces/fixture/", HTTP_X_API_KEY="audit-key"))
        assert audit.call_count == 1
        assert audit.call_args.kwargs["body"] is None
