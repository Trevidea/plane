"""Build a coaching-card snapshot from a saved uploaded video."""

from copy import deepcopy
from math import isfinite
from pathlib import PurePosixPath

VIDEO_FORMATS = {"mp4", "m3u8", "mov", "webm", "avi", "mkv", "mpeg", "mpg", "m4v"}
VIDEO_ACTIONS = {"play", "play_hls", "play_streaming", "open_mp4"}
GENERIC_FORMATS = {"", "application/octet-stream", "application", "video", "image", "binary", "octet-stream"}


def _text(value):
    return value.strip() if isinstance(value, str) else ""


def _duration(value):
    try:
        if isinstance(value, bool):
            return None
        if isinstance(value, str) and ":" in value:
            parts = [float(part) for part in value.split(":")]
            if not 2 <= len(parts) <= 3 or any(part < 0 or not isfinite(part) for part in parts):
                return None
            result = 0
            for part in parts:
                result = result * 60 + part
        else:
            result = float(value)
        return result if isfinite(result) and result >= 0 else None
    except (TypeError, ValueError, OverflowError):
        return None


def _valid_annotation(annotation):
    if not isinstance(annotation, dict) or not _text(annotation.get("id")) or not _text(annotation.get("type")):
        return False
    start, end = annotation.get("startTime"), annotation.get("endTime")
    return (
        type(start) in (int, float)
        and type(end) in (int, float)
        and isfinite(start)
        and isfinite(end)
        and 0 <= start < end
    )


def _path_has_video_extension(value):
    path = _text(value).split("?", 1)[0].split("#", 1)[0]
    return PurePosixPath(path).suffix.lstrip(".").lower() in VIDEO_FORMATS


def _is_video_artifact(artifact):
    format_value = _text(artifact.get("format")).lower().lstrip(".")
    action = _text(artifact.get("action")).lower()
    return (
        format_value in VIDEO_FORMATS
        or format_value in {"video", "stream"}
        or format_value.startswith("video/")
        or "mpegurl" in format_value
        or action in VIDEO_ACTIONS
        or (
            format_value in GENERIC_FORMATS
            and any(_path_has_video_extension(artifact.get(key)) for key in ("path", "name", "link"))
        )
    )


def choose_card_context_value(key, source_context, selected_context, fallback=""):
    if key in selected_context:
        return selected_context[key] or ""
    return source_context.get(key) or fallback or ""


def build_uploaded_video_card_source(artifact, metadata, package_id, thumbnail_url=None):
    if not _is_video_artifact(artifact):
        raise ValueError("Choose an uploaded video to create a card.")
    annotations = metadata.get("annotations")
    if annotations is None:
        annotations = []
    if not isinstance(annotations, list) or not all(map(_valid_annotation, annotations)):
        raise ValueError("Invalid saved video annotations.")
    artifact_id = artifact["name"]
    title = _text(artifact.get("title")) or "Uploaded video"
    playlist_id = f"uploaded-video:{artifact_id}"
    upload_metadata = {
        "category": _text(metadata.get("category")),
        "location": _text(metadata.get("location")),
        "sport": _text(metadata.get("sport")),
        "program": _text(metadata.get("program")),
        "level": _text(metadata.get("level")),
        "season": _text(metadata.get("season")) or _text(metadata.get("year")),
        "start_date": _text(metadata.get("start_date")),
        "start_time": _text(metadata.get("start_time")),
        "created_by": _text(metadata.get("created_by")),
        "tags": [_text(tag) for tag in metadata.get("tags", []) if _text(tag)]
        if isinstance(metadata.get("tags"), list)
        else [],
    }
    duration = next(
        (
            parsed
            for key in ("duration_seconds", "duration", "duration_sec", "durationSec")
            if (parsed := _duration(metadata.get(key))) is not None
        ),
        None,
    )
    return {
        "source_media": {
            "package_id": package_id,
            "artifact_id": artifact_id,
            "title": title,
            "annotations": deepcopy(annotations),
            "metadata": upload_metadata,
        },
        "playlists": [
            {
                "id": playlist_id,
                "name": title,
                "clips": [
                    {
                        "key": f"{playlist_id}:{artifact_id}",
                        "id": artifact_id,
                        "title": title,
                        "thumbnail": thumbnail_url,
                        "duration_seconds": duration,
                        "timecode": "",
                        "team": "",
                        "detail": "",
                        "result": "",
                        "secondary_detail": "",
                        "group": "",
                    }
                ],
            }
        ],
        "context": {
            "sport": upload_metadata["sport"],
            "level": upload_metadata["level"],
            "program": upload_metadata["program"],
            "season": upload_metadata["season"],
        },
    }
