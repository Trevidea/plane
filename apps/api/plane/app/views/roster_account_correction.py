from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from plane.app.views.team_admin import PRIVATE, RosterStaffAPIView, admin_workspace
from plane.db.models import CoachingCardPrivateAttachment, CoachingCardPrivateMessage, Issue, PlayerActivityProgress
from plane.db.models import PlayerPasswordReset, PlayerRegistrationRequest, Project, ProjectMember, RosterPlayer
from plane.utils.roster_account_matching import attach_confirmed_returning_account, lock_confirmed_returning_account
from plane.utils.roster_lifecycle import event


class CorrectionInput(serializers.Serializer):
    expected_user_id = serializers.UUIDField()
    replacement_user_id = serializers.UUIDField(allow_null=True)


def correction_conflict(project, roster, account_id):
    identity = str(roster.pk)
    card_reference = (
        Q(roster_player=roster)
        | Q(coaching_card_data__recipient_ids__contains=[identity])
        | Q(coaching_card_data__player__id=identity)
        | Q(coaching_card_data__recipients__contains=[{"id": identity}])
    )
    return (
        PlayerRegistrationRequest.all_objects.filter(roster_player=roster).exists()
        or Issue.all_objects.filter(project=project, category="Coaching Card").filter(card_reference).exists()
        or CoachingCardPrivateMessage.objects.filter(issue__project=project, recipient_id=account_id).exists()
        or CoachingCardPrivateAttachment.objects.filter(issue__project=project, recipient_id=account_id).exists()
        or PlayerActivityProgress.all_objects.filter(project=project, user_id=account_id).exists()
    )


class RosterAccountCorrectionEndpoint(RosterStaffAPIView):
    def get(self, request, slug, project_id, player_id):
        workspace = admin_workspace(request, slug)
        row = get_object_or_404(
            RosterPlayer.objects.select_related("user"),
            workspace=workspace,
            project_id=project_id,
            project__workspace=workspace,
            project__deleted_at__isnull=True,
            pk=player_id,
            user__isnull=False,
        )
        return Response(
            {
                "id": row.pk,
                "user": row.user_id,
                "player_name": row.player_name,
                "account_email": row.user.email,
                "status": row.status,
                "class_year": None,
            },
            headers=PRIVATE,
        )

    @transaction.atomic
    def post(self, request, slug, project_id, player_id):
        workspace = admin_workspace(request, slug, lock=True)
        project = get_object_or_404(Project.objects.select_for_update(), workspace=workspace, pk=project_id)
        payload = CorrectionInput(data=request.data)
        payload.is_valid(raise_exception=True)
        old_id = payload.validated_data["expected_user_id"]
        replacement = payload.validated_data["replacement_user_id"]
        roster = get_object_or_404(
            RosterPlayer.objects.select_for_update(), project=project, pk=player_id, workspace=workspace
        )
        if roster.user_id != old_id:
            return Response(
                {"detail": "The linked account changed. Refresh before correcting it."}, status=409, headers=PRIVATE
            )
        if replacement == old_id:
            raise ValidationError("Select a different account or leave the player unlinked.")
        old_membership = ProjectMember.objects.select_for_update().filter(project=project, member_id=old_id).first()
        if old_membership and old_membership.role != 1:
            return Response(
                {"detail": "Staff and guest program access cannot be changed here."}, status=409, headers=PRIVATE
            )
        protected_history = correction_conflict(project, roster, old_id)
        must_hold = protected_history or bool(project.archived_at) or roster.status not in ("active", "injured")
        if replacement and must_hold:
            return Response(
                {
                    "detail": (
                        "This link cannot be transferred. Leave the player unlinked to revoke access "
                        "and hold the roster identity for separate review."
                    )
                },
                status=409,
                headers=PRIVATE,
            )
        account = None
        if replacement:
            account = lock_confirmed_returning_account(
                project,
                request.user,
                replacement,
                name=roster.player_name,
                graduation_year=roster.class_year,
                roster_email=None,
            )
            if RosterPlayer.objects.filter(project=project, email__iexact=account.email).exclude(pk=roster.pk).exists():
                raise ValidationError("The selected account email is already associated with another roster entry.")
        if old_membership and old_membership.is_active:
            old_membership.is_active = False
            old_membership.save(update_fields=["is_active", "updated_at"])
        PlayerPasswordReset.objects.filter(roster_player=roster, user_id=old_id).delete()
        roster.user = account
        roster.email = ""
        roster.account_link_held = must_hold
        roster.save(update_fields=["user", "email", "account_link_held", "updated_at"])
        if account:
            attach_confirmed_returning_account(roster, request.user, audit=False)
        audit = event(roster, request.user, "account_link_revoked" if must_hold else "account_link_corrected")
        audit.previous_account_id = old_id
        audit.replacement_account_id = replacement
        audit.save(update_fields=["previous_account_id", "replacement_account_id"])
        return Response({"id": roster.pk, "user": roster.user_id, "account_link_held": must_hold}, headers=PRIVATE)
