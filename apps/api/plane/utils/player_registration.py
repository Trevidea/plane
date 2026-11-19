"""Shared QR tickets grant enrollment in exactly one active program."""

from datetime import timedelta
from urllib.parse import urlencode

from django.core import signing
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.contrib.auth.password_validation import validate_password
from django.db import transaction
from django.db.models import Exists, OuterRef, Q
from django.utils import timezone

from plane.db.models import (
    PlayerRegistrationSession,
    PlayerRegistrationRequest,
    Project,
    ProjectMember,
    RosterPlayer,
    User,
    Workspace,
    WorkspaceMember,
    WorkspaceMemberInvite,
)
from plane.utils.player_invitations import public_player_api_origin

SALT = "plane.player-registration.v1"
LIFETIME = 15 * 60


class InvalidRegistration(ValueError):
    pass


class RegistrationAccountExists(InvalidRegistration):
    pass


class InvalidRegistrationToken(InvalidRegistration):
    pass


class WeakRegistrationPassword(InvalidRegistration):
    pass


def can_manage_registration(user, project):
    return bool(
        user.is_authenticated
        and user.is_active
        and not user.is_bot
        and WorkspaceMember.objects.filter(
            workspace=project.workspace, member=user, is_active=True, role__in=[15, 20]
        ).exists()
        and ProjectMember.objects.filter(project=project, member=user, is_active=True, role__in=[15, 20]).exists()
        and project.archived_at is None
        and project.workspace.deleted_at is None
    )


def session_details(session, *, include_ticket=False, user=None, roster_offset=0, roster_search=""):
    details = {
        "workspace_name": session.workspace.name,
        "program_name": session.project.name,
        "expires_at": session.expires_at.isoformat(),
    }
    if user is not None and user.is_authenticated:
        linked = RosterPlayer.objects.filter(project=session.project, user=user).exists()
        pending = PlayerRegistrationRequest.objects.filter(
            project=session.project, user=user, approved_at__isnull=True, roster_player__deleted_at__isnull=True
        ).exists()
        details["enrollment_status"] = "member" if linked else "pending" if pending else "new"
        if not linked and not pending and user.is_active and not user.is_bot:
            claimed = PlayerRegistrationRequest.objects.filter(roster_player_id=OuterRef("pk"))
            candidates = (
                RosterPlayer.objects.filter(
                    project=session.project, workspace_id=session.workspace_id,
                    user__isnull=True, status__in=["active", "injured"],
                )
                .filter(Q(email="") | Q(email__iexact=user.email))
                .annotate(_claimed=Exists(claimed)).filter(_claimed=False)
            )
            if RosterPlayer.objects.filter(project=session.project, email__iexact=user.email).exists():
                # An account email already assigned to a roster identity cannot
                # be transferred to a different blank-email athlete by claiming.
                candidates = candidates.filter(email__iexact=user.email)
            if roster_search:
                candidates = candidates.filter(
                    Q(player_name__icontains=roster_search) | Q(jersey_number__icontains=roster_search)
                )
            details["roster_candidates"] = {
                "total_count": candidates.count(), "limit": 50, "offset": roster_offset,
                "results": list(candidates.order_by("player_name", "id").values(
                    "id", "player_name", "jersey_number", "position", "class_year"
                )[roster_offset:roster_offset + 50]),
            }
    if include_ticket:
        token = signing.dumps({"id": str(session.id), "nonce": str(session.nonce)}, salt=SALT)
        details.update(
            token=token, url=public_player_api_origin() + "/auth/player-registration/?" + urlencode({"token": token})
        )
    return details


def registration_session(token):
    if not isinstance(token, str) or not 43 <= len(token) <= 2048:
        raise InvalidRegistrationToken()
    try:
        data = signing.loads(token, salt=SALT, max_age=LIFETIME)
        session = PlayerRegistrationSession.objects.select_related("workspace", "project__workspace").get(
            pk=data["id"],
            nonce=data["nonce"],
            closed_at__isnull=True,
            expires_at__gt=timezone.now(),
            workspace__deleted_at__isnull=True,
            project__deleted_at__isnull=True,
            project__archived_at__isnull=True,
        )
        if session.workspace_id != session.project.workspace_id:
            raise InvalidRegistration()
        return session
    except (
        signing.BadSignature,
        PlayerRegistrationSession.DoesNotExist,
        ValidationError,
        KeyError,
        TypeError,
        ValueError,
    ):
        raise InvalidRegistrationToken() from None


