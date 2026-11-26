# Python imports
import json
from collections.abc import Mapping

# Django imports
from django.conf import settings
from django.db import transaction
from django.db import IntegrityError
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.crypto import salted_hmac

# Third party imports
from rest_framework import serializers, status
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ProjectEntityPermission, allow_permission, ROLE
from plane.app.serializers import RosterPlayerImportSerializer, RosterPlayerSerializer
from plane.app.serializers.roster import RosterImportPayloadSerializer
from plane.db.models import PlayerRegistrationRequest, Project, RosterImportReceipt, RosterPlayer, Workspace, WorkspaceMember
from plane.utils.roster_invitation_delivery import queue_roster_invitation
from plane.utils.roster_membership import pending_player_invitations, roster_with_account_status
from .base import BaseViewSet


class AccountMatchQuery(serializers.Serializer):
    player_name = serializers.CharField(max_length=255)
    graduation_year = serializers.RegexField(r"\A[0-9]{4}\Z")


class ImportMatchQuery(serializers.Serializer):
    rows = AccountMatchQuery(many=True, allow_empty=False, max_length=50)


class RosterPlayerViewSet(BaseViewSet):
    user_role_readonly = True
    user_role_readonly_actions = {"list", "retrieve"}
    permission_classes = [ProjectEntityPermission]
    model = RosterPlayer
    serializer_class = RosterPlayerSerializer
    filterset_fields = ["position", "status", "class_year"]
    search_fields = ["player_name", "jersey_number", "position"]

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def issue_password_reset(self, request, slug, project_id, pk):
        from plane.authentication.views.player_registration import limited
        from plane.utils.player_password_reset import ResetScopeChanged, issue_player_reset
        from plane.utils.player_registration import can_manage_registration

        headers = {"Cache-Control": "private, no-store"}
        project = get_object_or_404(Project.objects.select_related("workspace"), pk=project_id, workspace__slug=slug)
        if not can_manage_registration(request.user, project):
            raise PermissionDenied("Roster and workspace permissions are required.")
        get_object_or_404(RosterPlayer.objects.exclude(status="removed"), pk=pk, project=project)
        if limited(request, "reset-issue", 12, str(request.user.pk)):
            return Response({"detail": "Try again in a minute."}, status=429, headers=headers)

        class Payload(serializers.Serializer):
            expected_user_id = serializers.UUIDField()

        payload = Payload(data=request.data)
        payload.is_valid(raise_exception=True)
        try:
            details = issue_player_reset(project, pk, request.user, payload.validated_data["expected_user_id"])
        except ResetScopeChanged:
            return Response(
                {"detail": "The roster account changed. Refresh and try again."}, status=409, headers=headers
            )
        return Response(details, status=201, headers=headers)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def account_matches(self, request, slug, project_id):
        from plane.utils.player_registration import can_manage_registration
        from plane.utils.roster_account_matching import MATCH_LIMIT, returning_account_candidates

        project = get_object_or_404(Project.objects.select_related("workspace"), pk=project_id, workspace__slug=slug)
        if not can_manage_registration(request.user, project):
            raise PermissionDenied("Roster and workspace invitation permissions are required.")

        query = AccountMatchQuery(data=request.data)
        query.is_valid(raise_exception=True)
        values = query.validated_data
        candidates = returning_account_candidates(project, values["player_name"], values["graduation_year"])
        rows = list(candidates.order_by("email", "id").values("id", "email")[: MATCH_LIMIT + 1])
        return Response(
            {"results": rows[:MATCH_LIMIT], "has_more": len(rows) > MATCH_LIMIT},
            headers={"Cache-Control": "private, no-store"},
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def import_matches(self, request, slug, project_id):
        from plane.authentication.views.player_registration import limited
        from plane.utils.player_registration import can_manage_registration
        from plane.utils.roster_account_matching import MATCH_LIMIT, returning_account_candidates

        headers = {"Cache-Control": "private, no-store"}
        project = get_object_or_404(Project.objects.select_related("workspace"), pk=project_id, workspace__slug=slug)
        if not can_manage_registration(request.user, project):
            raise PermissionDenied("Roster and workspace invitation permissions are required.")
        query = ImportMatchQuery(data=request.data)
        query.is_valid(raise_exception=True)
        if limited(request, "import-matches", 30, str(request.user.pk)):
            return Response({"detail": "Try checking for matches in a minute."}, status=429, headers=headers)

        matches = {}
        rows = []
        for row in query.validated_data["rows"]:
            key = (" ".join(row["player_name"].split()), row["graduation_year"])
            if key not in matches:
                candidates = returning_account_candidates(project, *key, previous_program_for=request.user)
                found = list(candidates.order_by("email", "id").values("id", "email", "previous_program")[:MATCH_LIMIT + 1])
                matches[key] = {"results": found[:MATCH_LIMIT], "has_more": len(found) > MATCH_LIMIT}
            rows.append(matches[key])
        return Response({"rows": rows}, headers=headers)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def resend_invitation(self, request, slug, project_id, pk):
        from plane.utils.player_registration import can_manage_registration

        def registration_conflict():
            return Response({"detail": "No open player invitation. Use the team join link."}, status=409)

        with transaction.atomic():
            workspace = get_object_or_404(Workspace.objects.select_for_update(), slug=slug)
            project = get_object_or_404(Project.objects.select_for_update(), pk=project_id, workspace=workspace)
            if not can_manage_registration(request.user, project):
                raise PermissionDenied("Roster and workspace invitation permissions are required.")
            player = get_object_or_404(
                RosterPlayer.objects.select_for_update().exclude(status="removed"),
                pk=pk, project=project, workspace=workspace,
            )
            if (
                not player.email
                or player.user_id
                or player.status not in ("active", "injured")
                or PlayerRegistrationRequest.objects.filter(roster_player=player, approved_at__isnull=True).exists()
            ):
                return registration_conflict()
            invitation = pending_player_invitations(workspace.pk, player.email).select_for_update().first()
            if invitation is None:
                return registration_conflict()
            queue_roster_invitation(invitation, request.user.pk)

        player = get_object_or_404(self.get_queryset(), pk=pk)
        return Response(self.get_serializer(player).data, headers={"Cache-Control": "private, no-store"})

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def registration(self, request, slug, project_id):
        from plane.utils.player_registration import RegistrationSessionChanged, manage_registration

        project = Project.objects.select_related("workspace").get(pk=project_id, workspace__slug=slug)
        try:
            details = manage_registration(
                project, request.user, request.method, expected=request.headers.get("If-Match")
            )
        except PermissionError:
            return Response({"detail": "Roster and workspace invitation permissions are required."}, status=403)
        except RegistrationSessionChanged:
            return Response(
                {"detail": "Registration changed. Refresh before updating it."},
                status=412,
                headers={"Cache-Control": "private, no-store"},
            )
        response = Response(
            details, status=201 if request.method == "POST" else 204 if request.method == "DELETE" else 200
        )
        response["Cache-Control"] = "private, no-store"
        return response

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def approve(self, request, slug, project_id, pk):
        from plane.db.models import PlayerRegistrationRequest, User
        from plane.utils.player_registration import approve_registration, InvalidRegistration

        project = get_object_or_404(Project.objects.select_related("workspace"), pk=project_id, workspace__slug=slug)
        try:
            player = approve_registration(project, request.user, pk)
        except PermissionError:
            return Response({"detail": "Roster and workspace invitation permissions are required."}, status=403)
        except (PlayerRegistrationRequest.DoesNotExist, User.DoesNotExist, RosterPlayer.DoesNotExist):
            return Response({"detail": "Registration not found."}, status=404)
        except (InvalidRegistration, IntegrityError):
            return Response(
                {"detail": "Unable to approve. Check the athlete's existing memberships and roster link."}, status=400
            )
        return Response(self.get_serializer(player).data)

    def get_queryset(self):
        queryset = (
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"))
            .filter(project_id=self.kwargs.get("project_id"))
        )

        if self.action != "events":
            queryset = queryset.exclude(status="removed")
        return roster_with_account_status(queryset).order_by(
            RosterPlayer.jersey_number_ordering(), "player_name", "created_at"
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def decline(self, request, slug, project_id, pk):
        from plane.db.models import PlayerRegistrationRequest
        from plane.utils.player_registration import decline_registration

        project = get_object_or_404(Project.objects.select_related("workspace"), pk=project_id, workspace__slug=slug)
        try:
            decline_registration(project, request.user, pk)
        except PermissionError:
            return Response({"detail": "Roster and workspace invitation permissions are required."}, status=403)
        except (PlayerRegistrationRequest.DoesNotExist, RosterPlayer.DoesNotExist):
            return Response({"detail": "Pending registration not found. Refresh the roster."}, status=404)
        return Response({"success": True, "message": "Join request declined."})

    def get_serializer_context(self):
        from plane.utils.player_registration import can_manage_registration

        context = super().get_serializer_context()
        context["project"] = Project.objects.get(
            workspace__slug=self.kwargs.get("slug"), pk=self.kwargs.get("project_id")
        )
        # Match workspace member email visibility, even when a workspace Guest
        # has an elevated project role. Compute once for the whole response.
        context["can_view_account_email"] = WorkspaceMember.objects.filter(
            workspace_id=context["project"].workspace_id,
            member=self.request.user,
            is_active=True,
            role__in=[ROLE.ADMIN.value, ROLE.MEMBER.value],
        ).exists()
        context["can_view_registration_claim"] = can_manage_registration(self.request.user, context["project"])
        return context

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def list(self, request, slug, project_id):
        queryset = self.filter_queryset(self.get_queryset())
        serializer = self.get_serializer(queryset, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def retrieve(self, request, slug, project_id, pk):
        return super().retrieve(request, slug, project_id, pk)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def create(self, request, slug, project_id):
        return super().create(request, slug, project_id)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def partial_update(self, request, slug, project_id, pk):
        return super().partial_update(request, slug, project_id, pk)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    @transaction.atomic
    def destroy(self, request, slug, project_id, pk):
        from plane.utils.roster_lifecycle import remove_player

        remove_player(self.get_object(), request.user)
        return Response({"success": True, "message": "Player removed from roster."}, status=200)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def identities(self, request, slug, project_id):
        rows = RosterPlayer.objects.filter(project_id=project_id, workspace__slug=slug)
        return Response(
            list(rows.values("id", "player_name", "jersey_number", "status")),
            headers={"Cache-Control": "private, no-store"},
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    @transaction.atomic
    def tag_references(self, request, slug, project_id):
        from plane.utils.team_seasons import roster_players_at_jerseys

        class Member(serializers.Serializer):
            member_id = serializers.UUIDField()
            jersey = serializers.CharField(max_length=20, allow_blank=True)

        class Payload(serializers.Serializer):
            roster_ids = serializers.ListField(child=serializers.UUIDField(), max_length=50, allow_empty=True)
            members = Member(many=True, max_length=50, required=False)

        payload = Payload(data=request.data)
        payload.is_valid(raise_exception=True)
        Workspace.objects.select_for_update().get(slug=slug)
        project = get_object_or_404(Project.objects.select_for_update(), pk=project_id, workspace__slug=slug)
        ids = set(payload.validated_data["roster_ids"])
        rows = RosterPlayer.objects.filter(
            project_id=project_id, workspace__slug=slug, id__in=ids, status__in=["active", "injured"]
        )
        current_jerseys = dict(rows.values_list("id", "jersey_number"))
        if current_jerseys.keys() != ids:
            return Response({"detail": "Only active players in this program can be tagged."}, status=400)
        at = timezone.now()
        if "members" in payload.validated_data:
            members = payload.validated_data["members"]
            requested = {member["member_id"]: member["jersey"] for member in members}
            if requested.keys() != ids or len(requested) != len(members):
                raise serializers.ValidationError({"members": "Provide an identity snapshot for each selected player."})
            jerseys = {jersey for jersey in requested.values() if jersey}
            season = getattr(project, "team_season", None)
            owners = roster_players_at_jerseys(season, jerseys, at) if season and jerseys else {}
            if any(
                jersey != (current_jerseys[member_id] or "") or (jersey and owners.get(jersey) != member_id)
                for member_id, jersey in requested.items()
            ):
                return Response(
                    {"detail": "A selected player's jersey changed or could not be verified. Refresh the roster."},
                    status=409,
                )
        rows.filter(first_tagged_at__isnull=True).update(first_tagged_at=at)
        return Response({"recorded": len(ids)})

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def events(self, request, slug, project_id):
        from plane.db.models import RosterEvent

        rows = RosterEvent.objects.filter(workspace__slug=slug, project_id=project_id).select_related(
            "actor", "roster_player"
        )[:100]
        return Response(
            [
                {
                    "id": str(row.id),
                    "roster_identity": str(row.roster_identity),
                    "player_name": row.player_name,
                    "jersey_number": row.jersey_number,
                    "action": row.action,
                    "previous_status": row.previous_status,
                    "status": row.status,
                    "created_at": row.created_at,
                    "actor_name": row.actor.display_name if row.actor else "Former user",
                    "has_account": bool(row.roster_player_id and row.roster_player.user_id),
                }
                for row in rows
            ],
            headers={"Cache-Control": "private, no-store"},
        )

    @allow_permission([ROLE.ADMIN], level="WORKSPACE")
    def account_deletion_policy(self, request, slug, project_id):
        get_object_or_404(Project.objects.all(), pk=project_id, workspace__slug=slug)
        return Response(
            {"enabled": settings.ROSTER_ACCOUNT_DELETION_ENABLED},
            headers={"Cache-Control": "private, no-store"},
        )

    @allow_permission([ROLE.ADMIN], level="WORKSPACE")
    def preview_account_deletion(self, request, slug, project_id, pk):
        from plane.utils.roster_lifecycle import preview_athlete_account_deletion

        player = get_object_or_404(
            RosterPlayer.objects, pk=pk, project_id=project_id, workspace__slug=slug, project__workspace__slug=slug
        )
        return Response(
            preview_athlete_account_deletion(player, request.user), headers={"Cache-Control": "private, no-store"}
        )

    @allow_permission([ROLE.ADMIN], level="WORKSPACE")
    def delete_account(self, request, slug, project_id, pk):
        from plane.utils.roster_lifecycle import delete_athlete_account

        player = get_object_or_404(
            RosterPlayer.objects, pk=pk, project_id=project_id, workspace__slug=slug, project__workspace__slug=slug
        )
        confirmation = request.data.get("confirmation") if isinstance(request.data, Mapping) else None
        delete_athlete_account(player, request.user, confirmation)
        return Response(status=204)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def import_players(self, request, slug, project_id):
        payload = RosterImportPayloadSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        context = self.get_serializer_context()
        project = context["project"]
        import_id = payload.validated_data.get("import_id")
        fingerprint = None
        headers = {"Cache-Control": "private, no-store"}
        if import_id:
            data = json.dumps(payload.validated_data["players"], sort_keys=True, separators=(",", ":"))
            fingerprint = salted_hmac("roster-import-v1", data, algorithm="sha256").hexdigest()

        with transaction.atomic():
            # Take locks before validating rows so a retry can find the receipt first.
            Workspace.objects.select_for_update().get(pk=project.workspace_id)
            project = Project.objects.select_for_update().get(pk=project.pk)
            context["project"] = project
            scope = {"project": project, "actor": request.user, "import_id": import_id}
            receipt = RosterImportReceipt.objects.filter(**scope).first() if import_id else None
            if receipt:
                if receipt.fingerprint != fingerprint:
                    return Response(
                        {"detail": "This import was already completed with different rows."}, status=409, headers=headers
                    )
                player_ids = receipt.player_ids
            else:
                serializer = RosterPlayerImportSerializer(data=payload.validated_data, context=context)
                serializer.is_valid(raise_exception=True)
                player_ids = [str(player.pk) for player in serializer.save()]
                if import_id:
                    RosterImportReceipt.objects.create(**scope, fingerprint=fingerprint, player_ids=player_ids)

        # Replay the original batch, but never return a stored copy of student data.
        players = roster_with_account_status(RosterPlayer.objects.filter(project=project, pk__in=player_ids))
        by_id = {str(player.pk): player for player in players}
        response_serializer = self.get_serializer(
            [by_id[player_id] for player_id in player_ids if player_id in by_id], many=True, context=context
        )
        return Response(
            {
                "success": True,
                "data": response_serializer.data,
                "imported_count": len(player_ids),
                "message": "Roster imported successfully.",
            },
            status=status.HTTP_201_CREATED,
            headers=headers,
        )
