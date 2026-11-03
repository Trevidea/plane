"""Project-scoped diagnostics bridge. No arbitrary sources or generation commands."""

import base64
import hashlib
import hmac
import json
import math
import os
import re
import time
from datetime import datetime, timezone
from uuid import uuid4
from urllib.parse import urlsplit

import requests
from django.conf import settings
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle

from plane.app.permissions import ROLE, allow_permission
from plane.app.views.workspace.diagnostics import (
    _bridge_key,
    _bridge_origin,
    _invalid_number,
    WorkspaceDiagnosticsEndpoint,
)
from plane.utils.diagnostic_logging import logger

ACTIONS = {
    "upload": "acknowledged",
    "playback": "ready",
    "coaching-card": "acknowledged",
    "media-finalization": "completed",
}


class OperationDiagnosticsThrottle(UserRateThrottle):
    rate = "120/min"
    scope = "operation_diagnostics"


def product_request(user_id, slug, project_id, path, body=None):
    origin, key = _bridge_origin(), _bridge_key()
    identity_path = settings.CUSTOMER_DIAGNOSTICS_IDENTITY_KEY_FILE
    actor_key = _bridge_key(identity_path) if identity_path else key
    principal = {
        "workspace": slug,
        "project": str(project_id),
        "actor": hmac.new(actor_key.encode(), f"product-actor:{user_id}".encode(), hashlib.sha256).hexdigest(),
        "role": "coach",
    }
    claims = base64.urlsafe_b64encode(json.dumps(principal, separators=(",", ":")).encode()).decode().rstrip("=")
    payload = b"" if body is None else json.dumps(body, separators=(",", ":"), allow_nan=False).encode()
    method, stamp, nonce = "GET" if body is None else "POST", str(int(time.time())), uuid4().hex
    signature = hmac.new(
        key.encode(),
        "\n".join([method, path, stamp, nonce, claims, hashlib.sha256(payload).hexdigest()]).encode(),
        hashlib.sha256,
    ).hexdigest()
    headers = {
        "Content-Type": "application/json",
        "X-Kanavio-Product-Time": stamp,
        "X-Kanavio-Product-Nonce": nonce,
        "X-Kanavio-Product-Claims": claims,
        "X-Kanavio-Product-Signature": signature,
    }
    with requests.Session() as session:
        session.trust_env = False
        deadline = time.monotonic() + 10
        with session.request(
            method,
            origin + path,
            data=payload or None,
            headers=headers,
            timeout=(2, 5),
            allow_redirects=False,
            stream=True,
        ) as upstream:
            if upstream.headers.get("Content-Type", "").split(";")[0] != "application/json":
                raise ValueError("Invalid response")
            content = bytearray()
            for chunk in upstream.iter_content(chunk_size=4096):
                content.extend(chunk)
                if len(content) > 65536 or time.monotonic() > deadline:
                    raise ValueError("Response exceeds limits")
            if upstream.status_code not in {200, 201, 202, 400, 403, 404, 409, 429}:
                raise ValueError("Diagnostics unavailable")
            value = json.loads(content, parse_constant=_invalid_number)
            if not isinstance(value, dict):
                raise ValueError("Invalid response")
            return value, upstream.status_code


def browser_measurement(body, scope):
    required = {"action", "operation_id", "event_name", "occurred_at", "duration_ms", "policy_id", "offset_ms"}
    if (
        not isinstance(body, dict)
        or set(body) != required
        or not isinstance(body["action"], str)
        or body["action"] not in ACTIONS
    ):
        raise ValueError("Invalid measurement")
    action, event = body["action"], body["event_name"]
    if not isinstance(event, str):
        raise ValueError("Invalid event")
    permitted = {
        f"{action}.{ACTIONS[action]}",
        f"{action}.failed",
        f"{action}.confirmation-unverified",
        f"{action}.waiting",
        f"{action}.budget-exceeded",
    }
    if action == "upload":
        permitted.add("upload.stalled")
    duration = body["duration_ms"]
    offset = body["offset_ms"]
    if (
        event not in permitted
        or not isinstance(body["operation_id"], str)
        or not re.fullmatch(r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}", body["operation_id"])
        or not isinstance(body["policy_id"], str)
        or not re.fullmatch(r"[a-f0-9]{64}", body["policy_id"])
        or isinstance(duration, bool)
        or not isinstance(duration, (int, float))
        or not math.isfinite(duration)
        or not 0 <= duration <= 3600000
        or isinstance(offset, bool)
        or not isinstance(offset, (int, float))
        or not math.isfinite(offset)
        or not 0 <= offset <= 3600000
        or duration + offset > 3600000
    ):
        raise ValueError("Invalid measurement")
    if (
        not isinstance(body["occurred_at"], str)
        or len(body["occurred_at"]) > 35
        or not body["occurred_at"].endswith("Z")
        or abs(datetime.fromisoformat(body["occurred_at"].replace("Z", "+00:00")).timestamp() - time.time()) > 86400
    ):
        raise ValueError("Invalid measurement time")
    identity = body["operation_id"]
    return {
        "schema_version": "1.0",
        "service": "plane-api",
        "environment": os.environ.get("KANAVIO_ENVIRONMENT", "production"),
        "kind": action,
        "scope": scope,
        "timestamp": datetime.fromtimestamp(
            datetime.fromisoformat(body["occurred_at"].replace("Z", "+00:00")).timestamp() + offset / 1000, timezone.utc
        )
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z"),
        "operation_started_at": body["occurred_at"],
        "operation_id": identity,
        "request_id": identity,
        "trace_id": identity,
        "record_id": f"{identity}:{event}",
        "clock_id": f"browser:{identity}",
        "offset_ms": offset,
        "duration_ms": duration,
        "event_name": event,
        "outcome": "error"
        if event.endswith(".failed")
        else "cancelled"
        if event.endswith("unverified")
        else "unknown"
        if event.endswith((".waiting", ".budget-exceeded", ".stalled"))
        else "ok",
        "context": {"measurement_origin": "browser", "operation_policy_id": body["policy_id"]},
    }


