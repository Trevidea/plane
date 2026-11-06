"""Player onboarding keeps Django's existing CSRF-protected cookie session."""

import json
import secrets

from django.core.exceptions import ValidationError
from django.db import IntegrityError
from django.http import JsonResponse
from django.shortcuts import render
from django.views import View

from plane.authentication.adapter.error import AuthenticationException
from plane.license.utils.instance_value import get_configuration_value
from plane.utils.player_invitations import (
    InvalidPlayerInvitation,
    accept_player_ticket,
    player_app_url,
    preview_player_ticket,
)


def private(response, script_nonce=None):
    response["Cache-Control"] = "private, no-store"
    response["Referrer-Policy"] = "no-referrer"
    if response.get("Content-Type", "").startswith("text/html"):
        response["Referrer-Policy"] = "same-origin"
        script_policy = f"script-src 'nonce-{script_nonce}'; connect-src 'self'; " if script_nonce else ""
        response["Content-Security-Policy"] = (
            script_policy + "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; "
            "base-uri 'none'; frame-ancestors 'none'"
        )
    return response


class PlayerInvitationPreviewEndpoint(View):
    def post(self, request):
        try:
            payload = json.loads(request.body)
            if not isinstance(payload, dict) or set(payload) != {"token"}:
                raise InvalidPlayerInvitation()
            return private(JsonResponse(preview_player_ticket(payload["token"])))
        except (InvalidPlayerInvitation, ValueError, TypeError):
            return private(JsonResponse({"detail": "Invitation unavailable or expired."}, status=400))


class PlayerInvitationLandingEndpoint(View):
    def get(self, request):
        token = request.GET.get("token", "")
        try:
            details = preview_player_ticket(token)
            if request.user.is_authenticated and request.user.email.lower() != details["email"].lower():
                return private(
                    render(
                        request,
                        "emails/invitations/player_onboarding.html",
                        {
                            "error": (
                                "You are signed in with a different account. Open this invitation in a private "
                                "browser window, or sign out of Plane first, then reopen the invitation "
                                "to continue with your invited email."
                            )
                        },
                        status=400,
                    )
                )
            script_nonce = secrets.token_urlsafe(24)
            return private(
                render(
                    request,
                    "emails/invitations/player_onboarding.html",
                    {
                        "script_nonce": script_nonce,
                        "invitation": details,
                        "token": token,
                        "app_url": player_app_url(token),
                    },
                ),
                script_nonce=script_nonce,
            )
        except InvalidPlayerInvitation:
            return private(
                render(
                    request,
                    "emails/invitations/player_onboarding.html",
                    {
                        "error": "Invitation unavailable or expired. Ask your coach for a new invitation.",
                    },
                    status=400,
                )
            )


class PlayerInvitationAcceptEndpoint(View):
    def post(self, request):
        try:
            values = request.POST
            if set(values) - {"token", "name", "password", "csrfmiddlewaretoken", "browser", "password_confirm"}:
                raise InvalidPlayerInvitation()
            token, name, password = values.get("token", ""), values.get("name", ""), values.get("password", "")
            if not password or len(password) > 128 or len(name) > 150:
                raise InvalidPlayerInvitation()
            (enabled,) = get_configuration_value([{"key": "ENABLE_EMAIL_PASSWORD", "default": "1"}])
            if enabled == "0":
                raise InvalidPlayerInvitation()
            if (
                values.get("browser")
                and not preview_player_ticket(token)["account_exists"]
                and password != values.get("password_confirm")
            ):
                raise InvalidPlayerInvitation()
            user = accept_player_ticket(request, token, name, password)
            if values.get("browser"):
                return private(render(request, "emails/invitations/player_onboarding.html", {"completed": True}))
            return private(JsonResponse({"accepted": True, "user_id": str(user.id)}))
        except (InvalidPlayerInvitation, AuthenticationException, ValidationError, IntegrityError):
            return private(
                JsonResponse(
                    {"detail": "Invitation acceptance failed. Check the invitation and your password."}, status=400
                )
            )
