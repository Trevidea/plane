"""Bounded video uploads and revocable playback for a private conversation."""

import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import tempfile
import uuid
from datetime import timedelta
from pathlib import Path

from django.conf import settings
from django.core import signing
from django.shortcuts import get_object_or_404
from django.urls import reverse
from django.utils import timezone
from rest_framework.exceptions import APIException, NotFound, ValidationError

from plane.app.views.base import BaseAPIView
from plane.app.views.player_media import (
    GRANT_SALT,
    GRANT_SECONDS,
    HLS_EXTENSIONS,
    _source,
    _file_response,
    PlaybackChanged,
)
from plane.app.views.player_archive_media import stream_archive
from plane.db.models import CoachingCardPrivateAttachment, User
from plane.utils.coaching_card_clips import normalize_card_clips
from plane.utils.media_library import media_library_root

MAX_BYTES = 1024 * 1024 * 1024


def storage_root():
    # Outside every UUID project/package directory and inaccessible to library routes.
    root = Path(
        getattr(settings, "PRIVATE_CONVERSATION_MEDIA_ROOT", media_library_root() / ".private-conversations")
    ).resolve()
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    return root


def upload_file(attachment):
    return storage_root() / (str(attachment.id) + ".mp4")


def clip_options(card, slug, origin):
    data = normalize_card_clips(card.coaching_card_data)
    clips = [clip for playlist in data.get("playlists", []) for clip in playlist.get("clips", [])]
    results = []
    for index, clip in enumerate(clips[:200]):
        try:
            _, _, revision, _ = conversation_source(card, index, slug, origin)
        except APIException:
            continue
        results.append(
            {
                "kind": "card_clip",
                "clip_index": index,
                "revision": revision,
                "name": str(clip.get("name") or clip.get("title") or f"Clip {index + 1}")[:255],
            }
        )
    return results


