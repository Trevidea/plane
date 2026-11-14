"""Public shared-content projections for the User role's normal Plane UI.

Only the explicit read opt-ins invoke this projection. Player-owned APIs retain
their own participant-specific payloads.
"""

from urllib.parse import quote

_PRIVATE_KEYS = {
    "email",
    "account_email",
    "source_email",
    "recipient_email",
    "account_status",
    "viewed_by",
    "progress",
    "personal_progress",
    "player_progress",
    "source_data",
    "snapshot",
    "snapshots",
    "activity_snapshot",
    "old_value",
    "new_value",
    "old_identifier",
    "new_identifier",
    "extra",
    "auth",
    "authorization",
    "headers",
    "token",
    "access_token",
    "refresh_token",
    "api_key",
    "password",
    "credentials",
    "internal_token",
    "upstream_headers",
    "transcode_job",
    "transcode_jobs",
    "user_id",
    "account_id",
    "recipient_user_id",
    "cookie",
    "cookies",
    "source_snapshot",
    "current_instance",
    "requested_data",
    "actor_email",
    "storage_metadata",
    "issue_relation",
    "issue_related",
    "related_issue_detail",
}
_ROSTER_FIELDS = {"id", "program_id", "player_name", "jersey_number", "position", "height", "weight", "class_year"}


def sanitize_shared_data(data):
    """Copy JSON data while dropping personal state and upstream credentials."""
    if isinstance(data, (list, tuple)):
        return [sanitize_shared_data(value) for value in data]
    if not isinstance(data, dict):
        return data
    result = {}
    for key, value in data.items():
        normalized = str(key).lower().replace("-", "_")
        if (
            normalized in _PRIVATE_KEYS
            or normalized.endswith("email")
            or any(part in normalized for part in ("secret", "password", "token", "upstream", "snapshot"))
        ):
            continue
        if key == "recipients" and isinstance(value, list):
            result[key] = [
                {field: recipient[field] for field in ("id", "name", "jersey_number", "position") if field in recipient}
                for recipient in value
                if isinstance(recipient, dict)
            ]
        else:
            result[key] = sanitize_shared_data(value)
    return result


_MEDIA_META_FIELDS = {
    "title",
    "description",
    "name",
    "category",
    "sport",
    "program",
    "season",
    "level",
    "coach",
    "author",
    "creator",
    "tags",
    "docs",
    "itemsCount",
    "items_count",
    "views",
    "duration",
    "duration_seconds",
    "artifact_type",
    "source",
    "section",
    "batch_id",
    "batchId",
    "annotations",
    "event_id",
    "work_item_id",
    "width",
    "height",
    "size",
    "created_at",
    "updated_at",
    "thumbnail",
    "stream_name",
    "streamName",
}


def _media_projection(data, request, view):
    if isinstance(data, list):
        return [_media_projection(value, request, view) for value in data]
    if not isinstance(data, dict):
        return data
    result = {}
    for key, value in data.items():
        if key == "meta" and isinstance(value, dict):
            value = {field: item for field, item in value.items() if field in _MEDIA_META_FIELDS}
        elif key == "metadata" and isinstance(value, dict):
            value = {
                ref: {field: item for field, item in meta.items() if field in _MEDIA_META_FIELDS}
                for ref, meta in value.items()
                if isinstance(meta, dict)
            }
        result[key] = _media_projection(value, request, view)
    # Files remain accessible through the authorized app route; filesystem and
    # upstream URL credentials never have to be sent to the browser.
    if "path" in result and result.get("name"):
        kwargs = view.kwargs
        package = kwargs.get("package_id") or data.get("packageId")
        if not package:
            package = getattr(view, "_readonly_package_id", None)
        if package:
            result["path"] = (
                f"/api/workspaces/{quote(str(kwargs['slug']), safe='')}/projects/{kwargs['project_id']}"
                f"/media-library/packages/{quote(str(package), safe='')}/artifacts/"
                f"{quote(str(result['name']), safe='')}/file/"
            )
        else:
            result.pop("path", None)
    return result


def sanitize_user_readonly_response(data, request, view):
    """Project an approved response; authorization is the caller's responsibility."""
    data = sanitize_shared_data(data)
    if type(view).__name__.startswith("Media"):
        if isinstance(data, dict):
            view._readonly_package_id = data.get("id")
        return _media_projection(data, request, view)
    if type(view).__name__ == "RosterPlayerViewSet":

        def roster(row):
            return {key: value for key, value in row.items() if key in _ROSTER_FIELDS}

        return [roster(row) for row in data] if isinstance(data, list) else roster(data)
    return data


def user_shared_assets(user, project_id):
    """Only files attached to accessible shared entities in the requested program."""
    from django.db.models import Q
    from plane.db.models import FileAsset

    return (
        FileAsset.objects.filter(project_id=project_id, is_archived=False, is_deleted=False, draft_issue__isnull=True)
        .filter(Q(issue__isnull=True) | Q(issue__project_id=project_id))
        .filter(
            Q(entity_type="PROJECT_COVER")
            | Q(
                entity_type__in=["ISSUE_DESCRIPTION", "ISSUE_ATTACHMENT"],
                issue__isnull=False,
                issue__project_id=project_id,
                issue__archived_at__isnull=True,
                issue__deleted_at__isnull=True,
            )
            | Q(
                entity_type="COMMENT_DESCRIPTION",
                comment__access="EXTERNAL",
                comment__deleted_at__isnull=True,
                comment__issue__archived_at__isnull=True,
                comment__issue__deleted_at__isnull=True,
                comment__project_id=project_id,
            )
            | (
                Q(
                    entity_type="PAGE_DESCRIPTION",
                    page__projects__id=project_id,
                    page__archived_at__isnull=True,
                    page__deleted_at__isnull=True,
                )
                & (Q(page__access=0) | Q(page__owned_by=user))
            )
        )
        .distinct()
    )