@transaction.atomic
def accept_registration(request, *, token, name, email, password, mode, roster_player_id="", account_only=False):
    from plane.authentication.provider.credentials.email import EmailProvider
    from plane.authentication.utils.login import user_login

    preview = registration_session(token)
    Workspace.objects.select_for_update().get(pk=preview.workspace_id)
    Project.objects.select_for_update().get(pk=preview.project_id)
    PlayerRegistrationSession.objects.select_for_update().get(pk=preview.pk)
    session = registration_session(token)
    email = email.strip().lower()
    name = name.strip()
    validate_email(email)
    if len(email) > 254 or len(name) > 150 or mode not in ("signup", "login", "join"):
        raise InvalidRegistration()
    if account_only and (mode != "signup" or roster_player_id):
        raise InvalidRegistration()
    current = request.user if request.user.is_authenticated else None
    if current and current.email.lower() != email:
        raise InvalidRegistration()
    existing = User.objects.select_for_update().filter(email__iexact=email).first()
    if mode == "signup" and existing:
        raise RegistrationAccountExists()
    if existing and (not existing.is_active or existing.is_bot):
        raise InvalidRegistration()
    if mode == "join":
        if not current or not existing or current.pk != existing.pk:
            raise InvalidRegistration()
        user = existing
    else:
        if (mode == "login" and not existing) or not password or len(password) > 128:
            raise InvalidRegistration()
        if mode == "signup":
            if not name:
                raise InvalidRegistration()
            try:
                validate_password(password, User(email=email, first_name=name))
            except ValidationError:
                raise WeakRegistrationPassword() from None
        user = EmailProvider(request=request, key=email, code=password, is_signup=mode == "signup").authenticate()
        if mode == "signup":
            user.first_name = name
            user.display_name = name
            # A shared meeting QR does not prove ownership of the entered email.
            user.is_email_verified = False
            user.save()

    if account_only:
        user_login(request, user, is_app=True)
        return user

    workspace_member = WorkspaceMember.objects.filter(workspace=session.workspace, member=user).first()
    program_member = ProjectMember.objects.filter(project=session.project, member=user).first()
    if (workspace_member and not workspace_member.is_active) or (program_member and not program_member.is_active):
        raise InvalidRegistration()
    if (
        workspace_member is None
        and WorkspaceMember.all_objects.filter(
            workspace=session.workspace, member=user, deleted_at__isnull=False
        ).exists()
    ):
        raise InvalidRegistration()
    if (
        program_member is None
        and ProjectMember.all_objects.filter(project=session.project, member=user, deleted_at__isnull=False).exists()
    ):
        raise InvalidRegistration()
    player = RosterPlayer.objects.filter(project=session.project, user=user).first()
    if player and player.status not in ("active", "injured"):
        raise InvalidRegistration()
    if player:
        # Already-approved registrations retain their existing memberships and link.
        if (
            workspace_member is None or program_member is None
            or (roster_player_id and str(player.pk) != str(roster_player_id))
        ):
            raise InvalidRegistration()
    elif PlayerRegistrationRequest.objects.filter(
        project=session.project, user=user, approved_at__isnull=True, roster_player__deleted_at__isnull=True
    ).exists():
        pending = PlayerRegistrationRequest.objects.get(project=session.project, user=user, approved_at__isnull=True)
        if roster_player_id and str(pending.roster_player_id) != str(roster_player_id):
            raise InvalidRegistration()
    else:
        try:
            lookup = {"pk": roster_player_id} if roster_player_id else {"email__iexact": email}
            player = RosterPlayer.objects.select_for_update().get(project=session.project, **lookup)
        except RosterPlayer.DoesNotExist:
            if roster_player_id:
                raise InvalidRegistration() from None
            if not name:
                raise InvalidRegistration()
            player = RosterPlayer.objects.create(
                project=session.project,
                email=email,
                player_name=name,
                status="pending",
            )
        except RosterPlayer.MultipleObjectsReturned:
            raise InvalidRegistration() from None
        else:
            # The shared QR records a claim; it does not prove email ownership.
            if (
                player.user_id or player.status not in ("active", "injured")
                or (player.email and player.email.strip().lower() != email)
            ):
                raise InvalidRegistration()
            if (
                RosterPlayer.objects.filter(project=session.project, email__iexact=email)
                .exclude(pk=player.pk).exists()
            ):
                raise InvalidRegistration()
        previous = PlayerRegistrationRequest.all_objects.select_for_update().filter(roster_player=player).first()
        if previous:
            if previous.deleted_at is None or previous.approved_at:
                raise InvalidRegistration()
            previous.user = user
            previous.deleted_at = None
            previous.save(update_fields=["user", "deleted_at", "updated_at"])
        else:
            PlayerRegistrationRequest.objects.create(project=session.project, user=user, roster_player=player)
    user_login(request, user, is_app=True)
    return user


