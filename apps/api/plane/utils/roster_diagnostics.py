"""Enrollment diagnostics select a fixed route/action; no request body is logged."""

import re
from uuid import uuid4

from django.urls import Resolver404, resolve

from plane.utils.diagnostic_logging import context


ROUTES = {
    ("project-roster", "POST"): ("save", None),
    ("project-roster-detail", "PATCH"): ("status-or-save", None),
    ("project-roster-detail", "DELETE"): ("status", None),
    ("project-roster-import", "POST"): ("import", None),
    ("project-roster-account-matches", "POST"): ("match", None),
    ("project-roster-import-matches", "POST"): ("match", None),
    ("project-roster-approve", "POST"): ("approve", "team-link"),
    ("project-roster-decline", "POST"): ("decline", "team-link"),
    ("project-roster-registration", "POST"): ("share-open", "team-link"),
    ("project-roster-registration", "DELETE"): ("share-close", "team-link"),
    ("project-roster-resend-invitation", "POST"): ("invitation-retry", "email"),
    ("project-roster-password-reset", "POST"): ("reset-issue", "assisted-reset"),
    ("project-roster-correction", "POST"): ("account-correction", None),
    ("project-roster-delegated", "POST"): ("save", None),
    ("project-roster-delegated-detail", "PATCH"): ("save", None),
    ("staff-roster-notice-read", "POST"): ("notice-read", None),
    ("player-roster-notice-read", "POST"): ("notice-read", None),
    ("player-registration-preview", "POST"): ("lookup", "team-link"),
    ("player-registration-accept", "POST"): ("join", "team-link"),
    ("player-invitation-preview", "POST"): ("lookup", "email"),
    ("player-invitation-accept", "POST"): ("join", "email"),
    ("player-password-reset", "POST"): ("reset", "assisted-reset"),
}
CORRELATION = re.compile(r"^(?:enr-[0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$")


def private_enrollment_path(path):
    return path.startswith((
        "/auth/player-invitation/", "/auth/player-registration/", "/auth/player/",
        "/api/player/invitations/", "/api/player/registration/", "/api/player/roster-notices/",
        "/api/player/enrollment-diagnostics/", "/api/assets/v2/user-assets/", "/api/users/file-assets/",
    )) or (
        path.startswith("/api/workspaces/") and ("/roster/" in path or path.endswith("/roster-notices/"))
    )


def roster_route(request):
    path = request.path_info
    if request.method not in ("POST", "PATCH", "DELETE") or not (
        "/roster/" in path or "/roster-notices/" in path or path.startswith(("/api/player/", "/auth/player"))
    ):
        return None
    try:
        return ROUTES.get((resolve(path).url_name, request.method))
    except Resolver404:
        return None


def enrollment_context(headers):
    def safe(name):
        value = headers.get(name, "")
        return value if isinstance(value, str) and CORRELATION.fullmatch(value) else None

    request_id = safe("x-request-id") or str(uuid4())
    return context(
        {
            "x-request-id": request_id,
            "x-kanavio-operation-id": safe("x-kanavio-operation-id") or request_id,
            "x-trace-id": safe("x-trace-id") or request_id,
        }
    )


def roster_fields(request, route, status):
    action, channel = route
    if action == "status-or-save":
        action = "status" if getattr(request, "_roster_status_changed", False) else "save"
    result = (
        "conflict"
        if status == 409
        else "throttled"
        if status == 429
        else "rejected"
        if 400 <= status < 500
        else "failed"
        if status >= 500
        else "acknowledged"
    )
    if status == 200 and getattr(request, "_roster_registration_state", None) == "pending":
        result = "pending-approval"
    if channel == "team-link" and action == "lookup" and getattr(request, "_roster_code_lookup", False):
        channel = "team-code"
    return {"action": action, "channel": channel, "result": result, "status_code": status}
