"""CSRF-protected shared QR enrollment, using Plane's existing cookie session."""

import hashlib
import json
from uuid import UUID

from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.db import IntegrityError
from django.http import JsonResponse
from django.shortcuts import render
from django.views import View

from plane.authentication.adapter.error import AuthenticationException, AUTHENTICATION_ERROR_CODES
from plane.authentication.views.player_invitation import private
from plane.utils.player_registration import (
    InvalidRegistration,
    RegistrationAccountExists,
    InvalidRegistrationToken,
    WeakRegistrationPassword,
    accept_registration,
    registration_session,
    registration_session_for_code,
    registration_ticket,
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
                    "Registration unavailable. Check your details or ask your coach for a new QR or team code."
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
            "This registration is expired, replaced or unavailable. "
            "Ask your coach for a new QR or team code."
        ),
        "signup_disabled": "New account signup is disabled on this server. Contact your school administrator.",
    }
    return private(JsonResponse({"code": code, "detail": messages[code]}, status=400))


class PlayerRegistrationPreviewEndpoint(View):
    def post(self, request):
        if limited(request, "preview", 300):
            return unavailable(429)
        try:
            if len(request.body) > 4096:
                raise InvalidRegistration()
            payload = json.loads(request.body)
            if not isinstance(payload, dict):
                raise InvalidRegistration()
            if set(payload) == {"code"}:
                session = registration_session_for_code(payload["code"])
                details = session_details(session, user=request.user)
                details["token"] = registration_ticket(session)
                return private(JsonResponse(details))
            if "token" not in payload or set(payload) - {"token", "roster_offset", "roster_search"}:
                raise InvalidRegistration()
            offset, search = payload.get("roster_offset", 0), payload.get("roster_search", "")
            if (
                type(offset) is not int or not 0 <= offset <= 100000
                or not isinstance(search, str) or len(search) > 100
            ):
                raise InvalidRegistration()
            details = session_details(
                registration_session(payload["token"]), user=request.user,
                roster_offset=offset, roster_search=search.strip()
            )
            return private(JsonResponse(details))
        except (InvalidRegistration, ValueError, TypeError):
            return unavailable()


class PlayerRegistrationLandingEndpoint(View):
    def get(self, request):
        try:
            details = session_details(registration_session(request.GET.get("token", "")))
            return private(render(request, "emails/invitations/player_registration.html", {"registration": details}))
        except InvalidRegistration:
            return private(
                render(request, "emails/invitations/player_registration.html", {"expired": True}, status=400)
            )


class PlayerRegistrationAcceptEndpoint(View):
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
            return private(JsonResponse({"accepted": True, "user_id": str(user.id)}))
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
