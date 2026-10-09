"""Coaching evidence associations. No media files are modified by these operations."""
from copy import deepcopy
from math import isfinite
from urllib.parse import urlsplit
from uuid import uuid4

CLIP_TYPES = (
    "original", "game_film", "practice_check", "verified_on_film", "coach_added",
    "player_submitted", "reference", "teaching", "scout", "comparison",
)


def normalize_card_clips(data):
    result = deepcopy(data or {})
    playlists = result.setdefault("playlists", [])
    primary = result.get("primary_clip") or {}
    if not any(playlist.get("clips") for playlist in playlists) and primary.get("source_url"):
        playlists.append({"id": primary.get("playlist_id") or "original", "name": "Original film", "clips": [{
            **primary, "id": primary.get("clip_id") or "original", "title": (result.get("summary") or {}).get("primary_clip_title") or "Original Clip",
        }]})
    primary_matched = False
    for pi, playlist in enumerate(playlists):
        for ci, clip in enumerate(playlist.get("clips") or []):
            clip.setdefault("association_id", f"legacy:{pi}:{ci}")
            matches = (primary.get("association_id") == clip["association_id"] if primary.get("association_id")
                       else primary.get("playlist_id") == playlist["id"] and primary.get("clip_id") == clip.get("id"))
            if matches and not primary_matched:
                # Legacy snapshots may keep the authoritative source only in primary_clip.
                for field in ("source_url", "start_seconds", "end_seconds", "media_id", "event_id"):
                    if primary.get(field) is not None and primary.get(field) != "":
                        clip[field] = primary[field]
                primary_matched = True
    return result


def validate_clip(clip):
    source = clip.get("source_url", "").strip()
    parsed = urlsplit(source)
    if not source or (parsed.scheme and parsed.scheme not in ("http", "https")) or source.startswith("//"):
        raise ValueError("Choose an HTTP/HTTPS video or a saved video source.")
    if parsed.scheme and not parsed.netloc:
        raise ValueError("Enter a valid video URL.")
    start = clip.get("start_seconds")
    end = clip.get("end_seconds")
    for value in (start, end):
        if value is not None and (not isinstance(value, (float, int)) or isinstance(value, bool) or not isfinite(value) or value < 0):
            raise ValueError("Clip timestamps must be finite and nonnegative.")
    if end is not None and end <= (start or 0):
        raise ValueError("Clip end must be after start.")
    if clip.get("clip_type", "coach_added") not in CLIP_TYPES:
        raise ValueError("Choose a supported clip type.")
    if end is not None:
        clip["duration_seconds"] = end - (start or 0)
    clip["source_url"] = source


def mutate_card_clips(data, operation, values, actor, created_at, association_id=None):
    result = normalize_card_clips(data)
    playlists = result["playlists"]
    all_clips = [(playlist, clip) for playlist in playlists for clip in playlist.get("clips", [])]
    if operation == "add":
        request_id = values.get("request_id")
        if any(clip.get("request_id") == request_id and request_id for _, clip in all_clips):
            return result
        if len(all_clips) >= 500:
            raise ValueError("This card has reached its clip limit.")
        clip = {**values, "association_id": str(uuid4()), "id": str(uuid4()), "created_by": actor, "created_at": created_at}
        clip.setdefault("clip_type", "coach_added")
        clip.setdefault("playback_mode", "source")
        clip["key"] = clip["association_id"]
        validate_clip(clip)
        playlist = next((item for item in playlists if item["id"] == "coaching-evidence"), None)
        if playlist is None:
            playlist = {"id": "coaching-evidence", "name": "Coaching evidence", "clips": []}
            playlists.append(playlist)
        playlist["clips"].append(clip)
    else:
        match = next(((playlist, clip) for playlist, clip in all_clips if clip["association_id"] == association_id), None)
        if match is None:
            raise KeyError(association_id)
        playlist, clip = match
        if operation == "remove":
            playlist["clips"].remove(clip)
        elif operation == "edit":
            protected = {"created_by", "created_at", "association_id", "id", "key", "request_id"}
            clip.update({key: value for key, value in values.items() if key not in protected})
            if "end_seconds" in values and values["end_seconds"] is None:
                clip["duration_seconds"] = None
            validate_clip(clip)
        else:
            raise ValueError("Unsupported clip action.")
    result["playlists"] = [playlist for playlist in playlists if playlist.get("clips")]
    remaining = [(playlist, clip) for playlist in result["playlists"] for clip in playlist["clips"]]
    primary = result.get("primary_clip") or {}
    selected = next(((playlist, clip) for playlist, clip in remaining
                     if (primary.get("association_id") and primary["association_id"] == clip["association_id"])
                     or (not primary.get("association_id") and primary.get("playlist_id") == playlist["id"] and primary.get("clip_id") == clip["id"])), None)
    selected = selected or (remaining[0] if remaining else None)
    summary = result.setdefault("summary", {})
    summary.update(playlist_count=len(result["playlists"]), clip_count=len(remaining))
    if selected:
        playlist, clip = selected
        result["primary_clip"] = {
            "playlist_id": playlist["id"], "clip_id": clip["id"], "association_id": clip["association_id"],
            **{key: clip.get(key) for key in ("media_id", "event_id", "source_url", "start_seconds", "end_seconds")},
        }
        summary.update(primary_thumbnail=clip.get("thumbnail"), primary_clip_title=clip.get("title", "Clip"))
    else:
        result["primary_clip"] = None
        summary.update(primary_thumbnail=None, primary_clip_title="")
    return result
