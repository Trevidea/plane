"""Expiring player tickets backed by existing workspace invitations."""

from datetime import timedelta
from urllib.parse import urlencode, urlsplit

from django.conf import settings
from django.core import signing
from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import F
from django.utils import timezone

from plane.db.models import (
    Project,
    ProjectMember,
    RosterPlayer,
    User,
    Workspace,
    WorkspaceMember,
    WorkspaceMemberInvite,
)

SALT = "plane.player-invitation.v1"
MAX_AGE = 7 * 24 * 60 * 60


class InvalidPlayerInvitation(ValueError):
    pass


def public_player_api_origin():
    value = getattr(settings, "PLAYER_APP_API_URL", "") or settings.WEB_URL
    parsed = urlsplit(value)
    if (
        parsed.scheme not in ("https", "http")
        or not parsed.netloc
        or parsed.username
        or parsed.password
        or parsed.path not in ("", "/")
        or parsed.query
        or parsed.fragment
    ):
        raise InvalidPlayerInvitation("Configure a public PLAYER_APP_API_URL origin.")
    return value.rstrip("/")


def create_player_ticket(invitation):
    return signing.dumps(
        {
            "id": str(invitation.id),
            "nonce": invitation.token,
            "email": invitation.email.strip().lower(),
            "expires": int((timezone.now() + timedelta(seconds=MAX_AGE)).timestamp()),
        },
        salt=SALT,
    )


def ticket_data(token):
    if not isinstance(token, str) or not 43 <= len(token) <= 2048:
        raise InvalidPlayerInvitation("Invitation unavailable or expired.")
    try:
        data = signing.loads(token, salt=SALT, max_age=MAX_AGE)
        if not isinstance(data, dict) or data["expires"] <= timezone.now().timestamp():
            raise ValueError()
        return data
    except (signing.BadSignature, ValueError, KeyError, TypeError):
        raise InvalidPlayerInvitation("Invitation unavailable or expired.") from None


def invitation_roster(invitation):
    return RosterPlayer.objects.filter(
        workspace_id=invitation.workspace_id,
        workspace_id__exact=F("project__workspace_id"),
        email__iexact=invitation.email,
        status__in=("active", "injured"),
        project__deleted_at__isnull=True,
        project__archived_at__isnull=True,
        project__workspace__deleted_at__isnull=True,
    ).select_related("project")


def validated_invitation(token):
    data = ticket_data(token)
    try:
        invite = WorkspaceMemberInvite.objects.select_related("workspace").get(
            pk=data["id"],
            token=data["nonce"],
            email__iexact=data["email"],
            role=1,
            accepted=False,
            responded_at__isnull=True,
            workspace__deleted_at__isnull=True,
        )
    except (WorkspaceMemberInvite.DoesNotExist, ValidationError, ValueError, KeyError, TypeError):
        raise InvalidPlayerInvitation("Invitation unavailable or expired.") from None
    players = list(invitation_roster(invite).order_by("project__name", "id"))
    if not players:
        raise InvalidPlayerInvitation("Invitation unavailable or expired.")
    existing = User.objects.filter(email__iexact=invite.email).first()
    if any(player.user_id and (not existing or player.user_id != existing.id) for player in players):
        raise InvalidPlayerInvitation("Invitation unavailable or expired.")
    return invite, players, data


def preview_player_ticket(token):
    invite, players, data = validated_invitation(token)
    program_label = ", ".join(dict.fromkeys(player.project.name for player in players))
    if len(program_label) > 255:
        program_label = program_label[:254] + "…"
    return {
        "email": invite.email.strip().lower(),
        "player_name": players[0].player_name,
        "program_name": program_label,
        "expires_at": timezone.datetime.fromtimestamp(data["expires"], tz=timezone.get_fixed_timezone(0)).isoformat(),
        "account_exists": User.objects.filter(email__iexact=invite.email).exists(),
    }


def player_invitation_url(invitation):
    return (
        public_player_api_origin()
        + "/auth/player-invitation/?"
        + urlencode({"token": create_player_ticket(invitation)})
    )


def player_app_url(token):
    return "kanavioplayerapp://signup?" + urlencode({"token": token, "server": public_player_api_origin()})


@transaction.atomic
def accept_player_ticket(request, token, name, password):
    from plane.authentication.provider.credentials.email import EmailProvider
    from plane.authentication.utils.login import user_login

    # Same workspace-first lock order as imports, linking, and member removal.
    invite, _, _ = validated_invitation(token)
    Workspace.objects.select_for_update().get(pk=invite.workspace_id)
    invite = WorkspaceMemberInvite.objects.select_for_update().get(pk=invite.pk)
    invite, players, _ = validated_invitation(token)
    list(Project.objects.select_for_update().filter(pk__in=[p.project_id for p in players]).order_by("id"))
    players = list(invitation_roster(invite).select_for_update(of=("self",)).order_by("id"))
    if not players:
        raise InvalidPlayerInvitation("Invitation unavailable or expired.")
    email = invite.email.strip().lower()
    if request.user.is_authenticated and request.user.email.lower() != email:
        raise InvalidPlayerInvitation("Sign in with the invited email address.")
    existing = User.objects.filter(email__iexact=email).first()
    if existing and (not existing.is_active or existing.is_bot or not existing.check_password(password)):
        raise InvalidPlayerInvitation("Sign in with the invited account password.")
    if any(player.user_id and (not existing or player.user_id != existing.id) for player in players):
        raise InvalidPlayerInvitation("Invitation unavailable or expired.")
    user = EmailProvider(
        request=request, key=existing.email if existing else email, code=password, is_signup=existing is None
    ).authenticate()
    if not existing:
        user.first_name = name.strip()
        user.display_name = name.strip()
        user.is_email_verified = True
        user.save()
    membership, _ = WorkspaceMember.objects.get_or_create(
        workspace_id=invite.workspace_id, member=user, defaults={"role": 1}
    )
    if not membership.is_active:
        membership.is_active = True
        membership.role = 1
        membership.save(update_fields=["is_active", "role"])
    for player in players:
        if RosterPlayer.objects.filter(project_id=player.project_id, user=user).exclude(pk=player.pk).exists():
            raise InvalidPlayerInvitation("Account already linked to another player in this program.")
        player.user = user
        player.save(update_fields=["user"])
        program_member, _ = ProjectMember.objects.get_or_create(
            project_id=player.project_id, member=user, defaults={"role": 1}
        )
        if not program_member.is_active:
            program_member.is_active = True
            program_member.role = 1
            program_member.save(update_fields=["is_active", "role"])
    invite.accepted = True
    invite.responded_at = timezone.now()
    invite.save(update_fields=["accepted", "responded_at"])
    user_login(request, user, is_app=True)
    return user
