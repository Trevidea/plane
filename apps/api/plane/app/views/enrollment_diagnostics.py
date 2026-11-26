"""Register owned enrollment evidence with the installation diagnostics service."""

import json
import re

import requests
from django.conf import settings
from django.core.cache import cache
from rest_framework.authentication import SessionAuthentication
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle

from plane.app.views.base import BaseAPIView
from plane.app.views.workspace.diagnostics import _bridge_key, _invalid_number, diagnostics_workspace_allowed
from plane.app.views.workspace.operation_diagnostics import product_actor, product_request
from plane.db.models import Project
from plane.utils.diagnostic_logging import context, emit
from plane.utils.enrollment_reports import OPERATION_ID, REPORT_SEGMENT, key, observation
from plane.utils.player_registration import can_manage_registration


class EnrollmentReportThrottle(UserRateThrottle):
    scope = "enrollment_diagnostics"
    rate = "20/min"


class EnrollmentReportEndpoint(BaseAPIView):
    authentication_classes = [SessionAuthentication]
    user_role_access = True
    throttle_classes = [EnrollmentReportThrottle]

    def post(self, request):
        private = {"Cache-Control": "private, no-store"}
        origin = request.headers.get("Origin")
        origins = {f"{request.scheme}://{request.get_host()}", str(settings.WEB_URL).rstrip("/")}
        origins.update(str(value).rstrip("/") for value in getattr(settings, "CORS_ALLOWED_ORIGINS", []))
        if (
            not settings.CUSTOMER_DIAGNOSTICS_ENABLED
            or origin not in origins
            or not request.user.is_active
            or request.user.is_bot
        ):
            return Response({"error": "Enrollment reporting is unavailable."}, status=403, headers=private)
        try:
            size = request.META.get("CONTENT_LENGTH", "0") or "0"
            if not size.isdigit() or int(size) > 2048:
                raise ValueError()
            data = request.stream.read(2049)
            if len(data) > 2048:
                raise ValueError()
            body = json.loads(data, parse_constant=_invalid_number)
            if not isinstance(body, dict) or not isinstance(body.get("operation_id"), str):
                raise ValueError()
            operation = body["operation_id"]
            if not OPERATION_ID.fullmatch(operation):
                raise ValueError()
            mode = body.get("mode")
            if mode == "save":
                if set(body) not in ({"mode", "operation_id"}, {"mode", "operation_id", "observation"}):
                    raise ValueError()
            elif mode == "observe":
                if set(body) != {"mode", "operation_id", "observation"}:
                    raise ValueError()
            elif (
                mode not in ("status", "send")
                or set(body) != {"mode", "operation_id", "incident_id"}
                or not isinstance(body["incident_id"], str)
                or not re.fullmatch(r"[a-f0-9]{32}", body["incident_id"])
            ):
                raise ValueError()
        except (ValueError, UnicodeError, TypeError, RecursionError):
            return Response({"error": "Invalid enrollment report request."}, status=400, headers=private)

        try:
            attempt_key = key(request.user.pk, operation)
            status_key = "registered:" + attempt_key
            receipt = cache.get(status_key if mode in ("status", "send") else attempt_key)
            if not receipt or not diagnostics_workspace_allowed(receipt["workspace"]):
                return Response({"error": "Enrollment evidence is unavailable."}, status=404, headers=private)
            if mode in ("status", "send") and body["incident_id"] != receipt["incident_id"]:
                return Response({"error": "Enrollment report is unavailable."}, status=404, headers=private)
            slug, project_id, role = (receipt[k] for k in ("workspace", "project", "role"))
            project = (
                Project.objects.select_related("workspace")
                .filter(
                    pk=project_id, workspace__slug=slug, workspace__deleted_at__isnull=True, archived_at__isnull=True
                )
                .first()
            )
            if project is None or (role == "coach" and not can_manage_registration(request.user, project)):
                return Response({"error": "Enrollment reporting is unavailable."}, status=403, headers=private)
            if mode in ("save", "observe"):
                try:
                    ui = (
                        observation(body["observation"], receipt["fields"]["action"], role)
                        if "observation" in body
                        else None
                    )
                except ValueError:
                    return Response({"error": "Invalid enrollment observation."}, status=400, headers=private)
            if mode == "observe":
                if role != "player":
                    return Response({"error": "Player observation required."}, status=403, headers=private)
                if cache.add("observed:" + attempt_key, True, timeout=900):
                    emit(
                        "roster.report.player.completed",
                        context_override=context({"x-kanavio-operation-id": operation, "x-request-id": operation}),
                        fields=ui,
                        duration_ms=body["observation"]["duration_ms"],
                        outcome=ui_outcome(ui),
                    )
                return Response({"accepted": True}, headers=private)
            if mode != "save":
                path = f"/api/product/incidents/{body['incident_id']}"
                value, status = product_request(
                    request.user.pk,
                    slug,
                    project_id,
                    path + ("/submit" if mode == "send" else ""),
                    {"consent": True} if mode == "send" else None,
                    role=role,
                )
            else:
                actor = product_actor(request.user.pk, _bridge_key())
                scope = f"{slug}/{project_id}{REPORT_SEGMENT}{actor}/{operation}"
                ctx = context(
                    {
                        "x-kanavio-operation-id": operation,
                        "x-request-id": operation,
                        "x-kanavio-scope": scope,
                    }
                )
                if cache.add("captured:" + attempt_key, True, timeout=900):
                    emit(
                        "roster.api.completed",
                        context_override=ctx,
                        fields=receipt["fields"],
                        duration_ms=receipt["duration_ms"],
                        outcome="error" if receipt["fields"]["status_code"] >= 400 else "ok",
                    )
                    if ui:
                        emit(
                            "roster.report.web.completed" if role == "coach" else "roster.report.player.completed",
                            context_override=ctx,
                            fields=ui,
                            duration_ms=body["observation"]["duration_ms"],
                            outcome=ui_outcome(ui),
                        )
                value, status = product_request(
                    request.user.pk,
                    slug,
                    project_id,
                    "/api/product/incidents",
                    {
                        "action": "enrollment",
                        "operation_id": operation,
                        "reason": "manual",
                        # Receipt time is server-observed, never accepted from the device.
                        "occurred_at": receipt["occurred_at"],
                        "elapsed_ms": min(receipt["duration_ms"], 86_400_000),
                        "share": False,
                    },
                    role=role,
                )
                if status < 400:
                    identity = value.get("incident", {}).get("id")
                    if not isinstance(identity, str) or not re.fullmatch(r"[a-f0-9]{32}", identity):
                        raise ValueError("Invalid enrollment incident.")
                    cache.set(
                        status_key,
                        {
                            "workspace": slug,
                            "project": project_id,
                            "role": role,
                            "incident_id": identity,
                        },
                        timeout=86_400,
                    )
            return Response(
                value if status < 400 else {"error": "Enrollment reporting is unavailable."},
                status=status,
                headers=private,
            )
        except (OSError, ValueError, TypeError, KeyError, RecursionError, requests.RequestException):
            return Response({"error": "Enrollment reporting is temporarily unavailable."}, status=503, headers=private)


def ui_outcome(ui):
    if ui["result"] == "failed":
        return "error"
    return "ok" if ui["result"] in ("confirmed", "pending-approval") else "unknown"
