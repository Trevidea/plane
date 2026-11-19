# Django imports
from django.db import transaction
from django.db import IntegrityError
from django.shortcuts import get_object_or_404
from django.utils import timezone

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ProjectEntityPermission, allow_permission, ROLE
from plane.app.serializers import RosterPlayerImportSerializer, RosterPlayerSerializer
from plane.db.models import Project, RosterPlayer, Workspace, WorkspaceMember
from plane.utils.roster_membership import roster_with_account_status
from .base import BaseViewSet


class RosterPlayerViewSet(BaseViewSet):
    user_role_readonly = True
    user_role_readonly_actions = {"list", "retrieve"}
    permission_classes = [ProjectEntityPermission]
    model = RosterPlayer
    serializer_class = RosterPlayerSerializer
    filterset_fields = ["position", "status", "class_year"]
    search_fields = ["player_name", "jersey_number", "position"]

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def registration(self, request, slug, project_id):
        from plane.utils.player_registration import manage_registration

        project = Project.objects.select_related("workspace").get(pk=project_id, workspace__slug=slug)
        try:
            details = manage_registration(project, request.user, request.method)
        except PermissionError:
            return Response({"detail": "Roster and workspace invitation permissions are required."}, status=403)
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
        from rest_framework import serializers

        class Payload(serializers.Serializer):
            roster_ids = serializers.ListField(child=serializers.UUIDField(), max_length=50, allow_empty=True)

        payload = Payload(data=request.data)
        payload.is_valid(raise_exception=True)
        Workspace.objects.select_for_update().get(slug=slug)
        get_object_or_404(Project.objects.select_for_update(), pk=project_id, workspace__slug=slug)
        ids = set(payload.validated_data["roster_ids"])
        rows = RosterPlayer.objects.filter(
            project_id=project_id, workspace__slug=slug, id__in=ids, status__in=["active", "injured"]
        )
        if rows.count() != len(ids):
            return Response({"detail": "Only active players in this program can be tagged."}, status=400)
        rows.filter(first_tagged_at__isnull=True).update(first_tagged_at=timezone.now())
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
    def delete_account(self, request, slug, project_id, pk):
        from plane.utils.roster_lifecycle import delete_athlete_account

        player = get_object_or_404(RosterPlayer.objects, pk=pk, project_id=project_id, workspace__slug=slug)
        delete_athlete_account(player, request.user)
        return Response(status=204)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def import_players(self, request, slug, project_id):
        serializer = RosterPlayerImportSerializer(data=request.data, context=self.get_serializer_context())
        serializer.is_valid(raise_exception=True)

        with transaction.atomic():
            players = serializer.save()

        statuses = roster_with_account_status(
            RosterPlayer.objects.filter(pk__in=[player.pk for player in players])
        ).in_bulk()
        response_serializer = self.get_serializer([statuses[player.pk] for player in players], many=True)
        return Response(
            {
                "success": True,
                "data": response_serializer.data,
                "imported_count": len(response_serializer.data),
                "message": "Roster imported successfully.",
            },
            status=status.HTTP_201_CREATED,
        )
