"""CSRF-protected player recovery; no session creation or SMTP."""

import json

from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.http import JsonResponse
from django.views import View
from django.views.decorators.debug import sensitive_post_parameters, sensitive_variables
from django.utils.decorators import method_decorator

from plane.authentication.views.player_invitation import private
from plane.authentication.views.player_registration import limited
from plane.utils.diagnostic_logging import emit
from plane.utils.player_password_reset import redeem_player_reset


@method_decorator(sensitive_post_parameters(), name="dispatch")
class PlayerPasswordResetEndpoint(View):
    @sensitive_variables("values", "email", "code", "password", "confirm")
    def post(self, request):
        if limited(request, "reset-network", 120):
            return private(JsonResponse({"code": "reset_throttled"}, status=429))
        try:
            if request.content_type != "application/json" or len(request.body) > 4096:
                raise ValueError()
            values = json.loads(request.body)
            if (
                not isinstance(values, dict)
                or set(values) != {"email", "code", "password", "password_confirm"}
                or not all(isinstance(value, str) for value in values.values())
            ):
                raise ValueError()
            email = values["email"].strip().lower()
            code, password, confirm = values["code"], values["password"], values["password_confirm"]
            if len(email) > 254 or not 1 <= len(code) <= 32 or not 1 <= len(password) <= 128 or len(confirm) > 128:
                raise ValueError()
            validate_email(email)
        except (ValidationError, ValueError, RecursionError):
            return private(JsonResponse({"code": "reset_unavailable"}, status=400))
        if limited(request, "reset-account", 8, email):
            return private(JsonResponse({"code": "reset_throttled"}, status=429))
        if password != confirm:
            return private(JsonResponse({"code": "password_mismatch"}, status=400))
        result = redeem_player_reset(email, code, password, request=request)
        if result == "reset":
            emit("player.password_reset.completed")
            return private(JsonResponse({"reset": True}))
        emit("player.password_reset.rejected", outcome="error", fields={"error_code": result})
        return private(JsonResponse({"code": result}, status=400))
