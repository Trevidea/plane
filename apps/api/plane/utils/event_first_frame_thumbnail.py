"""Read or create a cached first-stream poster using only persisted stream names."""

import json
import re
from hashlib import sha256
from urllib import error as urlerror, request as urlrequest
from urllib.parse import urlsplit

_MAX_IMAGE_BYTES = 2 * 1024 * 1024
_STREAM_NAME = re.compile(r"^[A-Za-z0-9_-]{1,180}$")


def _record(value):
    return value if isinstance(value, dict) else {}


def resolve_event_first_stream_name(meta, event_payload=None):
    event = _record(meta.get("event"))
    payload = _record(event_payload)
    sources = [
        event,
        _record(event.get("rawEvent")),
        payload,
        _record(payload.get("rawEvent")),
        meta,
        _record(meta.get("rawEvent")),
    ]
    for source in sources:
        for key in ("primaryStreamName", "primary_stream_name", "streamName", "stream_name"):
            if source.get(key):
                return source[key]
    for source in sources:
        for key in ("devices", "mediaReferences", "media_references"):
            entries = source.get(key)
            if not isinstance(entries, list):
                continue
            for entry in entries:
                entry = _record(entry)
                name = entry.get("streamName") or entry.get("stream_name") or entry.get("original_stream_name")
                if name:
                    return name
    return ""


def _http_base(value):
    if not isinstance(value, str):
        return ""
    try:
        parsed = urlsplit(value)
    except ValueError:
        return ""
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.netloc
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        return ""
    return value.rstrip("/")


def get_event_first_frame_thumbnail(
    *, meta, event_payload, identity, worker_base, hls_base, timeout=10, token=""
):
    stream_name = resolve_event_first_stream_name(_record(meta), event_payload)
    if not isinstance(stream_name, str) or not _STREAM_NAME.fullmatch(stream_name):
        return None
    worker_base, hls_base = _http_base(worker_base), _http_base(hls_base)
    if not worker_base or not hls_base:
        return None
    digest = sha256(json.dumps([*identity, stream_name], separators=(",", ":")).encode()).hexdigest()
    filename = f"event-first-frame-{digest}.jpg"
    image_url = f"{worker_base}/thumbnails/{filename}"
    headers = {"Authorization": f"Bearer {token}"} if token else {}

    def read_image():
        request = urlrequest.Request(image_url, headers=headers, method="GET")
        with urlrequest.urlopen(request, timeout=timeout) as response:
            image = response.read(_MAX_IMAGE_BYTES + 1)
            content_type = response.headers.get("Content-Type", "").split(";", 1)[0]
            if content_type != "image/jpeg" or not image.startswith(b"\xff\xd8\xff") or len(image) > _MAX_IMAGE_BYTES:
                return None
            return image

    try:
        try:
            return read_image()
        except urlerror.HTTPError as exc:
            if exc.code != 404:
                return None
        payload = {
            "url": f"{hls_base}/{stream_name}/llhls.m3u8",
            "timestamp": 0,
            "first_segment": True,
            "filename": filename,
        }
        request = urlrequest.Request(
            f"{worker_base}/thumbnail",
            data=json.dumps(payload).encode(),
            headers={**headers, "Content-Type": "application/json"},
            method="POST",
        )
        with urlrequest.urlopen(request, timeout=timeout) as response:
            response.read(1024)
        return read_image()
    except (urlerror.URLError, OSError, ValueError):
        return None
