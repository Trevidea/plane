"""Environment-level outgoing mail switch, including instance-configured SMTP."""

import os


def configured_email_backend(default_backend):
    enabled = os.environ.get("ENABLE_SMTP", "1").strip().lower() in {"1", "true", "yes", "on"}
    if not enabled:
        return "django.core.mail.backends.dummy.EmailBackend"
    return os.environ.get("EMAIL_BACKEND", default_backend)