def conversation_source(card, index, slug, origin):
    main, hls, source_revision, delivery = _source(card, index, slug, origin)
    clock = clip_clock(normalize_card_clips(card.coaching_card_data), index)
    revision = hashlib.sha256(
        json.dumps([source_revision, str(main), hls, delivery, clock], sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    return main, hls, revision, delivery


def clip_source(card, index, revision, slug, origin):
    main, hls, current, delivery = conversation_source(card, index, slug, origin)
    if current != revision:
        raise PlaybackChanged()
    data = normalize_card_clips(card.coaching_card_data)
    clips = [clip for playlist in data.get("playlists", []) for clip in playlist.get("clips", [])]
    clip = clips[index]
    # Legacy exports have decoder-relative clocks, unlike full recording clips.
    offset = (
        (clip.get("source_start_seconds") or clip.get("start_seconds") or 0)
        if clip.get("playback_mode") == "clip"
        else 0
    )
    start = max(0, (clip.get("start_seconds") or 0) - offset)
    end = clip.get("end_seconds")
    end = max(start, end - offset) if end is not None else None
    return main, hls, current, delivery, start, end


def clip_clock(data, index):
    position = 0
    for playlist in data.get("playlists", []):
        clips = playlist.get("clips", [])
        if position <= index < position + len(clips):
            selected = clips[index - position]
            keys = (
                "start_seconds",
                "end_seconds",
                "source_start_seconds",
                "playback_mode",
                "duration_seconds",
                "playlist_start_seconds",
                "playlist_duration_seconds",
            )
            clock = {key: selected[key] for key in keys if selected.get(key) is not None}
            archived = re.fullmatch(
                r"[A-Za-z0-9][A-Za-z0-9_.-]{0,511}\.m3u8", selected.get("source_url", ""), re.IGNORECASE
            )
            if archived:
                clock["source_url"] = selected["source_url"]
                if len(clips) > 1 and all(
                    not c.get("playback_mode")
                    and not c.get("source_media")
                    and c.get("source_url") == selected["source_url"]
                    and (c.get("duration_seconds") or 0) > 0
                    for c in clips
                ):
                    clock.setdefault(
                        "playlist_start_seconds", sum(c["duration_seconds"] for c in clips[: index - position])
                    )
                    clock.setdefault("playlist_duration_seconds", sum(c["duration_seconds"] for c in clips))
            return clock
        position += len(clips)
    raise NotFound()


def attachment_data(item):
    return {
        "id": str(item.id),
        "kind": item.kind,
        "name": item.name,
        "size": item.size,
        "duration": item.duration,
        "start_seconds": item.source.get("start", 0),
        "end_seconds": item.source.get("end"),
    }


def attach_clip(request, card, recipient, selection, message):
    if not isinstance(selection, dict):
        raise ValidationError("Choose a video attachment.")
    if selection.get("kind") == "upload" and set(selection) == {"kind", "id"}:
        try:
            uuid.UUID(str(selection["id"]))
            item = get_object_or_404(
                CoachingCardPrivateAttachment.objects.select_for_update(),
                pk=selection["id"],
                issue=card,
                coach_id=card.created_by_id,
                recipient=recipient,
                actor=request.user,
                message__isnull=True,
                consumed_at__isnull=True,
                expires_at__gt=timezone.now(),
                kind="upload",
            )
        except (ValueError, TypeError):
            raise NotFound()
        if not upload_file(item).is_file():
            raise NotFound()
        item.message = message
        item.consumed_at = timezone.now()
        item.save(update_fields=["message", "consumed_at"])
        return item
    if selection.get("kind") != "card_clip" or set(selection) != {"kind", "clip_index", "revision"}:
        raise ValidationError("Choose a card clip or an uploaded video.")
    index, revision = selection["clip_index"], selection["revision"]
    if (
        type(index) is not int
        or index < 0
        or not isinstance(revision, str)
        or not re.fullmatch("[a-f0-9]{64}", revision)
    ):
        raise ValidationError("Invalid card clip.")
    origin = request.build_absolute_uri("/").rstrip("/")
    _, _, _, _, start, end = clip_source(card, index, revision, card.workspace.slug, origin)
    data = normalize_card_clips(card.coaching_card_data)
    clip = [c for p in data.get("playlists", []) for c in p.get("clips", [])][index]
    return CoachingCardPrivateAttachment.objects.create(
        issue=card,
        coach_id=card.created_by_id,
        recipient=recipient,
        actor=request.user,
        message=message,
        consumed_at=timezone.now(),
        kind="card_clip",
        name=str(clip.get("name") or clip.get("title") or f"Clip {index + 1}")[:255],
        duration=max(0, end - start) if end is not None else float(clip.get("duration_seconds") or 0),
        source={
            "clip_index": index,
            "revision": revision,
            "start": start,
            "end": end,
            "clock": clip_clock(data, index),
        },
        expires_at=timezone.now() + timedelta(days=1),
    )


def inspect_video(path):
    if not shutil.which("ffprobe"):
        raise ValidationError("Video inspection is unavailable on this server.")
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-protocol_whitelist",
                "file",
                "-print_format",
                "json",
                "-show_format",
                "-show_streams",
                str(path),
            ],
            capture_output=True,
            text=True,
            check=True,
            timeout=20,
        )
        probe = json.loads(result.stdout)
        streams = probe.get("streams", [])
        video = [s for s in streams if s.get("codec_type") == "video"]
        audio = [s for s in streams if s.get("codec_type") == "audio"]
        duration = float(probe.get("format", {}).get("duration", 0))
        formats = probe.get("format", {}).get("format_name", "").split(",")
        if (
            not {"mov", "mp4"}.intersection(formats)
            or len(video) != 1
            or video[0].get("codec_name") != "h264"
            or any(s.get("codec_name") != "aac" for s in audio)
            or not math.isfinite(duration)
            or duration <= 0
        ):
            raise ValueError()
        return duration
    except (subprocess.SubprocessError, ValueError, TypeError, OSError):
        raise ValidationError("Choose a playable MP4/MOV video with H.264 video and AAC audio.")


