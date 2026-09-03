import json
import os
import re
import tempfile
from pathlib import Path

from django.conf import settings
from django.db import migrations
from django.utils import timezone


CUSTOM_PLAYLISTS_METADATA_KEY = "custom_playlists"
METADATA_REF_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")
EVENT_ID_KEYS = ("sg_event_id", "sgEventId", "event_id", "eventId", "plane_event_id", "planeEventId")


def _metadata_ref(artifact):
    for key in ("metadata_ref", "name"):
        value = artifact.get(key)
        if isinstance(value, str) and value.strip() and METADATA_REF_PATTERN.match(value.strip()):
            return value.strip()
    return None


def _artifact_metadata(manifest, artifact):
    resolved_meta = {}
    metadata = manifest.get("metadata")
    ref = _metadata_ref(artifact)
    if isinstance(metadata, dict) and ref and isinstance(metadata.get(ref), dict):
        resolved_meta.update(metadata[ref])

    inline_meta = artifact.get("meta")
    if isinstance(inline_meta, dict):
        resolved_meta.update(inline_meta)
    return resolved_meta


def _event_ids(metadata):
    if not isinstance(metadata, dict):
        return set()
    values = set()
    for key in EVENT_ID_KEYS:
        value = metadata.get(key)
        if isinstance(value, (list, tuple, set)):
            values.update(str(item).strip() for item in value if item not in (None, ""))
        elif value not in (None, ""):
            values.add(str(value).strip())
    for nested_key in ("event", "rawEvent", "raw_event"):
        nested_metadata = metadata.get(nested_key)
        if isinstance(nested_metadata, dict):
            values.update(_event_ids(nested_metadata))
    return values


def _read_manifest(path):
    try:
        with path.open("r", encoding="utf-8-sig") as handle:
            manifest = json.load(handle)
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Unable to read media-library manifest {path}: {exc}") from exc

    if not isinstance(manifest, dict) or not isinstance(manifest.get("artifacts"), list):
        raise RuntimeError(f"Media-library manifest {path} has an invalid artifacts collection.")
    return manifest


def _load_manifests():
    root = Path(settings.MEDIA_LIBRARY_ROOT)
    manifest_paths = sorted((root / "projects").glob("*/packages/*/manifest.json")) if root.exists() else []
    return [(path, _read_manifest(path)) for path in manifest_paths]


def _find_target_manifest(manifests, event_id, issue_ids):
    event_id_text = str(event_id)
    best_match = None
    best_score = -1

    for path, manifest in manifests:
        for artifact in manifest.get("artifacts", []):
            if not isinstance(artifact, dict):
                continue
            metadata = _artifact_metadata(manifest, artifact)
            work_item_id = str(artifact.get("work_item_id") or metadata.get("work_item_id") or "")
            matches_issue = work_item_id in issue_ids if issue_ids else False
            matches_event = event_id_text in _event_ids(metadata)
            if not matches_issue and not matches_event:
                continue

            score = 100 if matches_issue else 50
            format_value = str(artifact.get("format") or "").lower()
            artifact_type = str(metadata.get("artifact_type") or "").lower()
            source = str(metadata.get("source") or "").lower()
            if artifact_type == "completed-event-json":
                score += 40
            if source == "plane-coach":
                score += 20
            if format_value == "json":
                score += 20
            if "event" in str(artifact.get("name") or "").lower():
                score += 10
            if score > best_score:
                ref = _metadata_ref(artifact)
                if ref:
                    best_match = (path, ref)
                    best_score = score

    return best_match


def _isoformat(value):
    return value.isoformat() if value else None


def _playlist_payload(playlist):
    return {
        "id": str(playlist.id),
        "event_id": playlist.event_id,
        "name": playlist.name,
        "subtitle": playlist.subtitle,
        "url": playlist.url,
        "thumbnail": playlist.thumbnail,
        "clip": playlist.clip,
        "clips": playlist.clips if isinstance(playlist.clips, list) else [],
        "created_at": _isoformat(playlist.created_at),
        "updated_at": _isoformat(playlist.updated_at),
    }


def _write_manifest(path, manifest):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary_path = tempfile.mkstemp(dir=path.parent, prefix=f"{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(manifest, handle, indent=2)
            handle.write("\n")
        os.replace(temporary_path, path)
    finally:
        if os.path.exists(temporary_path):
            os.remove(temporary_path)


def move_custom_playlists_to_artifact_metadata(apps, schema_editor):
    CustomPlaylist = apps.get_model("db", "CustomPlaylist")
    Issue = apps.get_model("db", "Issue")
    database_alias = schema_editor.connection.alias

    # ``deleted_at`` is the soft-delete marker from the legacy model.  Do not
    # resurrect playlists that users had already deleted when the table is
    # removed.
    playlists = list(
        CustomPlaylist.objects.using(database_alias)
        .filter(deleted_at__isnull=True)
        .order_by("-created_at")
    )
    if not playlists:
        return

    issue_ids_by_event = {}
    for issue_id, event_id in (
        Issue._default_manager.using(database_alias)
        .filter(sg_event_id__isnull=False)
        .values_list("id", "sg_event_id")
    ):
        issue_ids_by_event.setdefault(str(event_id), set()).add(str(issue_id))

    manifests = _load_manifests()
    updates = {}
    unresolved_playlist_ids = []
    for playlist in playlists:
        event_id = str(playlist.event_id)
        target = _find_target_manifest(manifests, event_id, issue_ids_by_event.get(event_id, set()))
        if not target:
            unresolved_playlist_ids.append(str(playlist.id))
            continue

        path, metadata_ref = target
        updates.setdefault(path, {}).setdefault(metadata_ref, []).append(_playlist_payload(playlist))

    if unresolved_playlist_ids:
        unresolved = ", ".join(unresolved_playlist_ids)
        media_library_root = str(Path(settings.MEDIA_LIBRARY_ROOT))
        raise RuntimeError(
            "Could not map custom playlists to event artifact metadata. "
            "Ensure the migrator can read the shared media-library volume and create or repair the "
            f"matching artifacts before migrating (MEDIA_LIBRARY_ROOT={media_library_root}): {unresolved}"
        )

    manifests_by_path = {path: manifest for path, manifest in manifests}
    for path, metadata_updates in updates.items():
        manifest = manifests_by_path[path]
        metadata = manifest.setdefault("metadata", {})
        if not isinstance(metadata, dict):
            metadata = {}
            manifest["metadata"] = metadata

        for metadata_ref, playlists_to_add in metadata_updates.items():
            event_metadata = metadata.setdefault(metadata_ref, {})
            if not isinstance(event_metadata, dict):
                event_metadata = {}
                metadata[metadata_ref] = event_metadata
            existing_playlists = event_metadata.get(CUSTOM_PLAYLISTS_METADATA_KEY)
            existing_playlists = existing_playlists if isinstance(existing_playlists, list) else []
            existing_ids = {str(item.get("id")) for item in existing_playlists if isinstance(item, dict)}
            event_metadata[CUSTOM_PLAYLISTS_METADATA_KEY] = existing_playlists + [
                playlist for playlist in playlists_to_add if playlist["id"] not in existing_ids
            ]

        manifest["updatedAt"] = timezone.now().replace(microsecond=0).isoformat().replace("+00:00", "Z")
        _write_manifest(path, manifest)


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0123_workspace_date_format"),
    ]

    operations = [
        migrations.RunPython(move_custom_playlists_to_artifact_metadata, migrations.RunPython.noop),
        migrations.DeleteModel(
            name="CustomPlaylist",
        ),
    ]
