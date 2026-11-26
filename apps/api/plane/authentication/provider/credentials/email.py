# Python imports
import os

from django.db import transaction

# Module imports
from plane.authentication.adapter.credential import CredentialAdapter
from plane.db.models import User
from plane.authentication.adapter.error import (
    AUTHENTICATION_ERROR_CODES,
    AuthenticationException,
)
from plane.license.utils.instance_value import get_configuration_value


class EmailProvider(CredentialAdapter):
    provider = "email"

    def __init__(self, request, key=None, code=None, is_signup=False, callback=None):
        super().__init__(request=request, provider=self.provider, callback=callback)
        self.key = key
        self.code = code
        self.is_signup = is_signup
        self.verified_user = None

        (ENABLE_EMAIL_PASSWORD,) = get_configuration_value(
            [
                {
                    "key": "ENABLE_EMAIL_PASSWORD",
                    "default": os.environ.get("ENABLE_EMAIL_PASSWORD"),
                }
            ]
        )

        if ENABLE_EMAIL_PASSWORD == "0":
            raise AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["EMAIL_PASSWORD_AUTHENTICATION_DISABLED"],
                error_message="EMAIL_PASSWORD_AUTHENTICATION_DISABLED",
            )

    def authenticate(self):
        self.set_user_data()
        verified = self.verified_user
        if verified is not None and not User.objects.filter(
            pk=verified.pk, email=verified.email, password=verified.password
        ).exists():
            self._invalid_password()
        # The authenticated session must use exactly the password hash that was verified.
        return self.complete_login_or_signup(verified_user=verified)

    def _invalid_password(self):
        error = "AUTHENTICATION_FAILED_SIGN_UP" if self.is_signup else "AUTHENTICATION_FAILED_SIGN_IN"
        raise AuthenticationException(
            error_message=error,
            error_code=AUTHENTICATION_ERROR_CODES[error],
            payload={"email": self.key},
        )

    @transaction.atomic
    def set_user_data(self):
        if self.is_signup:
            # Check if the user already exists
            if User.objects.filter(email=self.key).exists():
                raise AuthenticationException(
                    error_message="USER_ALREADY_EXIST",
                    error_code=AUTHENTICATION_ERROR_CODES["USER_ALREADY_EXIST"],
                )

            super().set_user_data(
                {
                    "email": self.key,
                    "user": {
                        "avatar": "",
                        "first_name": "",
                        "last_name": "",
                        "provider_id": "",
                        "is_password_autoset": False,
                    },
                }
            )
            return
        else:
            user = User.objects.select_for_update().filter(email=self.key).first()

            # User does not exists
            if not user:
                raise AuthenticationException(
                    error_message="USER_DOES_NOT_EXIST",
                    error_code=AUTHENTICATION_ERROR_CODES["USER_DOES_NOT_EXIST"],
                    payload={"email": self.key},
                )

            # Check user password
            if not user.check_password(self.code):
                self._invalid_password()
            self.verified_user = user

            super().set_user_data(
                {
                    "email": self.key,
                    "user": {
                        "avatar": "",
                        "first_name": "",
                        "last_name": "",
                        "provider_id": "",
                        "is_password_autoset": False,
                    },
                }
            )
            return
