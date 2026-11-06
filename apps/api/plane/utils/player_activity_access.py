"""Explicit assignments and privacy-safe player activity responses."""

from django.db.models import Q
from django.utils.html import strip_tags

from plane.db.models import (
    Issue,
    IssueAssignee,
    IssueComment,
    PlayerActivityProgress,
    Project,
    ProjectMember,
    RosterPlayer,
    WorkspaceMember,
)


def player_programs(user):
    if not user.is_active or user.is_bot:
        return Project.objects.none()
    active_workspaces = WorkspaceMember.objects.filter(member=user, is_active=True).values("workspace_id")
    roster = RosterPlayer.objects.filter(
        user=user, status__in=["active", "injured"], workspace_id__in=active_workspaces
    ).values("project_id")
    joined = ProjectMember.objects.filter(member=user, is_active=True, workspace_id__in=active_workspaces).values(
        "project_id"
    )
    return (
        Project.objects.filter(
            Q(pk__in=roster) | Q(pk__in=joined),
            workspace_id__in=active_workspaces,
            archived_at__isnull=True,
            workspace__deleted_at__isnull=True,
        )
        .select_related("workspace")
        .distinct()
    )


def player_activities(user):
    programs = player_programs(user)
    assigned = Q(pk__in=IssueAssignee.objects.filter(assignee=user).values("issue_id")) & ~Q(category="Coaching Card")
    legacy_recipients = (
        Q(coaching_card_data__recipient_ids__isnull=True)
        | Q(coaching_card_data__recipient_ids=None)
        | Q(coaching_card_data__recipient_ids=[])
    )
    for player in RosterPlayer.objects.filter(user=user, project_id__in=programs, status__in=["active", "injured"]):
        assigned |= Q(project_id=player.project_id, category="Coaching Card") & (
            (Q(roster_player=player) & legacy_recipients)
            | Q(coaching_card_data__recipient_ids__contains=[str(player.id)])
        )
    return (
        Issue.issue_objects.filter(assigned, project_id__in=programs, archived_at__isnull=True)
        .select_related("project__workspace", "state")
        .distinct()
    )


def progress_data(progress):
    return {
        "percent": progress.percent if progress else 0,
        "note": progress.note if progress else "",
        "completed_at": progress.completed_at.isoformat() if progress and progress.completed_at else None,
    }


def media_references(issue):
    data = issue.coaching_card_data or {}
    references = [data.get("source_media")]
    references.extend(
        clip.get("source_media") for playlist in data.get("playlists", []) for clip in playlist.get("clips", [])
    )
    return {
        (str(value["package_id"]), str(value["artifact_id"]))
        for value in references
        if isinstance(value, dict) and value.get("package_id") and value.get("artifact_id")
    }


def activity_data(issue, user):
    data = issue.coaching_card_data or {}
    base = f"/api/player/workspaces/{issue.project.workspace.slug}/projects/{issue.project_id}/activities/{issue.id}/"
    clips = []
    playlists = data.get("playlists") or []
    if not playlists and data.get("primary_clip"):
        primary = data["primary_clip"]
        playlists = [
            {
                "clips": [
                    {
                        **primary,
                        "id": primary.get("clip_id"),
                        "title": (data.get("summary") or {}).get("primary_clip_title") or "Clip",
                    }
                ]
            }
        ]
    for playlist in playlists:
        for index, clip in enumerate(playlist.get("clips", [])):
            media = clip.get("source_media") or (
                data.get("source_media")
                if (data.get("source_media") or {}).get("artifact_id") == clip.get("id")
                else None
            )
            source = clip.get("source_url") or ""
            if media and media.get("package_id") and media.get("artifact_id"):
                from urllib.parse import quote

                source = (
                    base
                    + "media/"
                    + quote(str(media["package_id"]), safe="")
                    + "/"
                    + quote(str(media["artifact_id"]), safe="")
                    + "/"
                )
                from plane.utils.player_media import is_hls_reference

                if is_hls_reference(issue.project_id, str(media["package_id"]), str(media["artifact_id"])):
                    # A fragment selects the HLS player without exposing a generic
                    # media-library URL or changing the authenticated request path.
                    source += "#video.m3u8"
            clips.append(
                {
                    "key": str(clip.get("association_id") or clip.get("id") or index),
                    "title": clip.get("title") or "Clip",
                    "sourceUrl": source,
                    "startSeconds": clip.get("start_seconds") or 0,
                    "endSeconds": clip.get("end_seconds"),
                    "durationSeconds": clip.get("duration_seconds"),
                    "playbackMode": clip.get("playback_mode"),
                    "sourceStartSeconds": clip.get("source_start_seconds"),
                }
            )
    progress = PlayerActivityProgress.objects.filter(issue=issue, user=user).first()
    return {
        "id": str(issue.id),
        "name": issue.name,
        "category": issue.category,
        "description": strip_tags(issue.description_html or ""),
        "feedback": data.get("feedback") or "",
        "clips": clips,
        "project": {
            "id": str(issue.project_id),
            "name": issue.project.name,
            "workspace_slug": issue.project.workspace.slug,
        },
        "state": {"id": str(issue.state_id), "name": issue.state.name} if issue.state_id else None,
        "target_date": issue.target_date,
        "progress": progress_data(progress),
    }


def visible_comments(issue, user):
    # Player comments and coach-shared feedback only: internal notes stay internal.
    staff = ProjectMember.objects.filter(
        project=issue.project,
        is_active=True,
        role__in=[15, 20],
        member_id__in=WorkspaceMember.objects.filter(
            workspace=issue.workspace, is_active=True, role__in=[15, 20]
        ).values("member_id"),
    ).values("member_id")
    return (
        IssueComment.objects.filter(issue=issue)
        .filter(Q(actor=user) | Q(actor_id__in=staff, access="EXTERNAL"))
        .select_related("actor")
        .order_by("created_at", "id")
    )


def comment_data(comment, user):
    return {
        "id": str(comment.id),
        "text": comment.comment_stripped,
        "author": comment.actor.display_name if comment.actor else "Coach",
        "is_own": comment.actor_id == user.id,
        "created_at": comment.created_at.isoformat(),
    }
