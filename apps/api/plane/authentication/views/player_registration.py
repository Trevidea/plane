"""CSRF-protected shared QR enrollment, using Plane's existing cookie session."""

import hashlib
import json
import secrets
from uuid import UUID

from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.db import IntegrityError
from django.http import JsonResponse
from django.shortcuts import render
from django.utils.decorators import method_decorator
from django.views import View
from django.views.decorators.debug import sensitive_post_parameters, sensitive_variables

from plane.authentication.adapter.error import AuthenticationException, AUTHENTICATION_ERROR_CODES
from plane.authentication.views.player_invitation import private
from plane.utils.enrollment_reports import bind_project
from plane.utils.player_registration import (
    InvalidRegistration,
    RegistrationAccountExists,
    InvalidRegistrationToken,
    WeakRegistrationPassword,
    accept_registration,
    exchange_registration_code,
    registration_handoff,
    registration_session,
    session_details,
)


def limited(request, action, limit, identity=None):
    # Do not trust caller-controlled forwarded-IP headers or store ticket/email values.
    address = identity if identity is not None else request.META.get("REMOTE_ADDR", "unknown")
    key = "player-registration:" + action + ":" + hashlib.sha256(address.encode()).hexdigest()
    if cache.add(key, 1, timeout=60):
        return False
    try:
        return cache.incr(key) > limit
    except ValueError:
        return False


def unavailable(status=400):
    return private(
        JsonResponse(
            {
                "detail": (
                    "Registration unavailable. Check your details or ask your coach for a new QR or email invitation."
                )
            },
            status=status,
        )
    )


def registration_error(code):
    messages = {
        "weak_password": (
            "Use a longer, less predictable password. Try several unrelated words; "
            "avoid your name, email and simple sequences."
        ),
        "password_mismatch": "Your passwords do not match. Enter the same password in both fields.",
        "registration_unavailable": (
            "This team invitation is expired, replaced or unavailable. "
            "Ask your coach for a new link or code."
        ),
        "signup_disabled": "New account signup is disabled on this server. Contact your school administrator.",
    }
    return private(JsonResponse({"code": code, "detail": messages[code]}, status=400))


@method_decorator(sensitive_post_parameters(), name="dispatch")
class PlayerRegistrationPreviewEndpoint(View):
    @sensitive_variables()
    def post(self, request):
        try:
            if len(request.body) > 4096:
                raise InvalidRegistration()
            payload = json.loads(request.body)
            if isinstance(payload, dict) and set(payload) == {"code"}:
                request._roster_code_lookup = True
                if limited(request, "code-network", 100) or limited(request, "code-installation", 1000, "all"):
                    return unavailable(429)
                return private(JsonResponse({"token": exchange_registration_code(payload["code"], request)}))
            if limited(request, "preview", 300):
                return unavailable(429)
            if (
                not isinstance(payload, dict) or "token" not in payload
                or set(payload) - {"token", "roster_offset", "roster_search"}
            ):
                raise InvalidRegistration()
            offset, search = payload.get("roster_offset", 0), payload.get("roster_search", "")
            if (
                type(offset) is not int or not 0 <= offset <= 100000
                or not isinstance(search, str) or len(search) > 100
            ):
                raise InvalidRegistration()
            session = registration_session(payload["token"])
            bind_project(request, session.workspace.slug, session.project_id)
            details = session_details(
                session, user=request.user,
                roster_offset=offset, roster_search=search.strip()
            )
            return private(JsonResponse(details))
        except (InvalidRegistration, ValueError, TypeError):
            return unavailable()


@method_decorator(sensitive_post_parameters(), name="dispatch")
class PlayerRegistrationLandingEndpoint(View):
    @sensitive_variables()
    def get(self, request):
        tokens = request.GET.getlist("token")
        if not request.GET:
            nonce = secrets.token_urlsafe(24)
            return self.render_page(request, {"script_nonce": nonce}, script_nonce=nonce)
        return self.confirm(request, tokens[0] if len(tokens) == 1 else "")

    @sensitive_variables()
    def post(self, request):
        if limited(request, "landing", 300):
            return self.render_page(request, {"expired": True}, status=429)
        if request.content_type != "application/x-www-form-urlencoded" or len(request.body) > 4096:
            return self.render_page(request, {"expired": True}, status=400)
        values = request.POST
        tokens = values.getlist("token")
        return self.confirm(request, tokens[0] if len(tokens) == 1 else "")

    @staticmethod
    def render_page(request, context, *, status=200, script_nonce=None):
        response = private(
            render(request, "emails/invitations/player_registration.html", context, status=status),
            script_nonce=script_nonce,
        )
        if not script_nonce:
            response["Referrer-Policy"] = "no-referrer"
        return response

    @sensitive_variables()
    def confirm(self, request, token):
        try:
            details = session_details(registration_session(token))
            return self.render_page(request, {"registration": details, **registration_handoff(token)})
        except InvalidRegistration:
            return self.render_page(request, {"expired": True}, status=400)


@method_decorator(sensitive_post_parameters(), name="dispatch")
class PlayerRegistrationAcceptEndpoint(View):
    @sensitive_variables()
    def post(self, request):
        # School NATs, reverse proxies and the browser gateway share REMOTE_ADDR.
        # Keep a generous network ceiling plus a separate per-account attempt limit.
        if limited(request, "accept-network", 300):
            return unavailable(429)
        try:
            if len(request.body) > 8192:
                raise InvalidRegistration()
            values = request.POST
            allowed = {
                "token", "name", "email", "password", "password_confirm", "mode",
                "csrfmiddlewaretoken", "roster_player_id", "account_only",
            }
            if set(values) - allowed or any(len(values.getlist(key)) != 1 for key in values):
                raise InvalidRegistration()
            if limited(request, "accept-account", 10, identity=values.get("email", "").strip().lower()):
                return unavailable(429)
            if values.get("mode") == "signup" and values.get("password") != values.get("password_confirm"):
                return registration_error("password_mismatch")
            player_id = values.get("roster_player_id", "")
            if player_id:
                UUID(player_id)
            if "account_only" in values and values["account_only"] != "1":
                raise InvalidRegistration()
            user = accept_registration(
                request, roster_player_id=player_id, account_only=values.get("account_only") == "1",
                **{key: values.get(key, "") for key in ("token", "name", "email", "password", "mode")}
            )
            return private(JsonResponse({
                "accepted": True, "user_id": str(user.id),
                "registration_state": getattr(request, "_roster_registration_state", None),
            }))
        except RegistrationAccountExists:
            return private(
                JsonResponse(
                    {
                        "code": "account_exists",
                        "detail": "An account with this email already exists. Please sign in.",
                    },
                    status=409,
                )
            )
        except WeakRegistrationPassword:
            return registration_error("weak_password")
        except InvalidRegistrationToken:
            return registration_error("registration_unavailable")
        except AuthenticationException as error:
            if error.error_code == AUTHENTICATION_ERROR_CODES["INVALID_PASSWORD"]:
                return registration_error("weak_password")
            if error.error_code == AUTHENTICATION_ERROR_CODES["SIGNUP_DISABLED"]:
                return registration_error("signup_disabled")
            return unavailable()
        except (InvalidRegistration, ValidationError, IntegrityError, ValueError):
            return unavailable()
