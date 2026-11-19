"""SMTP environment switch never opens a mail connection when disabled."""

import os
from unittest.mock import patch

from django.core.mail import EmailMessage, get_connection
from django.test import SimpleTestCase

from plane.settings.email import configured_email_backend


class EmailEnvironmentTests(SimpleTestCase):
    def test_disabled_smtp_drops_mail_without_connecting_even_with_smtp_backend_configured(self):
        with patch.dict(
            os.environ, {"ENABLE_SMTP": "0", "EMAIL_BACKEND": "django.core.mail.backends.smtp.EmailBackend"}
        ):
            connection = get_connection(
                backend=configured_email_backend("django.core.mail.backends.smtp.EmailBackend"),
                host="smtp.fixture.test",
            )
            with patch("smtplib.SMTP") as smtp, patch("smtplib.SMTP_SSL") as smtp_ssl:
                EmailMessage(
                    "Fixture", "Fixture", "coach@fixture.test", ["athlete@fixture.test"], connection=connection
                ).send()
            smtp.assert_not_called()
            smtp_ssl.assert_not_called()

    def test_enabled_smtp_uses_the_configured_backend(self):
        with patch.dict(
            os.environ, {"ENABLE_SMTP": "1", "EMAIL_BACKEND": "django.core.mail.backends.smtp.EmailBackend"}
        ):
            connection = get_connection(
                backend=configured_email_backend("django.core.mail.backends.console.EmailBackend"),
                host="smtp.fixture.test",
                use_tls=False,
                use_ssl=False,
            )
            with patch("smtplib.SMTP") as smtp:
                EmailMessage(
                    "Fixture", "Fixture", "coach@fixture.test", ["athlete@fixture.test"], connection=connection
                ).send()
            smtp.assert_called_once()

    def test_missing_switch_preserves_the_default_backend(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(
                configured_email_backend("django.core.mail.backends.console.EmailBackend"),
                "django.core.mail.backends.console.EmailBackend",
            )

    def test_false_values_override_a_custom_email_backend(self):
        for value in ("0", "false", "off", "no"):
            with (
                self.subTest(value=value),
                patch.dict(
                    os.environ,
                    {"ENABLE_SMTP": value, "EMAIL_BACKEND": "django.core.mail.backends.console.EmailBackend"},
                ),
            ):
                self.assertEqual(
                    configured_email_backend("django.core.mail.backends.smtp.EmailBackend"),
                    "django.core.mail.backends.dummy.EmailBackend",
                )
