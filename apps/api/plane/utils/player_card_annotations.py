"""Read only the saved drawings needed for an already-authorized coaching card."""

import json
from copy import deepcopy
from math import isfinite
from pathlib import Path
from uuid import UUID

from rest_framework.exceptions import ValidationError

from plane.db.models import Issue
from plane.utils.media_library import project_root, read_manifest, resolve_artifact_metadata

DRAWING_TYPES = {"text", "rectangle", "ellipse", "line", "arrow", "pen"}
MAX_FILE_BYTES = 5 * 1024 * 1024


def _number(value):
    return type(value) in (int, float) and isfinite(value)


def _readable(path, root):
    resolved = path.resolve()
    return resolved.is_relative_to(root) and resolved.is_file() and resolved.stat().st_size <= MAX_FILE_BYTES


def _project_events(project_id, root, cache):
    key = ("manifest-index", str(project_id))
    if key in cache:
        return cache[key]
    index = {}
    cache[key] = index
    packages = root / "packages"
    if not packages.is_dir():
        return index
    remaining = 16 * 1024 * 1024
    for package in sorted(packages.iterdir())[:64]:
        manifest_file = package / "manifest.json"
        try:
            if not _readable(manifest_file, root):
                continue
            size = manifest_file.stat().st_size
            if size > remaining:
                continue
            remaining -= size
            manifest = read_manifest(manifest_file)
            for artifact in manifest.get("artifacts", [])[:2000]:
                if not isinstance(artifact, dict) or artifact.get("format") != "json":
                    continue
                meta = resolve_artifact_metadata(artifact, manifest.get("metadata"))
                source_id = str(artifact.get("work_item_id") or meta.get("work_item_id"))
                index.setdefault(source_id, []).append((artifact, meta))
        except (OSError, ValueError, TypeError, AttributeError, ValidationError):
            continue
    return index


def _event_data(card, cache):
    source_id = ((card.coaching_card_data or {}).get("source_issue") or {}).get("id")
    try:
        source_id = str(UUID(str(source_id)))
    except (ValueError, TypeError, AttributeError):
        return None
    key = (str(card.project_id), source_id)
    if key in cache:
        return cache[key]
    cache[key] = None
    if not Issue.issue_objects.filter(pk=source_id, project_id=card.project_id).exists():
        return None
    root = project_root(str(card.project_id)).resolve()
    for artifact, meta in _project_events(card.project_id, root, cache).get(source_id, []):
        try:
            # Persisted local artifact paths only. No URL fetch or generic library grant.
            raw_path = artifact.get("path")
            if not isinstance(raw_path, str) or "://" in raw_path:
                continue
            path = Path(raw_path)
            if not path.is_absolute():
                path = root.parent.parent / path
            if not _readable(path, root):
                continue
            remaining = cache.setdefault("event-read-budget", 16 * 1024 * 1024)
            size = path.stat().st_size
            if size > remaining:
                continue
            cache["event-read-budget"] -= size
            payload = json.loads(path.read_text(encoding="utf-8-sig"))
            if isinstance(payload, dict):
                cache[key] = (meta, payload)
                return cache[key]
        except (OSError, ValueError, TypeError, AttributeError, ValidationError):
            continue
    return None


def _records(meta, payload):
    return [
        value
        for value in (
            payload,
            meta,
            meta.get("event"),
            meta.get("rawEvent"),
            meta.get("raw_event"),
            payload.get("event"),
            payload.get("rawEvent"),
        )
        if isinstance(value, dict)
    ]


