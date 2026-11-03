"""Short-lived, assignment-scoped media delivery for linked players."""

import hashlib
import json
import mimetypes
import math
import re
from datetime import timedelta
from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urlsplit

from django.core import signing
from django.conf import settings
from django.db.models import Q
from django.http import HttpResponse, StreamingHttpResponse
from django.shortcuts import get_object_or_404
from django.urls import reverse
from django.utils import timezone
from rest_framework.exceptions import APIException, NotFound, PermissionDenied
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from plane.app.views.base import BaseAPIView
from plane.app.views.player import _eligible_roster
from plane.app.views.player_archive_media import stream_archive
from plane.db.models import Issue, User
from plane.utils.coaching_card import COACHING_CARD_CATEGORY
from plane.utils.coaching_card_clips import normalize_card_clips
from plane.utils.media_library import manifest_path, media_library_root, package_root, read_manifest, validate_segment

GRANT_SECONDS = 300
GRANT_SALT = "plane.player.card-media.v1"
HLS_EXTENSIONS = {".m3u8", ".ts", ".m4s", ".mp4", ".aac", ".key", ".vtt"}


class PlaybackChanged(APIException):
    status_code = 409
    default_detail = "This card changed. Refresh it before playing this clip."


class MediaSourceUnavailable(APIException):
    status_code = 422
    default_detail = "This clip's video source is unavailable. Contact your coach."


def _archived_playlist_url(filename):
    base = getattr(settings, "PLAYER_ARCHIVED_HLS_BASE_URL", "").strip()
    if not base:
        # The existing event/coach viewer serves saved playlist filenames under /hls/.
        event_api = urlsplit(getattr(settings, "SERVICE_GATEWAY_EVENT_API", ""))
        if event_api.username or event_api.password:
            raise MediaSourceUnavailable()
        base = f"{event_api.scheme}://{event_api.netloc}/hls"
    parsed = urlsplit(base)
    if (
        parsed.scheme != "https"
        or not parsed.netloc
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or any(part in {".", ".."} for part in parsed.path.split("/"))
        or "%" in parsed.path
        or "\\" in parsed.path
    ):
        raise MediaSourceUnavailable()
    return base.rstrip("/") + "/" + filename


def _assigned(user, slug, project_id, card_id):
    player = get_object_or_404(_eligible_roster(user), project_id=project_id, project__workspace__slug=slug)
    return get_object_or_404(
        Issue.issue_objects.filter(
            Q(roster_player=player) | Q(coaching_card_data__recipient_ids__contains=[str(player.id)]),
            project_id=project_id,
            category=COACHING_CARD_CATEGORY,
        ),
        pk=card_id,
    )


