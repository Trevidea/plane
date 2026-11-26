"""One-time account recovery for active school-scoped athletes."""

from datetime import timedelta
import re
from secrets import choice
from uuid import uuid4

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.crypto import constant_time_compare, salted_hmac
from django.views.decorators.debug import sensitive_variables
from rest_framework.exceptions import PermissionDenied
from zxcvbn import zxcvbn

from plane.db.models import (
    PlayerPasswordReset,
    PlayerRegistrationRequest,
    Project,
    ProjectMember,
    RosterPlayer,
    Session,
    User,
    Workspace,
    WorkspaceMember,
)
from plane.license.models import InstanceAdmin
from plane.license.utils.instance_value import get_configuration_value
from plane.utils.diagnostic_logging import emit
from plane.utils.player_registration import can_manage_registration

ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
CODE_PATTERN = re.compile(rf"[{ALPHABET}]{{16}}", re.IGNORECASE | re.ASCII)
LIFETIME = timedelta(hours=24)


class ResetScopeChanged(ValueError):
    pass


def _digest(user, code):
    # Binding to the password hash also invalidates the code after any other password change.
    return salted_hmac(
        "kanavio.athlete-password-reset.v1", f"{user.pk}:{user.password}:{code}", algorithm="sha256"
    ).hexdigest()


def _lock_scope(workspace_id, project_id, player_id):
    workspace = Workspace.objects.select_for_update().filter(pk=workspace_id).first()
    if workspace is None:
        raise ResetScopeChanged()
    project = Project.objects.select_for_update().filter(pk=project_id, workspace=workspace).first()
    if project is None:
        raise ResetScopeChanged()
    player = RosterPlayer.objects.select_for_update().filter(pk=player_id, project=project, workspace=workspace).first()
    if player is None or not player.user_id:
        raise ResetScopeChanged()
    return project, player


def _lock_memberships(user, actor, project):
    # Existing role edits take these row locks. New memberships cannot commit
    # while their foreign key references a locked athlete user.
    targets = Q(member=user) | Q(member=actor, workspace_id=project.workspace_id)
    list(WorkspaceMember.objects.select_for_update().filter(targets).order_by("pk").values_list("pk", flat=True))
    targets = Q(member=user) | Q(member=actor, project=project)
    list(ProjectMember.objects.select_for_update().filter(targets).order_by("pk").values_list("pk", flat=True))


def _eligible(user, actor, project, player):
    if (
        not actor
        or user.pk == actor.pk
        or not user.is_active
        or user.is_bot
        or user.is_staff
        or user.is_superuser
        or user.is_password_autoset
        or not user.has_usable_password()
        or not user.email
        or player.status not in ("active", "injured")
        or player.user_id != user.pk
        or not can_manage_registration(actor, project)
        or Workspace.objects.filter(owner=user).exists()
        or InstanceAdmin.objects.filter(user=user).exists()
    ):
        return False
    (password_signin,) = get_configuration_value([{"key": "ENABLE_EMAIL_PASSWORD", "default": "1"}])
    if password_signin == "0":
        return False
    _lock_memberships(user, actor, project)
    if not can_manage_registration(actor, project):
        return False
    schools = WorkspaceMember.objects.filter(member=user, is_active=True)
    teams = ProjectMember.objects.filter(member=user, is_active=True)
    if (
        not schools.filter(workspace_id=project.workspace_id, role=1).exists()
        or not teams.filter(project=project, role=1).exists()
    ):
        return False
    # Recovery changes the installation-wide password. Deny other-school and non-athlete access.
    return not (
        schools.exclude(workspace_id=project.workspace_id, role=1).exists()
        or teams.exclude(workspace_id=project.workspace_id, role=1).exists()
        or RosterPlayer.objects.filter(user=user).exclude(workspace_id=project.workspace_id).exists()
        or PlayerRegistrationRequest.objects.filter(user=user).exclude(workspace_id=project.workspace_id).exists()
    )


@sensitive_variables("code")
@transaction.atomic
def issue_player_reset(project, player_id, actor, expected_user_id):
    project, player = _lock_scope(project.workspace_id, project.pk, player_id)
    if player.user_id != expected_user_id:
        raise ResetScopeChanged()
    user = User.objects.select_for_update().get(pk=player.user_id)
    if not _eligible(user, actor, project, player):
        raise PermissionDenied("You cannot issue a reset code for this account.")
    code = "".join(choice(ALPHABET) for _ in range(16))
    now = timezone.now()
    generation = uuid4()
    PlayerPasswordReset.objects.update_or_create(
        user=user,
        defaults={
            "roster_player": player,
            "issued_by": actor,
            "generation": generation,
            "digest": _digest(user, code),
            "issued_at": now,
            "expires_at": now + LIFETIME,
            "used_at": None,
        },
    )
    transaction.on_commit(lambda: emit("player.password_reset.issued"))
    return {"code": "-".join(code[i : i + 4] for i in range(0, len(code), 4)), "expires_at": now + LIFETIME}


@sensitive_variables("email", "code", "password", "normalized")
@transaction.atomic
def redeem_player_reset(email, code, password, *, request=None):
    user_ids = list(User.objects.filter(email__iexact=email).values_list("pk", flat=True)[:2])
    if len(user_ids) != 1:
        return "reset_unavailable"
    snapshot = PlayerPasswordReset.objects.filter(user_id=user_ids[0]).select_related("roster_player").first()
    if snapshot is None:
        return "reset_unavailable"
    try:
        roster = snapshot.roster_player
        project, player = _lock_scope(roster.workspace_id, roster.project_id, roster.pk)
    except ResetScopeChanged:
        return "reset_unavailable"
    user = User.objects.select_for_update().filter(pk=user_ids[0], email__iexact=email).first()
    if user is None:
        return "reset_unavailable"
    reset = (
        PlayerPasswordReset.objects.select_related("issued_by")
        .filter(user=user, generation=snapshot.generation)
        .first()
    )
    if (
        reset is None
        or reset.used_at
        or reset.expires_at <= timezone.now()
        or player.user_id != user.pk
    ):
        return "reset_unavailable"
    normalized = code.strip().replace("-", "").upper()
    if not CODE_PATTERN.fullmatch(normalized) or not constant_time_compare(_digest(user, normalized), reset.digest):
        return "reset_unavailable"
    if not _eligible(user, reset.issued_by, project, player):
        return "reset_unavailable"
    if request is not None:
        from plane.utils.enrollment_reports import bind_project

        bind_project(request, project.workspace.slug, project.pk, verified_actor=user.pk)
    try:
        validate_password(password, user)
    except ValidationError:
        return "weak_password"
    if zxcvbn(password, user_inputs=[user.email, user.first_name, user.last_name])["score"] < 3:
        return "weak_password"
    user.set_password(password)
    user.is_password_autoset = False
    user.is_password_expired = False
    user.save(update_fields=["password", "is_password_autoset", "is_password_expired"])
    reset.used_at = timezone.now()
    reset.digest = ""
    reset.save(update_fields=["used_at", "digest"])
    Session.objects.filter(user_id=str(user.pk)).delete()
    return "reset"