def _playlist_annotations(records, playlist_id):
    view = f"custom-playlist:{playlist_id}"
    for source in records:
        for key in ("customPlaylistAnnotations", "custom_playlist_annotations"):
            collection = source.get(key)
            if isinstance(collection, dict):
                entry = collection.get(playlist_id)
                if (
                    isinstance(entry, dict)
                    and entry.get("annotationViewKey", entry.get("annotation_view_key", view)) == view
                ):
                    if isinstance(entry.get("annotations"), list):
                        return entry["annotations"]
            elif isinstance(collection, list):
                for entry in collection[:500]:
                    if (
                        isinstance(entry, dict)
                        and entry.get("annotationViewKey", entry.get("annotation_view_key")) == view
                    ):
                        if isinstance(entry.get("annotations"), list):
                            return entry["annotations"]
        for key in ("mediaReferences", "media_references", "devices"):
            for entry in source.get(key, []) if isinstance(source.get(key), list) else []:
                if isinstance(entry, dict) and entry.get("annotationViewKey", entry.get("annotation_view_key")) == view:
                    if isinstance(entry.get("annotations"), list):
                        return entry["annotations"]
    return None


def _saved_playlist(records, playlist_id):
    for record in records:
        for playlist in record.get("custom_playlists", []) if isinstance(record.get("custom_playlists"), list) else []:
            if isinstance(playlist, dict) and playlist.get("id") == playlist_id:
                return playlist
    return None


def _playlist_offset(playlist, clip):
    offset = 0
    for saved in playlist.get("clips", [])[:500]:
        if not isinstance(saved, dict):
            return None
        if saved.get("id") == clip.get("id"):
            expected_source = saved.get("sourceUrl") or playlist.get("url")
            if expected_source and expected_source != clip.get("source_url"):
                return None
            for saved_key, key in (("mediaId", "media_id"), ("streamId", "stream_id")):
                if saved.get(saved_key) and saved[saved_key] != clip.get(key):
                    return None
            # Changed trims no longer identify the same annotation segment.
            for saved_key, key in (("startSeconds", "start_seconds"), ("endSeconds", "end_seconds")):
                if saved.get(saved_key) is not None and saved[saved_key] != clip.get(key):
                    return None
            return offset
        duration = saved.get("durationSeconds")
        if not _number(duration) or duration <= 0:
            start, end = saved.get("startSeconds"), saved.get("endSeconds")
            if not _number(start) or not _number(end) or end <= start:
                return None
            duration = end - start
        offset += duration
    return None


def _playlist_duration(playlist):
    total = 0
    for clip in playlist.get("clips", [])[:500]:
        if not isinstance(clip, dict):
            return None
        duration = clip.get("durationSeconds")
        if not _number(duration) or duration <= 0:
            start, end = clip.get("startSeconds"), clip.get("endSeconds")
            if not _number(start) or not _number(end) or end <= start:
                return None
            duration = end - start
        total += duration
    return total


def _unique_stream_id(records):
    identities = set()
    for record in records:
        for key in ("mediaReferences", "media_references", "devices"):
            for entry in record.get(key, []) if isinstance(record.get(key), list) else []:
                if not isinstance(entry, dict):
                    continue
                if str(entry.get("annotationViewKey", entry.get("annotation_view_key", ""))).startswith(
                    "custom-playlist:"
                ):
                    continue
                stream_id = entry.get("streamId", entry.get("stream_id"))
                if not stream_id:
                    # Cameras identified only by stream name/device/preview URL
                    # make inference ambiguous, even if another camera has an ID.
                    return None
                identities.add(str(stream_id))
    return next(iter(identities)) if len(identities) == 1 else None


def _stream_annotations(records, clip):
    stream_id, source_url = clip.get("stream_id"), clip.get("source_url")
    for record in records:
        for key in ("mediaReferences", "media_references", "devices"):
            for entry in record.get(key, []) if isinstance(record.get(key), list) else []:
                if not isinstance(entry, dict):
                    continue
                view = entry.get("annotationViewKey", entry.get("annotation_view_key", ""))
                if str(view).startswith("custom-playlist:"):
                    continue
                matches = stream_id and str(entry.get("streamId", entry.get("stream_id"))) == str(stream_id)
                if not stream_id and source_url:
                    matches = source_url in [
                        entry.get(k)
                        for k in ("hlsUrl", "hls_url", "videoSrc", "videoUrl", "video_url", "source_url", "sourceUrl")
                    ]
                if matches and isinstance(entry.get("annotations"), list):
                    return entry["annotations"]
    return []