class ProjectOperationDiagnosticsEndpoint(WorkspaceDiagnosticsEndpoint):
    http_method_names = ["get", "post", "head", "options"]
    throttle_classes = [OperationDiagnosticsThrottle]

    def bridge(self, request, slug, project_id, body=None):
        if not settings.CUSTOMER_DIAGNOSTICS_ENABLED:
            return Response({"enabled": False})
        if slug != settings.CUSTOMER_DIAGNOSTICS_WORKSPACE or not request.user.is_active or request.user.is_bot:
            return Response({"error": "Diagnostics is not available for this program."}, status=403)
        view, identity = request.query_params.get("view"), request.query_params.get("id")
        if set(request.query_params) - {"view", "id"}:
            return Response({"error": "Invalid diagnostics request."}, status=400)
        paths = {"capabilities": "/api/product/capabilities", "report": "/api/product/incidents"}
        if view in {"incident", "submit"} and isinstance(identity, str) and re.fullmatch(r"[a-f0-9]{32}", identity):
            paths[view] = f"/api/product/incidents/{identity}" + ("/submit" if view == "submit" else "")
        if (request.method == "GET" and view not in {"capabilities", "incident"}) or (
            request.method == "POST" and view not in {"report", "submit", "measurement"}
        ):
            return Response({"error": "Invalid diagnostics action."}, status=400)
        try:
            if view == "measurement":
                try:
                    record = browser_measurement(body, f"{slug}/{project_id}")
                except (ValueError, TypeError, KeyError, OverflowError):
                    return Response({"error": "Invalid diagnostics measurement."}, status=400)
                try:
                    (logger.error if record["outcome"] == "error" else logger.info)(record["event_name"], extra=record)
                except Exception:
                    return Response({"error": "Measurement unavailable."}, status=503)
                return Response({"accepted": True})
            if view not in paths:
                return Response({"error": "Invalid diagnostics action."}, status=400)
            value, status = product_request(request.user.id, slug, project_id, paths[view], body)
            return Response(
                value if status < 400 else {"error": "Diagnostics could not complete this request."}, status=status
            )
        except (OSError, ValueError, TypeError, KeyError, RecursionError, requests.RequestException):
            return Response({"error": "Diagnostics is temporarily unavailable."}, status=503)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def get(self, request, slug, project_id):
        return self.bridge(request, slug, project_id)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def post(self, request, slug, project_id):
        origin = request.headers.get("Origin", "")
        allowed = {str(getattr(settings, "WEB_URL", "") or "").rstrip("/"), f"{request.scheme}://{request.get_host()}"}
        allowed.update(str(value).rstrip("/") for value in getattr(settings, "CORS_ALLOWED_ORIGINS", []))
        if not origin or origin not in allowed or urlsplit(origin).path or urlsplit(origin).username:
            return Response({"error": "Invalid diagnostics origin."}, status=403)
        if request.META.get("CONTENT_LENGTH") and not str(request.META["CONTENT_LENGTH"]).isdigit():
            return Response({"error": "Invalid request size."}, status=400)
        if int(request.META.get("CONTENT_LENGTH") or 0) > 4096:
            return Response({"error": "Diagnostics request exceeds limits."}, status=413)
        try:
            raw = request.stream.read(4097)
            if len(raw) > 4096:
                return Response({"error": "Diagnostics request exceeds limits."}, status=413)
            body = json.loads(raw, parse_constant=_invalid_number)
        except (ValueError, UnicodeError):
            return Response({"error": "Invalid diagnostics request."}, status=400)
        return self.bridge(request, slug, project_id, body)
