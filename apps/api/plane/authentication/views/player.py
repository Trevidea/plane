import hashlib
from collections.abc import Mapping

from django.conf import settings
from django.contrib.auth import authenticate, logout
from django.middleware.csrf import get_token
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import csrf_protect
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView

from plane.authentication.session import BaseSessionAuthentication
from plane.authentication.utils.login import user_login
from plane.license.models import Instance
from plane.license.utils.instance_value import get_configuration_value
from plane.utils.player_access import player_roster_queryset


class PlayerCredentialsSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=254)
    password = serializers.CharField(max_length=1024, trim_whitespace=False, write_only=True)


class PlayerSignInIPThrottle(SimpleRateThrottle):
    scope = "player-sign-in-ip"

    def get_rate(self):
        return settings.PLAYER_SIGN_IN_IP_RATE

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": request.META.get("REMOTE_ADDR", "unknown")}


class PlayerSignInAccountThrottle(SimpleRateThrottle):
    scope = "player-sign-in-account"

    def get_rate(self):
        return settings.PLAYER_SIGN_IN_ACCOUNT_RATE

    def get_cache_key(self, request, view):
        email = request.data.get("email") if isinstance(request.data, Mapping) else None
        if not isinstance(email, str):
            return None
        identity = hashlib.sha256(email.strip().lower().encode()).hexdigest()
        return self.cache_format % {"scope": self.scope, "ident": identity}


def _session_payload(request):
    user = request.user
    authenticated = user.is_authenticated and user.is_active
    return {
        "is_authenticated": authenticated,
        "user": {"id": str(user.id), "display_name": user.display_name or user.first_name or "Player"}
        if authenticated
        else None,
        "csrf_token": get_token(request),
    }


@method_decorator(never_cache, name="dispatch")
class PlayerSessionEndpoint(APIView):
    permission_classes = [AllowAny]
    authentication_classes = [BaseSessionAuthentication]

    def get(self, request):
        return Response(_session_payload(request))


@method_decorator(never_cache, name="dispatch")
@method_decorator(csrf_protect, name="dispatch")
class PlayerSignInEndpoint(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [PlayerSignInIPThrottle, PlayerSignInAccountThrottle]

    def post(self, request):
        credentials = PlayerCredentialsSerializer(data=request.data)
        credentials.is_valid(raise_exception=True)
        instance = Instance.objects.first()
        if instance is None or not instance.is_setup_done:
            return Response({"code": "instance_not_ready"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        (enabled,) = get_configuration_value([{"key": "ENABLE_EMAIL_PASSWORD", "default": "1"}])
        if enabled == "0":
            return Response({"code": "password_login_disabled"}, status=status.HTTP_403_FORBIDDEN)
        user = authenticate(
            request=request,
            username=credentials.validated_data["email"].strip().lower(),
            password=credentials.validated_data["password"],
        )
        if user is None:
            return Response({"code": "invalid_credentials"}, status=status.HTTP_401_UNAUTHORIZED)
        if not player_roster_queryset(user).exists():
            return Response({"code": "player_access_required"}, status=status.HTTP_403_FORBIDDEN)
        user.last_login_medium = "email"
        user.last_active = timezone.now()
        user.save(update_fields=["last_login_medium", "last_active"])
        user_login(request=request, user=user, is_app=True)
        request.user = user
        return Response(_session_payload(request))


@method_decorator(never_cache, name="dispatch")
@method_decorator(csrf_protect, name="dispatch")
class PlayerSignOutEndpoint(APIView):
    permission_classes = [AllowAny]
    authentication_classes = [BaseSessionAuthentication]

    def post(self, request):
        logout(request)
        return Response({"success": True})