def _drawings(annotations, start, end, offset, cache):
    if cache.setdefault("annotation-bytes", 1024 * 1024) <= 0:
        return []
    result = []
    for annotation in annotations[:1000]:
        if not isinstance(annotation, dict) or annotation.get("type") not in DRAWING_TYPES:
            continue
        begin, finish = annotation.get("startTime"), annotation.get("endTime")
        if not _number(begin) or not _number(finish) or not 0 <= begin < finish:
            continue
        begin, finish = max(start, begin + offset), min(end, finish + offset)
        if finish <= begin or not isinstance(annotation.get("id"), str):
            continue
        drawing = {"id": annotation["id"][:255], "type": annotation["type"], "startTime": begin, "endTime": finish}
        for key in ("x", "y", "width", "height", "rotation", "strokeWidth"):
            if _number(annotation.get(key)):
                drawing[key] = annotation[key]
        for key in ("content", "color"):
            if isinstance(annotation.get(key), str):
                drawing[key] = annotation[key][:4096]
        style = annotation.get("style")
        if isinstance(style, dict):
            drawing["style"] = {
                k: v
                for k, v in style.items()
                if k in {"stroke", "strokeWidth", "strokeStyle", "color", "fill", "fontSize", "fontWeight", "opacity"}
                and ((_number(v)) or isinstance(v, str) and len(v) <= 128)
            }
        if isinstance(annotation.get("points"), list):
            drawing["points"] = [
                {"x": p["x"], "y": p["y"]}
                for p in annotation["points"][:700]
                if isinstance(p, dict) and _number(p.get("x")) and _number(p.get("y"))
            ]
        size = len(json.dumps(drawing, ensure_ascii=False, allow_nan=False).encode("utf-8"))
        if size > cache["annotation-bytes"]:
            break
        cache["annotation-bytes"] -= size
        result.append(drawing)
        if len(result) >= 256:
            break
    return result


def player_card_annotations(card, cache=None):
    """Keep source/recording clocks intact; do not mutate the stored card snapshot."""
    data = deepcopy(card.coaching_card_data or {})
    cache = cache if cache is not None else {}
    event = _event_data(card, cache)
    if event is None:
        return data
    records = _records(*event)
    for playlist in data.get("playlists", []):
        saved = _saved_playlist(records, playlist.get("id"))
        annotations = _playlist_annotations(records, playlist.get("id"))
        if annotations is None and saved and isinstance(saved.get("annotations"), list):
            annotations = saved["annotations"]
        for clip in playlist.get("clips", []):
            if clip.get("source_media") or data.get("source_media"):
                continue
            start, end = clip.get("start_seconds"), clip.get("end_seconds")
            if not _number(start) or not _number(end) or end <= start:
                continue
            offset = _playlist_offset(saved, clip) if saved else None
            source_matches = saved and saved.get("url") == clip.get("source_url") and offset is not None
            if source_matches and not clip.get("playback_mode"):
                total = _playlist_duration(saved)
                if total:
                    clip["playlist_start_seconds"] = offset
                    clip["playlist_duration_seconds"] = total
            if "annotations" in clip:
                continue
            if annotations:
                clip["annotations"] = (
                    _drawings(annotations, start, end, start - offset, cache) if offset is not None else []
                )
            else:
                stream_clip = clip
                if not clip.get("stream_id") and source_matches:
                    stream_id = _unique_stream_id(records)
                    if stream_id:
                        stream_clip = {**clip, "stream_id": stream_id}
                clip["annotations"] = _drawings(_stream_annotations(records, stream_clip), start, end, 0, cache)
    return data