def _source(card, clip_index, slug, origin, expected=None):
    original = card.coaching_card_data or {}
    data = normalize_card_clips(card.coaching_card_data)
    clips = [clip for playlist in data.get("playlists", []) for clip in playlist.get("clips", [])]
    if clip_index < 0 or clip_index >= len(clips):
        raise NotFound("Video not found.")
    clip = clips[clip_index]
    original_clips = [item for playlist in original.get("playlists", []) for item in playlist.get("clips", [])]
    wire = original_clips[clip_index] if original_clips else original.get("primary_clip") or {}
    source = data.get("source_media") or {}
    clip_source = clip.get("source_media") or {}

    def clock(value):
        return None if value is None else math.floor(value * 1_000_000 + 0.5)

    identity = [
        clip.get("id") if original_clips else wire.get("clip_id") or "primary",
        wire.get("association_id") or None,
        clip.get("source_url") or None,
        clip_source.get("package_id") or None,
        clip_source.get("artifact_id") or None,
        clock(clip.get("start_seconds")),
        clock(clip.get("end_seconds")),
        clock(clip.get("source_start_seconds")),
        clock(clip.get("duration_seconds")),
        clip.get("playback_mode") or None,
        source.get("package_id") or None,
        source.get("artifact_id") or None,
    ]
    client_revision = hashlib.sha256(
        json.dumps(identity, separators=(",", ":"), ensure_ascii=False).encode()
    ).hexdigest()
    if expected is not None and expected != client_revision:
        raise PlaybackChanged()
    saved = clip.get("source_media") or {}
    if not saved and clip.get("id") == source.get("artifact_id"):
        saved = source
    # A persisted relative library URL can identify a saved upload, but never grants library-wide access.
    source_url = clip.get("source_url") or ""
    if source_url:
        if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,511}\.m3u8", source_url, re.IGNORECASE):
            return _archived_playlist_url(source_url), True, client_revision, "archive"
        parsed = urlsplit(source_url)
        pattern = (
            rf"/api/workspaces/{re.escape(slug)}/projects/{card.project_id}/"
            r"media-library/packages/([^/]+)/artifacts/([^/]+)/file/"
        )
        match = re.fullmatch(pattern, parsed.path)
        authority = f"{parsed.scheme}://{parsed.netloc}" if parsed.scheme or parsed.netloc else origin
        if not match or parsed.query or parsed.fragment or authority != origin:
            raise MediaSourceUnavailable()
        saved = {"package_id": unquote(match[1]), "artifact_id": unquote(match[2])}
    if not saved:
        raise MediaSourceUnavailable()
    package_id = validate_segment(saved.get("package_id", ""), "package_id")
    artifact_id = validate_segment(saved.get("artifact_id", ""), "artifact_id")
    manifest_file = manifest_path(str(card.project_id), package_id)
    if not manifest_file.is_file():
        raise MediaSourceUnavailable()
    manifest = read_manifest(manifest_file)
    artifact = next((item for item in manifest.get("artifacts", []) if item.get("name") == artifact_id), None)
    if not artifact or not isinstance(artifact.get("path"), str):
        raise MediaSourceUnavailable()
    delivery = urlsplit(artifact["path"])
    if delivery.scheme or delivery.netloc:
        if (
            delivery.scheme != "https"
            or not delivery.netloc
            or delivery.username
            or delivery.password
            or delivery.fragment
            or f"{delivery.scheme}://{delivery.netloc}" == origin
        ):
            raise MediaSourceUnavailable()
        is_hls = delivery.path.lower().endswith(".m3u8")
        return artifact["path"], is_hls, client_revision, "external"
    raw = Path(artifact["path"])
    main = (raw if raw.is_absolute() else media_library_root() / raw).resolve()
    artifacts = (package_root(str(card.project_id), package_id) / "artifacts").resolve()
    if not artifacts.is_relative_to(media_library_root()) or not main.is_relative_to(artifacts) or not main.is_file():
        raise MediaSourceUnavailable()
    is_hls = main.suffix.lower() == ".m3u8"
    if is_hls and main.parent != (artifacts / artifact_id).resolve():
        raise MediaSourceUnavailable()
    if not is_hls and main.suffix.lower() not in {".mp4", ".m4v", ".mov", ".webm"}:
        raise MediaSourceUnavailable()
    # Include source metadata and clip clocks so a replaced file/association invalidates old grants.
    revision = hashlib.sha256(
        json.dumps(
            [clip, saved, str(main), main.stat().st_size, main.stat().st_mtime_ns],
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    ).hexdigest()
    return main, is_hls, revision, "signed"


def _chunks(path, start, length):
    with path.open("rb") as handle:
        handle.seek(start)
        while length:
            chunk = handle.read(min(length, 64 * 1024))
            if not chunk:
                break
            length -= len(chunk)
            yield chunk


def _file_response(request, path):
    size = path.stat().st_size
    start, end, status = 0, size - 1, 200
    requested = request.headers.get("Range")
    if requested:
        match = re.fullmatch(r"bytes=(\d*)-(\d*)", requested) if len(requested) <= 80 else None
        if match and size and any(match.groups()):
            first, last = match.groups()
            start = int(first) if first else max(0, size - int(last))
            end = min(size - 1, int(last)) if first and last else size - 1
        else:
            start, end = 1, 0
        if start > end or start >= size:
            return HttpResponse(status=416, headers={"Content-Range": f"bytes */{size}"})
        status = 206
    length = max(0, end - start + 1)
    content_type = {
        ".m3u8": "application/vnd.apple.mpegurl",
        ".key": "application/octet-stream",
    }.get(path.suffix.lower()) or mimetypes.guess_type(path)[0]
    headers = {"Content-Length": str(length), "Accept-Ranges": "bytes"}
    if status == 206:
        headers["Content-Range"] = f"bytes {start}-{end}/{size}"
    if request.method == "HEAD":
        return HttpResponse(status=status, content_type=content_type or "application/octet-stream", headers=headers)
    return StreamingHttpResponse(
        _chunks(path, start, length),
        status=status,
        content_type=content_type or "application/octet-stream",
        headers=headers,
    )


class PlayerCardPlaybackEndpoint(BaseAPIView):
    def get(self, request, slug, project_id, card_id, clip_index):
        card = _assigned(request.user, slug, project_id, card_id)
        origin = request.build_absolute_uri("/").rstrip("/")
        main, is_hls, revision, delivery = _source(card, clip_index, slug, origin, request.query_params.get("revision"))
        if isinstance(main, str) and delivery != "archive":
            return Response(
                {
                    "source_url": main,
                    "content_type": "hls" if is_hls else "progressive",
                    "delivery": delivery,
                    "expires_at": (timezone.now() + timedelta(seconds=GRANT_SECONDS)).isoformat(),
                },
                headers={"Cache-Control": "private, no-store"},
            )
        token = signing.dumps(
            {
                "user": str(request.user.pk),
                "slug": slug,
                "project": str(project_id),
                "card": str(card_id),
                "clip": clip_index,
                "revision": revision,
                "origin": origin,
                "archive": main if delivery == "archive" else None,
            },
            salt=GRANT_SALT,
            compress=True,
        )
        resource = "playlist.m3u8" if delivery == "archive" else main.name if is_hls else "video" + main.suffix.lower()
        return Response(
            {
                "source_url": reverse("player-signed-media", kwargs={"token": token, "resource": resource}),
                "content_type": "hls" if is_hls else "progressive",
                "delivery": "signed",
                "expires_at": (timezone.now() + timedelta(seconds=GRANT_SECONDS)).isoformat(),
            },
            headers={"Cache-Control": "private, no-store"},
        )


class PlayerSignedMediaEndpoint(BaseAPIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    http_method_names = ["get", "head", "options"]

    def get(self, request, token, resource):
        try:
            grant = signing.loads(token, salt=GRANT_SALT, max_age=GRANT_SECONDS)
        except signing.BadSignature:
            raise PermissionDenied("Playback link expired or invalid. Retry the video.")
        user = get_object_or_404(User, pk=grant["user"])
        card = _assigned(user, grant["slug"], grant["project"], grant["card"])
        main, is_hls, revision, delivery = _source(card, grant["clip"], grant["slug"], grant["origin"])
        if delivery not in {"signed", "archive"} or (delivery == "archive" and grant.get("archive") != main):
            raise PermissionDenied("The video source changed. Retry the video.")
        if revision != grant["revision"]:
            raise PermissionDenied("The video source changed. Retry the video.")
        if delivery == "archive":
            response = stream_archive(request, main, token, resource)
            response["Cache-Control"] = "private, no-store"
            response["X-Content-Type-Options"] = "nosniff"
            response["Referrer-Policy"] = "no-referrer"
            return response
        parts = PurePosixPath(resource).parts
        if not parts or any(part in {".", ".."} for part in resource.split("/")) or "\\" in resource:
            raise NotFound("Video not found.")
        if is_hls:
            path = (main.parent / resource).resolve()
            if not path.is_relative_to(main.parent) or path.suffix.lower() not in HLS_EXTENSIONS:
                raise NotFound("Video not found.")
        else:
            if resource != "video" + main.suffix.lower():
                raise NotFound("Video not found.")
            path = main
        if not path.is_file():
            raise NotFound("Video not found.")
        response = _file_response(request, path)
        response["Cache-Control"] = "private, no-store"
        response["X-Content-Type-Options"] = "nosniff"
        response["Referrer-Policy"] = "no-referrer"
        return response
