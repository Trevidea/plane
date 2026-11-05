"""Narrow player endpoints; generic issue/project mutation APIs remain unavailable."""

from django.db import transaction
from django.db.models import F, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.html import format_html
from rest_framework import serializers
from rest_framework.response import Response

from plane.app.views.base import BaseAPIView
from plane.app.views.player import PlayerProgramQuerySerializer, _eligible_roster
from plane.db.models import CardStageHistory, CommentReaction, Issue, IssueReaction, PlayerActivityProgress
from plane.utils.coaching_card import COACHING_CARD_CATEGORY
from plane.utils.player_activity_access import (
    activity_data,
    comment_data,
    media_references,
    player_activities,
    player_programs,
    progress_data,
    visible_comments,
)


class StrictSerializer(serializers.Serializer):
    def to_internal_value(self, data):
        if not isinstance(data, dict):
            raise serializers.ValidationError("Expected a JSON object.")
        unknown = set(data) - set(self.fields)
        if unknown:
            raise serializers.ValidationError({key: ["This field cannot be changed."] for key in unknown})
        return super().to_internal_value(data)


class ProgressSerializer(StrictSerializer):
    percent = serializers.IntegerField(min_value=0, max_value=100, required=True)
    note = serializers.CharField(max_length=5000, allow_blank=True, required=False)


class TextSerializer(StrictSerializer):
    text = serializers.CharField(max_length=10000, allow_blank=False)


class ReactionSerializer(StrictSerializer):
    reaction = serializers.CharField(max_length=32, allow_blank=False)


class PlayerActivityBase(BaseAPIView):
    user_role_access = True

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "private, no-store"
        return response

    def activity(self, request, slug, project_id, issue_id):
        return get_object_or_404(
            player_activities(request.user), pk=issue_id, project_id=project_id, workspace__slug=slug
        )


class PlayerAssignmentsEndpoint(PlayerActivityBase):
    def get(self, request):
        return Response(
            [
                {
                    "id": str(project.id),
                    "name": project.name,
                    "workspace_slug": project.workspace.slug,
                    "workspace_name": project.workspace.name,
                }
                for project in player_programs(request.user).order_by("name", "id")
            ]
        )


class PlayerActivitiesEndpoint(PlayerActivityBase):
    def get(self, request):
        class Pagination(serializers.Serializer):
            limit = serializers.IntegerField(min_value=1, max_value=100, default=50)
            offset = serializers.IntegerField(min_value=0, default=0)
            project_id = serializers.UUIDField(required=False)

        query = Pagination(data=request.query_params)
        query.is_valid(raise_exception=True)
        values = query.validated_data
        issues = player_activities(request.user).order_by("-created_at", "-id")
        if values.get("project_id"):
            issues = issues.filter(project_id=values["project_id"])
        start = values["offset"]
        return Response(
            {
                "total_count": issues.count(),
                "limit": values["limit"],
                "offset": start,
                "results": [activity_data(issue, request.user) for issue in issues[start : start + values["limit"]]],
            }
        )


class PlayerActivityEndpoint(PlayerActivityBase):
    def get(self, request, slug, project_id, issue_id):
        return Response(activity_data(self.activity(request, slug, project_id, issue_id), request.user))


class PlayerProgressEndpoint(PlayerActivityBase):
    @transaction.atomic
    def patch(self, request, slug, project_id, issue_id):
        issue = self.activity(request, slug, project_id, issue_id)
        values = ProgressSerializer(data=request.data)
        values.is_valid(raise_exception=True)
        # Lock the issue to serialize first submissions for this activity.
        type(issue).objects.select_for_update().get(pk=issue.pk)
        progress, _ = PlayerActivityProgress.objects.get_or_create(
            issue=issue, project=issue.project, user=request.user
        )
        progress.percent = values.validated_data["percent"]
        if "note" in values.validated_data:
            progress.note = values.validated_data["note"]
        progress.completed_at = (progress.completed_at or timezone.now()) if progress.percent == 100 else None
        progress.save()
        return Response(progress_data(progress))


class PlayerCommentsEndpoint(PlayerActivityBase):
    def get(self, request, slug, project_id, issue_id):
        issue = self.activity(request, slug, project_id, issue_id)
        return Response([comment_data(comment, request.user) for comment in visible_comments(issue, request.user)])

    def post(self, request, slug, project_id, issue_id):
        issue = self.activity(request, slug, project_id, issue_id)
        values = TextSerializer(data=request.data)
        values.is_valid(raise_exception=True)
        from plane.db.models import IssueComment

        comment = IssueComment.objects.create(
            project=issue.project,
            issue=issue,
            actor=request.user,
            access="EXTERNAL",
            comment_html=str(format_html("<p>{}</p>", values.validated_data["text"])),
        )
        return Response(comment_data(comment, request.user), status=201)


