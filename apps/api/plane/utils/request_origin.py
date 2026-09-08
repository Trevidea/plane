from urllib.parse import urlparse

from django.conf import settings


TRUE_VALUES = {"1", "true", "yes", "on"}


def dynamic_app_base_url_enabled() -> bool:
    value = getattr(settings, "DYNAMIC_APP_BASE_URL_FROM_REQUEST", False)
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in TRUE_VALUES


def trusted_request_origins() -> set[str]:
    origins = set(getattr(settings, "CORS_ALLOWED_ORIGINS", []) or [])
    origins.update(getattr(settings, "CSRF_TRUSTED_ORIGINS", []) or [])
    return {origin.rstrip("/") for origin in origins if isinstance(origin, str) and origin}


def trusted_request_origin_hosts() -> list[str]:
    hosts = []
    for origin in trusted_request_origins():
        parsed_origin = urlparse(origin)
        if parsed_origin.netloc:
            hosts.append(parsed_origin.netloc)
    return hosts


def request_origin(request) -> str | None:
    if not dynamic_app_base_url_enabled():
        return None

    origin = request.META.get("HTTP_ORIGIN")

    if not origin:
        referer = request.META.get("HTTP_REFERER")
        if referer:
            parsed_referer = urlparse(referer)
            if parsed_referer.scheme and parsed_referer.netloc:
                origin = f"{parsed_referer.scheme}://{parsed_referer.netloc}"

    if not origin:
        return None

    normalized_origin = origin.rstrip("/")
    if normalized_origin in trusted_request_origins():
        return normalized_origin

    return None
