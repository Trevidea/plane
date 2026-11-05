# Python imports
from typing import Any

# Django imports
from django.db import transaction

# Third Party imports
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied

# Module imports
from .base import BaseSerializer
from plane.db.models import RosterPlayer, RosterPlayerStatus, User, Workspace, WorkspaceMember, WorkspaceMemberInvite
from plane.utils.roster_membership import attach_imported_roster_member


class RosterPlayerSerializer(BaseSerializer):
    program_id = serializers.UUIDField(source="project_id", read_only=True)
    user = serializers.PrimaryKeyRelatedField(queryset=User.objects.all(), allow_null=True, required=False)
    account_status = serializers.SerializerMethodField()

    class Meta:
        model = RosterPlayer
        fields = [
            "id",
            "program_id",
            "user",
            "email",
            "account_status",
            "player_name",
            "jersey_number",
            "position",
            "height",
            "weight",
            "class_year",
            "status",
            "notes",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "program_id", "email", "created_at", "updated_at"]

    def get_account_status(self, player):
        if player.user_id is not None:
            return "linked"
        if not player.email:
            return "email_missing"
        pending = getattr(player, "_has_pending_invitation", None)
        if pending is None:
            pending = WorkspaceMemberInvite.objects.filter(
                workspace_id=player.workspace_id,
                email__iexact=player.email,
                accepted=False,
                responded_at__isnull=True,
            ).exists()
        return "invitation_pending" if pending else "not_linked"

    def validate_status(self, value):
        if not value:
            return RosterPlayerStatus.ACTIVE
        return value

    def validate_player_name(self, value):
        if not value or not value.strip():
            raise serializers.ValidationError("Player name is required.")
        return value.strip()

    def validate_jersey_number(self, value):
        if value is None:
            return None
        value = value.strip()
        return value or None

    def validate(self, attrs):
        project = self.context["project"]
        user = attrs.get("user")
        if user is not None:
            if not WorkspaceMember.objects.filter(workspace=project.workspace, member=user, is_active=True).exists():
                raise serializers.ValidationError({"user": "The account must be a member of this workspace."})
            linked = RosterPlayer.objects.filter(project=project, user=user)
            if self.instance:
                linked = linked.exclude(pk=self.instance.pk)
            if linked.exists():
                raise serializers.ValidationError({"user": "The account is already linked to a roster player."})
        jersey_number = attrs.get("jersey_number")
        if jersey_number:
            queryset = RosterPlayer.objects.filter(project=project, jersey_number=jersey_number)
            if self.instance:
                queryset = queryset.exclude(pk=self.instance.pk)
            if queryset.exists():
                raise serializers.ValidationError(
                    {"jersey_number": "Jersey number must be unique within this program."}
                )
        return attrs

    def create(self, validated_data):
        project = self.context["project"]
        return RosterPlayer.objects.create(project=project, **validated_data)


class RosterPlayerImportSerializer(serializers.Serializer):
    players = serializers.ListField(child=serializers.DictField(), allow_empty=False)

    def _get_first_error_message(self, errors: Any) -> str:
        if isinstance(errors, dict):
            first_error = next(iter(errors.values()), "Please provide valid detail.")
            return self._get_first_error_message(first_error)
        if isinstance(errors, list):
            first_error = errors[0] if errors else "Please provide valid detail."
            return self._get_first_error_message(first_error)
        return str(errors)

    def validate_players(self, players):
        if not players:
            raise serializers.ValidationError("At least one player is required.")

        project = self.context["project"]
        validated_rows = []
        row_errors = []
        imported_jersey_numbers = {}
        imported_emails = set()

        for row_number, payload in enumerate(players, start=1):
            serializer = RosterPlayerSerializer(data=payload, context=self.context)
            if not serializer.is_valid():
                row_errors.append(f"Row {row_number}: {self._get_first_error_message(serializer.errors)}")
                continue

            validated_row = dict(serializer.validated_data)
            email_field = serializers.EmailField(allow_blank=True, allow_null=True, max_length=254)
            try:
                email = (email_field.run_validation(payload.get("email", "")) or "").strip().lower()
            except serializers.ValidationError:
                row_errors.append(f"Row {row_number}: Provide a valid email address.")
                continue
            if email:
                request = self.context.get("request")
                if (
                    not request
                    or not WorkspaceMember.objects.filter(
                        workspace=project.workspace, member=request.user, is_active=True, role__in=[15, 20]
                    ).exists()
                ):
                    raise PermissionDenied("Workspace invitation permission is required to import player emails.")
                if (
                    email in imported_emails
                    or RosterPlayer.objects.filter(project=project, email__iexact=email).exists()
                ):
                    row_errors.append(f"Row {row_number}: Email is already used by a player in this program.")
                    continue
                if validated_row.get("user") and validated_row["user"].email.lower() != email:
                    row_errors.append(f"Row {row_number}: Email does not match the selected member account.")
                    continue
                imported_emails.add(email)
            validated_row["email"] = email
            jersey_number = validated_row.get("jersey_number")

            if jersey_number:
                duplicate_row = imported_jersey_numbers.get(jersey_number)
                if duplicate_row:
                    row_errors.append(
                        f"Row {row_number}: Jersey number {jersey_number} is duplicated in the import file."
                    )
                    continue
                imported_jersey_numbers[jersey_number] = row_number

            validated_rows.append((row_number, validated_row))

        existing_jersey_numbers = set(
            RosterPlayer.objects.filter(
                project=project,
                jersey_number__in=list(imported_jersey_numbers.keys()),
            ).values_list("jersey_number", flat=True)
        )

        for row_number, validated_row in validated_rows:
            jersey_number = validated_row.get("jersey_number")
            if jersey_number and jersey_number in existing_jersey_numbers:
                row_errors.append(f"Row {row_number}: Jersey number {jersey_number} already exists in this program.")

        if row_errors:
            raise serializers.ValidationError(row_errors)

        return [validated_row for _, validated_row in validated_rows]

    def create(self, validated_data):
        project = self.context["project"]
        players = []

        with transaction.atomic():
            Workspace.objects.select_for_update().get(pk=project.workspace_id)
            # Serializes imports into a program with invitation acceptance linking.
            type(project).objects.select_for_update().get(pk=project.pk)
            for player_data in validated_data["players"]:
                if (
                    player_data.get("email")
                    and RosterPlayer.objects.filter(project=project, email__iexact=player_data["email"]).exists()
                ):
                    raise serializers.ValidationError({"players": ["Email is already used in this program."]})
                player = RosterPlayer.objects.create(project=project, **player_data)
                attach_imported_roster_member(player, self.context.get("request"))
                players.append(player)

        return players