class PrivateClipUploadEndpoint(BaseAPIView):
    parser_classes = []

    def get(self, request, slug, project_id, card_id, recipient_user_id=None):
        from .private_card_thread import participant_context, audience, private_response

        card, recipient = participant_context(request, slug, project_id, card_id, recipient_user_id)
        return private_response(
            {
                **audience(card, recipient),
                "max_bytes": MAX_BYTES,
                "clips": clip_options(card, slug, request.build_absolute_uri("/").rstrip("/")),
            }
        )

    def post(self, request, slug, project_id, card_id, recipient_user_id=None):
        from .private_card_thread import participant_context, private_response

        card, recipient = participant_context(request, slug, project_id, card_id, recipient_user_id)
        content_type = request.content_type
        try:
            declared = int(request.headers.get("X-Video-Size", request.headers.get("Content-Length", "0")))
        except ValueError:
            raise ValidationError("Invalid video size.")
        if content_type not in {"video/mp4", "video/quicktime"} or declared <= 0 or declared > MAX_BYTES:
            raise ValidationError("Choose an MP4/MOV video up to 1 GB.")
        if (
            CoachingCardPrivateAttachment.objects.filter(
                actor=request.user, message__isnull=True, consumed_at__isnull=True, expires_at__gt=timezone.now()
            ).count()
            >= 8
        ):
            raise ValidationError("Too many pending videos. Send your current video or try again later.")
        raw_name = request.headers.get("X-Video-Name", "video.mp4")
        from urllib.parse import unquote

        name = Path(unquote(raw_name).replace("\\", "/")).name[:255] or "video.mp4"
        with tempfile.NamedTemporaryFile(dir=storage_root(), prefix="upload-", suffix=".mp4") as temporary:
            size = 0
            while True:
                chunk = request._request.read(64 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_BYTES or size > declared:
                    raise ValidationError("Video exceeds its declared size or 1 GB.")
                temporary.write(chunk)
            temporary.flush()
            if size != declared:
                raise ValidationError("Video upload was incomplete.")
            duration = inspect_video(Path(temporary.name))
            # Recheck access after the potentially slow transfer/inspection.
            card, recipient = participant_context(request, slug, project_id, card_id, recipient_user_id)
            item = CoachingCardPrivateAttachment(
                issue=card,
                coach_id=card.created_by_id,
                recipient=recipient,
                actor=request.user,
                kind="upload",
                name=name,
                size=size,
                duration=duration,
                source={"start": 0, "end": duration},
                expires_at=timezone.now() + timedelta(days=1),
            )
            destination = upload_file(item)
            shutil.copyfile(temporary.name, destination)
            os.chmod(destination, 0o600)
            try:
                item.save()
            except Exception:
                destination.unlink(missing_ok=True)
                raise
        return private_response(attachment_data(item), 201)


class PrivateClipPlaybackEndpoint(BaseAPIView):
    def get(self, request, slug, project_id, card_id, attachment_id, recipient_user_id=None):
        from .private_card_thread import participant_context, private_response

        card, recipient = participant_context(request, slug, project_id, card_id, recipient_user_id)
        item = get_object_or_404(
            CoachingCardPrivateAttachment,
            pk=attachment_id,
            issue=card,
            coach_id=card.created_by_id,
            recipient=recipient,
            message__isnull=False,
        )
        hls = False
        resource = "video.mp4"
        if item.kind == "card_clip":
            main, hls, _, delivery, _, _ = clip_source(
                card,
                item.source["clip_index"],
                item.source["revision"],
                slug,
                request.build_absolute_uri("/").rstrip("/"),
            )
            resource = (
                "playlist.m3u8"
                if delivery in {"archive", "external"}
                else main.name
                if hls
                else "video" + main.suffix.lower()
            )
        token = signing.dumps(
            {
                "attachment": str(item.id),
                "message": str(item.message_id),
                "user": str(request.user.id),
                "slug": slug,
                "project": str(project_id),
                "card": str(card_id),
                "recipient": str(recipient.id),
                "coach": str(card.created_by_id),
                "origin": request.build_absolute_uri("/").rstrip("/"),
            },
            salt=GRANT_SALT,
            compress=True,
        )
        return private_response(
            {
                "source_url": reverse("player-signed-media", kwargs={"token": token, "resource": resource}),
                "content_type": "hls" if hls else "progressive",
                "expires_at": (timezone.now() + timedelta(seconds=GRANT_SECONDS)).isoformat(),
                "start_seconds": item.source.get("start", 0),
                "end_seconds": item.source.get("end"),
                **({"clock": item.source["clock"]} if item.source.get("clock") else {}),
            }
        )


def signed_attachment_media(request, grant, token, resource):
    from .private_card_thread import participant_context

    user = get_object_or_404(User, pk=grant.get("user"), is_active=True, is_bot=False)
    # The public signed endpoint has no session; only server-signed participant identity is used.
    from types import SimpleNamespace

    context = SimpleNamespace(user=user)
    coach_request = str(user.id) == grant.get("coach")
    card, recipient = participant_context(
        context, grant["slug"], grant["project"], grant["card"], grant["recipient"] if coach_request else None
    )
    if str(recipient.id) != grant.get("recipient") or str(card.created_by_id) != grant.get("coach"):
        raise NotFound()
    item = get_object_or_404(
        CoachingCardPrivateAttachment,
        pk=grant["attachment"],
        message_id=grant.get("message"),
        issue=card,
        coach_id=card.created_by_id,
        recipient=recipient,
        message__isnull=False,
    )
    if item.kind == "upload":
        if resource != "video.mp4" or not upload_file(item).is_file():
            raise NotFound()
        response = _file_response(request, upload_file(item))
    else:
        main, hls, _, delivery, _, _ = clip_source(
            card, item.source["clip_index"], item.source["revision"], grant["slug"], grant["origin"]
        )
        if delivery in {"archive", "external"}:
            response = stream_archive(request, str(main), token, resource)
        else:
            if any(part in {"", ".", ".."} for part in resource.split("/")) or "\\" in resource:
                raise NotFound()
            path = (main.parent / resource).resolve() if hls else main
            if hls and (not path.is_relative_to(main.parent) or path.suffix.lower() not in HLS_EXTENSIONS):
                raise NotFound()
            if not hls and resource != "video" + main.suffix.lower():
                raise NotFound()
            if not path.is_file():
                raise NotFound()
            response = _file_response(request, path)
    response["Cache-Control"] = "private, no-store"
    response["X-Content-Type-Options"] = "nosniff"
    response["Referrer-Policy"] = "no-referrer"
    return response
