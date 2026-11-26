"""Short-lived provenance for reporting a server-observed enrollment attempt."""

import hashlib
import math
import re
from datetime import datetime, timezone

from django.conf import settings
from django.core.cache import cache
from django.urls import resolve


OPERATION_ID = re.compile(r"enr-[a-f0-9]{32}")
REPORT_SEGMENT = "/enrollment-report/"
MAX_AGE = 900
WEB_UI = {
    "save",
    "status",
    "import",
    "match",
    "approve",
    "decline",
    "share-open",
    "share-close",
    "invitation-retry",
    "reset-issue",
    "account-correction",
}
PLAYER_UI = {"lookup", "join", "account-create", "invitation-accept", "reset"}
RESULTS = ("confirmed", "pending-approval", "failed", "interrupted", "unverified")


def bind_project(request, slug, project_id, *, verified_actor=None):
    """Call only after validating the enrollment authority for this program."""
    request._enrollment_report_project = (slug, str(project_id))
    if verified_actor:
        request._enrollment_report_actor = verified_actor


def key(actor, operation):
    return "enrollment-report:" + hashlib.sha256(f"{actor}:{operation}".encode()).hexdigest()


def remember(request, operation, fields, duration):
    if not settings.CUSTOMER_DIAGNOSTICS_ENABLED or not OPERATION_ID.fullmatch(operation or ""):
        return
    from plane.app.views.workspace.diagnostics import diagnostics_workspace_allowed

    project = getattr(request, "_enrollment_report_project", None)
    actor = getattr(request, "_enrollment_report_actor", None)
    if actor is None:
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated or not user.is_active or user.is_bot:
            return
        actor = user.pk
    if project:
        role = "player"
        slug, project_id = project
    else:
        role = "coach"
        params = resolve(request.path_info).kwargs
        slug, project_id = params.get("slug"), str(params.get("project_id") or "")
        if fields["action"] not in WEB_UI or not slug or not project_id:
            return
    if not diagnostics_workspace_allowed(slug):
        return
    cache.add(
        key(actor, operation),
        {
            "workspace": slug,
            "project": project_id,
            "role": role,
            "fields": fields,
            "duration_ms": duration,
            "occurred_at": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        },
        timeout=MAX_AGE,
    )


def observation(value, action, role):
    if not isinstance(value, dict) or set(value) not in (
        {"action", "result", "duration_ms"},
        {"action", "result", "duration_ms", "inactivity_ms"},
    ):
        raise ValueError("Invalid enrollment observation.")
    field, result, duration = (value[k] for k in ("action", "result", "duration_ms"))
    permitted = WEB_UI if role == "coach" else PLAYER_UI
    aliases = {
        "join": {"join", "account-create", "invitation-accept"},
        "save": {"save", "status"},
        "status": {"save", "status"},
    }
    if (
        not isinstance(field, str)
        or field not in permitted
        or field not in aliases.get(action, {action})
        or result not in RESULTS
        or (result == "pending-approval" and field not in ("join", "invitation-accept"))
        or type(duration) not in (int, float)
        or not math.isfinite(duration)
        or not 0 <= duration <= 3_600_000
    ):
        raise ValueError("Invalid enrollment observation values.")
    cleaned = {"action": field, "result": result}
    if "inactivity_ms" in value:
        inactivity = value["inactivity_ms"]
        if (
            role != "coach"
            or field != "import"
            or result != "confirmed"
            or type(inactivity) not in (int, float)
            or not math.isfinite(inactivity)
            or not 0 <= inactivity <= duration
        ):
            raise ValueError("Invalid import observation.")
        cleaned.update(roster_timing="import-inactivity.v1", roster_inactivity_ms=inactivity)
    elif field == "lookup" and result == "confirmed":
        cleaned["roster_timing"] = "lookup.v1"
    elif field in ("join", "invitation-accept") and result in ("confirmed", "pending-approval"):
        cleaned["roster_timing"] = "join-confirmation.v1"
    return cleaned
