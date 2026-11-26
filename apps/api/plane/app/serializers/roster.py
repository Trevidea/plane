# Python imports
from typing import Any

# Django imports
from django.db import transaction

# Third Party imports
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied

# Module imports
from .base import BaseSerializer
from plane.db.models import (
    RosterPlayer,
    RosterPlayerStatus,
    User,
    Workspace,
    WorkspaceMember,
    WorkspaceMemberInvite,
    PlayerRegistrationRequest,
    ProjectMember,
)
from plane.utils.roster_invitation_delivery import delivery_details
from plane.utils.roster_membership import attach_imported_roster_member, pending_player_invitations
from plane.utils.roster_account_matching import attach_confirmed_returning_account, lock_confirmed_returning_account
from plane.utils.team_seasons import ensure_program_season, sync_jersey_assignment


class RosterPlayerSerializer(BaseSerializer):
    member_id = serializers.UUIDField(source="id", read_only=True)
    program_id = serializers.UUIDField(source="project_id", read_only=True)
    existing_account_id = serializers.UUIDField(required=False, write_only=True)
    user = serializers.PrimaryKeyRelatedField(queryset=User.objects.all(), allow_null=True, required=False)
    email = serializers.EmailField(required=False, allow_blank=True, allow_null=True, max_length=254)
    account_email = serializers.SerializerMethodField()
    account_avatar_url = serializers.SerializerMethodField()
    account_status = serializers.SerializerMethodField()
    invitation_delivery = serializers.SerializerMethodField()
    registration_status = serializers.SerializerMethodField()
    registration_email = serializers.SerializerMethodField()
    registration_name = serializers.SerializerMethodField()

    class Meta:
        model = RosterPlayer
        fields = [
            "id",
            "member_id",
            "program_id",
            "existing_account_id",
            "user",
            "email",
            "account_email",
            "account_avatar_url",
            "account_status",
            "account_link_held",
            "invitation_delivery",
            "registration_status",
            "registration_email",
            "registration_name",
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
        read_only_fields = ["id", "program_id", "account_link_held", "created_at", "updated_at"]

    def get_account_email(self, player):
        if not self.context.get("can_view_linked_account_details", False) or player.user_id is None:
            return None
        return player.user.email

    def get_account_avatar_url(self, player):
        if not self.context.get("can_view_linked_account_details", False) or player.user_id is None:
            return None
        return player.user.avatar_url

    def _pending_claimant(self, player):
        if player.account_link_held or not self.context.get("can_view_registration_claim", False):
            return None
        registration = getattr(player, "registration_request", None)
        if registration and registration.deleted_at is None and registration.approved_at is None:
            return registration.user
        return None

    def get_registration_email(self, player):
        user = self._pending_claimant(player)
        return user.email if user else None

    def get_registration_name(self, player):
        user = self._pending_claimant(player)
        return (user.first_name or user.display_name) if user else None

    def get_registration_status(self, player):
        if player.account_link_held:
            return None
        pending = getattr(player, "_registration_pending", None)
        if pending is None:
            pending = PlayerRegistrationRequest.objects.filter(roster_player=player, approved_at__isnull=True).exists()
        if not pending and player.user_id and player.status in ("active", "injured"):
            membership_exists = getattr(player, "_program_membership_exists", None)
            if membership_exists is None:
                membership_exists = ProjectMember.all_objects.filter(
                    project_id=player.project_id, member_id=player.user_id
                ).exists()
            pending = not membership_exists
        return "pending" if pending else None

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

    def get_invitation_delivery(self, player):
        if (
            not self.context.get("can_view_registration_claim")
            or not player.email
            or player.user_id
            or player.status not in ("active", "injured")
            or self.get_registration_status(player) == "pending"
        ):
            return None
        if hasattr(player, "_player_invitation_exists"):
            if not player._player_invitation_exists:
                return None
            return delivery_details(player._invitation_delivery_state, player._invitation_delivery_changed_at)
        invitation = pending_player_invitations(player.workspace_id, player.email).values(
            "roster_delivery__state", "roster_delivery__changed_at"
        ).first()
        if invitation:
            return delivery_details(invitation["roster_delivery__state"], invitation["roster_delivery__changed_at"])
        return None

    def validate_status(self, value):
        if value == "removed":
            raise serializers.ValidationError("Use Remove from roster to remove a player.")
        return RosterPlayerStatus.ACTIVE if not value or value == "injured" else value

    def validate_player_name(self, value):
        if not value or not value.strip():
            raise serializers.ValidationError("Player name is required.")
        return value.strip()

    def validate_jersey_number(self, value):
        if value is None:
            return None
        value = value.strip()
        return value or None

    def validate_email(self, value):
        return (value or "").strip().lower()

    def validate(self, attrs):
        if "existing_account_id" in attrs and (self.instance or attrs.get("status", "active") != "active"):
            raise serializers.ValidationError(
                {"existing_account_id": "An existing account can only be confirmed when adding an active player."}
            )
        if self.instance and self.instance.status == "removed":
            raise serializers.ValidationError(
                {"detail": "Removed roster identities cannot be edited. Refresh the roster."}
            )
        if self.instance and self.instance.account_link_held and (attrs.get("email") or attrs.get("user")):
            raise serializers.ValidationError({"email": "This roster identity is held. Its account and email cannot be changed."})
        project = self.context["project"]
        if self.instance and not self.instance.user_id and self.get_registration_status(self.instance) == "pending":
            changes_link = "user" in attrs and (attrs["user"].pk if attrs["user"] else None) != self.instance.user_id
            changes_email = "email" in attrs and attrs["email"] != self.instance.email
            changes_status = "status" in attrs and attrs["status"] != self.instance.status
            if changes_link or changes_email or changes_status:
                raise serializers.ValidationError(
                    {"detail": "Approve this registration before changing its account, email, or status."}
                )
        previous_email = (self.instance.email or "").strip().lower() if self.instance else ""
        email_changed = "email" in attrs and attrs["email"] != previous_email
        if "email" in attrs:
            email = attrs["email"]
            if self.instance and self.instance.user_id and email_changed:
                raise serializers.ValidationError({"email": "The email of a linked player cannot be changed."})
            if email:
                if email_changed:
                    request = self.context.get("request")
                    if (
                        not request
                        or not WorkspaceMember.objects.filter(
                            workspace=project.workspace, member=request.user, is_active=True, role__in=[15, 20]
                        ).exists()
                    ):
                        raise PermissionDenied("Workspace invitation permission is required to save player emails.")
                duplicates = RosterPlayer.objects.filter(project=project, email__iexact=email)
                if self.instance:
                    duplicates = duplicates.exclude(pk=self.instance.pk)
                if duplicates.exists():
                    raise serializers.ValidationError({"email": "Email is already used by a player in this program."})

        previous_user_id = self.instance.user_id if self.instance else None
        selected_user_id = attrs["user"].pk if attrs.get("user") else None
        user_changed = "user" in attrs and selected_user_id != previous_user_id
        if selected_user_id and user_changed:
            raise serializers.ValidationError(
                {"user": "The player must join using the team link and receive approval before linking this account."}
            )
        if email_changed or user_changed:
            selected_user = attrs.get("user", self.instance.user if self.instance else None)
            email = attrs.get("email", self.instance.email if self.instance else "")
            if selected_user and email and selected_user.email.lower() != email.lower():
                raise serializers.ValidationError({"email": "Email does not match the selected member account."})

        user = attrs.get("user")
        if user is not None:
            if not WorkspaceMember.objects.filter(workspace=project.workspace, member=user, is_active=True).exists():
                raise serializers.ValidationError({"user": "The account must be a member of this workspace."})
            linked = RosterPlayer.objects.filter(project=project, user=user)
            if self.instance:
                linked = linked.exclude(pk=self.instance.pk)
            if linked.exists():
                raise serializers.ValidationError({"user": "The account is already linked to a roster player."})
        participation = attrs.get("status", self.instance.status if self.instance else "active")
        if participation == "inactive":
            attrs["jersey_number"] = None
        elif (
            self.instance
            and self.instance.status == "inactive"
            and participation == "active"
            and "jersey_number" not in attrs
        ):
            attrs["jersey_number"] = None
        jersey_number = attrs.get("jersey_number")
        if jersey_number:
            queryset = RosterPlayer.objects.filter(
                project=project, jersey_number=jersey_number, status__in=["active", "injured", "pending"]
            )
            if self.instance:
                queryset = queryset.exclude(pk=self.instance.pk)
            if queryset.exists():
                raise serializers.ValidationError(
                    {"jersey_number": "Jersey number must be unique within this program."}
                )
        return attrs

    def _attach_email(self, player):
        try:
            attach_imported_roster_member(player, self.context.get("request"))
        except serializers.ValidationError as error:
            # Imports retain their row errors; form saves report the email field.
            if isinstance(error.detail, dict) and "players" in error.detail:
                raise serializers.ValidationError({"email": error.detail["players"]}) from error
            raise

    @transaction.atomic
    def create(self, validated_data):
        project = self.context["project"]
        Workspace.objects.select_for_update().get(pk=project.workspace_id)
        project = type(project).objects.select_for_update().get(pk=project.pk)
        self.validate(validated_data)
        account = None
        if account_id := validated_data.pop("existing_account_id", None):
            account = lock_confirmed_returning_account(
                project, self.context["request"].user, account_id, name=validated_data["player_name"],
                graduation_year=validated_data.get("class_year"), roster_email=validated_data.get("email"),
            )
            validated_data["user"] = account
        player = RosterPlayer.objects.create(project=project, **validated_data)
        sync_jersey_assignment(player)
        if account:
            attach_confirmed_returning_account(player, self.context["request"].user)
        elif player.email:
            self._attach_email(player)
        return player

    @transaction.atomic
    def update(self, instance, validated_data):
        project = self.context["project"]
        # Match imports and invitation acceptance: workspace, project, then row.
        Workspace.objects.select_for_update().get(pk=project.workspace_id)
        type(project).objects.select_for_update().get(pk=project.pk)
        self.instance = RosterPlayer.objects.select_for_update().get(pk=instance.pk)
        self.validate(validated_data)
        previous_status = self.instance.status
        previous_jersey = self.instance.jersey_number
        previous_email = (self.instance.email or "").strip().lower()
        email_changed = "email" in validated_data and validated_data["email"] != previous_email
        # Reloading also discards the old _has_pending_invitation annotation.
        player = super().update(self.instance, validated_data)
        if previous_status != player.status or previous_jersey != player.jersey_number:
            sync_jersey_assignment(player)
        if previous_status != player.status:
            from plane.utils.roster_lifecycle import event

            request = self.context["request"]
            getattr(request, "_request", request)._roster_status_changed = True
            log = event(player, self.context["request"].user, "status_changed", previous_status)
            log.jersey_number = previous_jersey
            log.save(update_fields=["jersey_number"])
        if email_changed and player.email:
            self._attach_email(player)
        return player


class RosterImportPayloadSerializer(serializers.Serializer):
    players = serializers.ListField(child=serializers.DictField(), allow_empty=False, max_length=500)
    import_id = serializers.UUIDField(required=False)


class RosterPlayerImportSerializer(RosterImportPayloadSerializer):

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
        confirmed_accounts = set()

        for row_number, payload in enumerate(players, start=1):
            serializer = RosterPlayerSerializer(data=payload, context=self.context)
            if not serializer.is_valid():
                row_errors.append(f"Row {row_number}: {self._get_first_error_message(serializer.errors)}")
                continue

            validated_row = dict(serializer.validated_data)
            if account_id := validated_row.get("existing_account_id"):
                if account_id in confirmed_accounts:
                    row_errors.append(f"Row {row_number}: This account is already selected for another row.")
                    continue
                confirmed_accounts.add(account_id)
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
        # The view holds the workspace and project locks through receipt creation.
        project = self.context["project"]
        request = self.context["request"]
        rows = validated_data["players"]
        accounts = {}
        selected_login_emails = set()
        selections = sorted(
            (row["existing_account_id"], index) for index, row in enumerate(rows) if row.get("existing_account_id")
        )
        for account_id, index in selections:
            row = rows[index]
            try:
                account = lock_confirmed_returning_account(
                    project, request.user, account_id, name=row["player_name"],
                    graduation_year=row.get("class_year"), roster_email=row.get("email"),
                )
            except serializers.ValidationError as error:
                message = self._get_first_error_message(error.detail)
                raise serializers.ValidationError({
                    "players": [f"Row {index + 1}: {message}"],
                    "row_error": {"index": str(index), "message": message},
                }) from error
            accounts[index] = account
            selected_login_emails.add(account.email.strip().casefold())

        for index, row in enumerate(rows):
            if index not in accounts and row["email"].casefold() in selected_login_emails:
                raise serializers.ValidationError({
                    "players": [f"Row {index + 1}: This email belongs to an account selected on another row."]
                })

        players = []
        season = ensure_program_season(project)
        for index, row in enumerate(rows):
            player_data = dict(row)
            player_data.pop("existing_account_id", None)
            if index in accounts:
                player_data["user"] = accounts[index]
            player = RosterPlayer.objects.create(project=project, **player_data)
            sync_jersey_assignment(player, team_season=season)
            if index in accounts:
                attach_confirmed_returning_account(player, request.user)
            elif player.email:
                try:
                    attach_imported_roster_member(player, request)
                except serializers.ValidationError as error:
                    message = self._get_first_error_message(error.detail)
                    raise serializers.ValidationError({"players": [f"Row {index + 1}: {message}"]}) from error
            players.append(player)

        return players
