import re

from django.db.models import CharField, Exists, Func, OuterRef, Q, Subquery, Value
from django.db.models.functions import Lower, Trim
from rest_framework.exceptions import PermissionDenied, ValidationError

from plane.db.models import PlayerRegistrationRequest, ProjectMember, RosterPlayer, User, WorkspaceMember
from plane.db.models.project import ProjectNetwork
from plane.utils.player_registration import can_manage_registration

MATCH_LIMIT = 10


def returning_account_candidates(project, name, graduation_year, *, previous_program_for=None):
    name = " ".join((name or "").split())
    graduation_year = (graduation_year or "").strip()
    if not name or not re.fullmatch(r"[0-9]{4}", graduation_year):
        return User.objects.none()

    # Only previously linked roster records provide evidence of a graduation year.
    roster = RosterPlayer.objects.filter(
        workspace_id=project.workspace_id,
        project__workspace_id=project.workspace_id,
        project__deleted_at__isnull=True,
        user_id=OuterRef("pk"),
    )
    prior = (
        roster.exclude(project_id=project.pk)
        .filter(status__in=("active", "injured", "inactive", "removed"))
        .alias(
            match_name=Lower(
                Trim(
                    Func(
                        "player_name",
                        Value(r"\s+"),
                        Value(" "),
                        Value("g"),
                        function="regexp_replace",
                        output_field=CharField(),
                    )
                )
            ),
            graduation_year=Trim("class_year"),
        )
        .filter(match_name=Lower(Value(name)), graduation_year=graduation_year)
    )
    membership = WorkspaceMember.objects.filter(
        workspace_id=project.workspace_id, member_id=OuterRef("pk"), is_active=True, role__in=(1, 5)
    )
    revoked = ProjectMember.all_objects.filter(project=project, member_id=OuterRef("pk")).filter(
        Q(is_active=False) | Q(deleted_at__isnull=False)
    )
    pending_claim = PlayerRegistrationRequest.objects.filter(
        project=project, user_id=OuterRef("pk"), approved_at__isnull=True, roster_player__deleted_at__isnull=True
    )
    candidates = (
        User.objects.filter(is_active=True, is_bot=False, email__isnull=False)
        .exclude(email="")
        .filter(
            Exists(prior),
            Exists(membership),
            ~Exists(roster.filter(project=project)),
            ~Exists(revoked),
            ~Exists(pending_claim),
        )
    )
    if previous_program_for is not None:
        permitted_projects = ProjectMember.objects.filter(member=previous_program_for, is_active=True)
        admin_scope = WorkspaceMember.objects.filter(
            workspace=project.workspace, member=previous_program_for, is_active=True, role=20
        )
        visible_prior = prior.filter(
            Q(project__network=ProjectNetwork.PUBLIC.value)
            | Q(project_id__in=permitted_projects.values("project_id"))
            | Exists(admin_scope)
        )
        candidates = candidates.annotate(
            previous_program=Subquery(visible_prior.order_by("-project__created_at", "pk").values("project__name")[:1])
        )
    return candidates


def lock_confirmed_returning_account(project, actor, account_id, *, name, graduation_year, roster_email):
    """The caller holds the workspace and project locks for the roster save."""
    if not can_manage_registration(actor, project):
        raise PermissionDenied("Roster and workspace invitation permissions are required.")

    candidates = returning_account_candidates(project, name, graduation_year).filter(pk=account_id)
    account = candidates.select_for_update(of=("self",)).first()
    if account is None or not candidates.exists():
        raise ValidationError(
            {"existing_account_id": "No longer a match. Check the name and graduation year, then retry."}
        )
    if roster_email and roster_email.casefold() != account.email.strip().casefold():
        raise ValidationError({"email": "Use the selected account's email or leave the roster email blank."})
    return account


def attach_confirmed_returning_account(player, actor, *, audit=True):
    from plane.db.models import RosterNoticeKind
    from plane.utils.roster_lifecycle import event
    from plane.utils.roster_notices import notify_player

    ProjectMember.objects.get_or_create(project=player.project, member_id=player.user_id, defaults={"role": 1})
    if audit:
        event(player, actor, "account_linked")
    notify_player(player, RosterNoticeKind.TEAM_ADDED, player.pk)