class PlayerCommentEndpoint(PlayerActivityBase):
    def own_comment(self, request, slug, project_id, issue_id, comment_id):
        issue = self.activity(request, slug, project_id, issue_id)
        return get_object_or_404(visible_comments(issue, request.user), pk=comment_id, actor=request.user)

    def patch(self, request, slug, project_id, issue_id, comment_id):
        comment = self.own_comment(request, slug, project_id, issue_id, comment_id)
        values = TextSerializer(data=request.data)
        values.is_valid(raise_exception=True)
        comment.comment_html = str(format_html("<p>{}</p>", values.validated_data["text"]))
        comment.edited_at = timezone.now()
        comment.save()
        return Response(comment_data(comment, request.user))

    def delete(self, request, slug, project_id, issue_id, comment_id):
        self.own_comment(request, slug, project_id, issue_id, comment_id).delete()
        return Response(status=204)


class PlayerReactionsEndpoint(PlayerActivityBase):
    def target(self, request, slug, project_id, issue_id, comment_id=None):
        issue = self.activity(request, slug, project_id, issue_id)
        if comment_id:
            comment = get_object_or_404(visible_comments(issue, request.user), pk=comment_id)
            return CommentReaction, {"comment": comment, "project": issue.project, "actor": request.user}
        return IssueReaction, {"issue": issue, "project": issue.project, "actor": request.user}

    def get(self, request, slug, project_id, issue_id, comment_id=None):
        model, target = self.target(request, slug, project_id, issue_id, comment_id)
        return Response(list(model.objects.filter(**target).values_list("reaction", flat=True)))

    def post(self, request, slug, project_id, issue_id, comment_id=None):
        model, target = self.target(request, slug, project_id, issue_id, comment_id)
        values = ReactionSerializer(data=request.data)
        values.is_valid(raise_exception=True)
        reaction, _ = model.objects.get_or_create(**target, reaction=values.validated_data["reaction"])
        return Response({"reaction": reaction.reaction}, status=201)

    def delete(self, request, slug, project_id, issue_id, comment_id=None):
        model, target = self.target(request, slug, project_id, issue_id, comment_id)
        values = ReactionSerializer(data=request.data)
        values.is_valid(raise_exception=True)
        model.objects.filter(**target, reaction=values.validated_data["reaction"]).delete()
        return Response(status=204)


class PlayerActivityMediaEndpoint(PlayerActivityBase):
    def get(self, request, slug, project_id, issue_id, package_id, artifact_id, artifact_path=None):
        issue = self.activity(request, slug, project_id, issue_id)
        if (package_id, artifact_id) not in media_references(issue):
            from rest_framework.exceptions import NotFound

            raise NotFound("Media not assigned to this activity.")
        if request.query_params:
            raise serializers.ValidationError("Media conversion/download actions are unavailable to players.")
        from plane.utils.player_media import assigned_media_response

        return assigned_media_response(request, project_id, package_id, artifact_id, artifact_path)


class PlayerRoleEndpoint(PlayerActivityBase):
    def get(self, request):
        from plane.db.models import ProjectMember, WorkspaceMember

        return Response(
            {
                "workspaces": list(
                    WorkspaceMember.objects.filter(member=request.user, role=1, is_active=True).values_list(
                        "workspace__slug", flat=True
                    )
                ),
                "projects": list(
                    ProjectMember.objects.filter(member=request.user, role=1, is_active=True).values_list(
                        "project_id", flat=True
                    )
                ),
                "project_workspaces": list(
                    ProjectMember.objects.filter(member=request.user, role=1, is_active=True)
                    .values_list("workspace__slug", flat=True)
                    .distinct()
                ),
            }
        )


class PlayerStageHistoryEndpoint(PlayerActivityBase):
    def get(self, request, slug, project_id):
        player = get_object_or_404(_eligible_roster(request.user), project_id=project_id, project__workspace__slug=slug)
        query = PlayerProgramQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        limit, offset = query.validated_data["limit"], query.validated_data["offset"]
        legacy = Q(coaching_card_data__recipient_ids__isnull=True) | Q(coaching_card_data__recipient_ids=None)
        cards = Issue.issue_objects.filter(
            Q(coaching_card_data__recipient_ids__contains=[str(player.id)]) | (legacy & Q(roster_player_id=player.id)),
            project_id=project_id,
            workspace_id=player.workspace_id,
            category=COACHING_CARD_CATEGORY,
            archived_at__isnull=True,
        )
        history = (
            CardStageHistory.objects.filter(issue_id__in=cards.values("id"))
            # Shared-card reviews by another assigned player stay out of this account's feed.
            .filter(
                Q(changed_by=request.user) | Q(changed_by_id=F("issue__created_by_id")) | Q(changed_by__isnull=True)
            )
            .select_related("issue", "changed_by")
            .order_by("-changed_at", "-id")
        )
        total = history.count()
        results = [
            {
                "id": str(event.id),
                "card": {"id": str(event.issue_id), "title": event.issue.name, "sequence_id": event.issue.sequence_id},
                "actor": (
                    {
                        "id": str(event.changed_by_id),
                        "display_name": event.changed_by.display_name or "Coach",
                        "avatar_url": event.changed_by.avatar_url,
                    }
                    if event.changed_by_id
                    else None
                ),
                "from_stage": event.from_stage_name,
                "to_stage": event.to_stage_name,
                "changed_at": event.changed_at.isoformat(),
                "reason": event.reason,
            }
            for event in history[offset : offset + limit]
        ]
        return Response(
            {"project_id": str(project_id), "total_count": total, "limit": limit, "offset": offset, "results": results},
            headers={"Cache-Control": "private, no-store"},
        )