@transaction.atomic
def approve_registration(project, actor, player_id):
    Workspace.objects.select_for_update().get(pk=project.workspace_id)
    project = Project.objects.select_for_update().select_related("workspace").get(pk=project.pk)
    if not can_manage_registration(actor, project):
        raise PermissionError()
    player = RosterPlayer.objects.select_for_update().get(pk=player_id, project=project)
    try:
        registration = PlayerRegistrationRequest.objects.select_for_update().get(
            project=project,
            workspace_id=project.workspace_id,
            roster_player=player,
        )
    except PlayerRegistrationRequest.DoesNotExist:
        # Older email matching linked the roster without creating program
        # membership. Only an explicit coach/admin approval may repair it.
        # Never use this path to restore an inactive or deleted membership.
        if (
            not player.user_id
            or player.status not in ("active", "injured")
            or ProjectMember.all_objects.filter(project=project, member_id=player.user_id).exists()
        ):
            raise
        registration = PlayerRegistrationRequest.objects.create(
            project=project, user_id=player.user_id, roster_player=player
        )
    user = User.objects.select_for_update().get(pk=registration.user_id, is_active=True, is_bot=False)
    if registration.approved_at:
        if player.user_id != user.pk:
            raise InvalidRegistration()
        return player
    if (
        (player.user_id is not None and player.user_id != user.pk)
        or player.status not in ("pending", "active", "injured")
        or (
            (player.email or "").strip().lower() != user.email.strip().lower()
            and bool(player.email)
        )
    ):
        raise InvalidRegistration()
    workspace_member = WorkspaceMember.objects.filter(workspace=project.workspace, member=user).first()
    program_member = ProjectMember.objects.filter(project=project, member=user).first()
    if (workspace_member and not workspace_member.is_active) or (program_member and not program_member.is_active):
        raise InvalidRegistration()
    if (
        workspace_member is None
        and WorkspaceMember.all_objects.filter(
            workspace=project.workspace, member=user, deleted_at__isnull=False
        ).exists()
    ):
        raise InvalidRegistration()
    if (
        program_member is None
        and ProjectMember.all_objects.filter(project=project, member=user, deleted_at__isnull=False).exists()
    ):
        raise InvalidRegistration()
    if RosterPlayer.objects.filter(project=project, user=user).exclude(pk=player.pk).exists():
        raise InvalidRegistration()
    if RosterPlayer.objects.filter(project=project, email__iexact=user.email).exclude(pk=player.pk).exists():
        raise InvalidRegistration()
    if workspace_member is None:
        WorkspaceMember.objects.create(workspace=project.workspace, member=user, role=1)
    if program_member is None:
        ProjectMember.objects.create(project=project, member=user, role=1)
    player.user = user
    player.email = user.email
    if player.status == "pending":
        player.status = "active"
    player.save(update_fields=["user", "email", "status", "updated_at"])
    registration.approved_by = actor
    registration.approved_at = timezone.now()
    registration.save(update_fields=["approved_by", "approved_at", "updated_at"])
    # A previous roster invitation is redundant once the QR approval grants Athlete access.
    WorkspaceMemberInvite.objects.filter(
        workspace=project.workspace,
        email__iexact=user.email,
        role=1,
        accepted=False,
        responded_at__isnull=True,
    ).update(deleted_at=registration.approved_at, updated_at=registration.approved_at)
    return player


@transaction.atomic
def decline_registration(project, actor, player_id):
    Workspace.objects.select_for_update().get(pk=project.workspace_id)
    Project.objects.select_for_update().get(pk=project.pk)
    if not can_manage_registration(actor, project):
        raise PermissionError()
    player = RosterPlayer.objects.select_for_update().get(pk=player_id, project=project)
    registration = PlayerRegistrationRequest.objects.select_for_update().get(
        project=project, roster_player=player, approved_at__isnull=True
    )
    registration.deleted_at = timezone.now()
    registration.save(update_fields=["deleted_at", "updated_at"])
    if player.status == "pending":
        # Only entries created by registration itself are pending. Coach-created
        # active identities, their jersey and historical references stay intact.
        from plane.utils.roster_lifecycle import remove_player
        remove_player(player, actor)
    return player


@transaction.atomic
def manage_registration(project, user, action):
    Workspace.objects.select_for_update().get(pk=project.workspace_id)
    project = Project.objects.select_for_update().select_related("workspace").get(pk=project.pk)
    if not can_manage_registration(user, project):
        raise PermissionError()
    sessions = PlayerRegistrationSession.objects.filter(project=project, closed_at__isnull=True)
    if action in ("POST", "DELETE"):
        sessions.update(closed_at=timezone.now())
    if action == "POST":
        session = PlayerRegistrationSession.objects.create(
            project=project,
            expires_at=timezone.now() + timedelta(seconds=LIFETIME),
            created_by=user,
        )
    else:
        session = sessions.filter(expires_at__gt=timezone.now()).first()
    return session_details(session, include_ticket=True) if session else None
