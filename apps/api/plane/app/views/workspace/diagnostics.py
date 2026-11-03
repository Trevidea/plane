import base64
import hashlib
import hmac
import ipaddress
import json
import os
import re
import stat
import time
from urllib.parse import urlsplit
from uuid import uuid4

import requests
from django.conf import settings
from django.utils.cache import patch_vary_headers
from rest_framework.response import Response

from plane.app.permissions import ROLE, allow_permission
from plane.app.views.base import BaseAPIView


MAX_RESPONSE_BYTES = 512 * 1024
OVERVIEW_PATH = "/api/product/overview"


def _bridge_key(path=None):
    path = path or settings.CUSTOMER_DIAGNOSTICS_BRIDGE_KEY_FILE
    if not path or not os.path.isabs(path):
        raise ValueError("Invalid bridge configuration")
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as source:
        info = os.fstat(source.fileno())
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_nlink != 1
            or info.st_mode & 0o077
            or info.st_uid != os.geteuid()
            or info.st_size > 256
        ):
            raise ValueError("Invalid bridge credential file")
        key = source.read(257).decode("ascii").strip()
    if not re.fullmatch(r"[A-Za-z0-9_-]{43,128}", key):
        raise ValueError("Invalid bridge credential")
    return key


def _bridge_origin():
    origin = settings.CUSTOMER_DIAGNOSTICS_URL
    parsed = urlsplit(origin)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("Invalid diagnostics origin")
    if parsed.port is not None and not 0 < parsed.port < 65536:
        raise ValueError("Invalid diagnostics port")
    if parsed.scheme == "http":
        private = parsed.hostname in {
            "localhost",
            "plane-coach",
            "customer-diagnostics",
            "kanavio-customer-diagnostics",
        }
        try:
            address = ipaddress.ip_address(parsed.hostname)
            private = (
                address.is_loopback
                or address.is_private
                and not (address.is_link_local or address.is_unspecified or address.is_multicast or address.is_reserved)
            )
        except ValueError:
            pass
        if not private:
            raise ValueError("Plain HTTP requires an explicit local service origin")
    return origin.rstrip("/")


def _invalid_number(value):
    raise ValueError("Nonfinite diagnostics data")


def read_diagnostics_overview(user_id, workspace):
    origin, key = _bridge_origin(), _bridge_key()
    identity_path = settings.CUSTOMER_DIAGNOSTICS_IDENTITY_KEY_FILE
    actor_key = _bridge_key(identity_path) if identity_path else key
    principal = {
        "workspace": workspace,
        "project": None,
        "actor": hmac.new(actor_key.encode(), f"product-actor:{user_id}".encode(), hashlib.sha256).hexdigest(),
        "role": "admin",
    }
    claims = base64.urlsafe_b64encode(json.dumps(principal, separators=(",", ":")).encode()).decode().rstrip("=")
    stamp, nonce = str(int(time.time())), uuid4().hex
    message = "\n".join(["GET", OVERVIEW_PATH, stamp, nonce, claims, hashlib.sha256(b"").hexdigest()])
    headers = {
        "Accept": "application/json",
        "X-Kanavio-Product-Time": stamp,
        "X-Kanavio-Product-Nonce": nonce,
        "X-Kanavio-Product-Claims": claims,
        "X-Kanavio-Product-Signature": hmac.new(key.encode(), message.encode(), hashlib.sha256).hexdigest(),
    }
    # Only the compact product overview is readable; user cookies and arbitrary URLs never cross this boundary.
    with requests.Session() as session:
        session.trust_env = False
        deadline = time.monotonic() + 10
        with session.get(
            origin + OVERVIEW_PATH, headers=headers, timeout=(2, 5), allow_redirects=False, stream=True
        ) as upstream:
            if (
                upstream.status_code != 200
                or upstream.headers.get("Content-Type", "").split(";")[0] != "application/json"
            ):
                raise ValueError("Diagnostics overview unavailable")
            body = bytearray()
            for chunk in upstream.iter_content(chunk_size=4096):
                body.extend(chunk)
                if len(body) > MAX_RESPONSE_BYTES or time.monotonic() > deadline:
                    raise ValueError("Diagnostics overview exceeds limits")
    value = json.loads(body, parse_constant=_invalid_number)
    if (
        not isinstance(value, dict)
        or value.get("version") != 1
        or not isinstance(value.get("current"), dict)
        or not isinstance(value.get("automation"), dict)
        or not isinstance(value.get("runs"), list)
        or not isinstance(value.get("incidents"), list)
        or len(value["runs"]) > 20
        or len(value["incidents"]) > 50
    ):
        raise ValueError("Invalid diagnostics overview")
    return value


class WorkspaceDiagnosticsEndpoint(BaseAPIView):
    http_method_names = ["get", "head", "options"]

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "private, no-store"
        patch_vary_headers(response, ["Cookie"])
        return response

    @allow_permission([ROLE.ADMIN], level="WORKSPACE")
    def get(self, request, slug):
        if request.query_params:
            return Response({"error": "This endpoint only reads the installation overview."}, status=400)
        if not settings.CUSTOMER_DIAGNOSTICS_ENABLED:
            return Response({"version": 1, "enabled": False})
        if slug != settings.CUSTOMER_DIAGNOSTICS_WORKSPACE:
            return Response({"error": "Diagnostics is not enabled for this workspace."}, status=403)
        try:
            return Response(read_diagnostics_overview(request.user.id, slug))
        except (OSError, ValueError, RecursionError, requests.RequestException):
            return Response(
                {
                    "error": "Diagnostics is temporarily unavailable. Please try again later.",
                    "code": "DIAGNOSTICS_UNAVAILABLE",
                },
                status=503,
            )
