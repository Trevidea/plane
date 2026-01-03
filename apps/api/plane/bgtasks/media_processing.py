# Python imports
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

# Third party imports
from celery import shared_task
from django.conf import settings

# Module imports
from plane.db.models import MediaAsset, MediaRendition
from plane.settings.storage import S3Storage
from plane.utils.exception_logger import log_exception


def _run_command(command):
    result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "Media processing failed.")
    return result.stdout


def _ffprobe_metadata(file_path):
    if not shutil.which("ffprobe"):
        return {}
    try:
        output = _run_command(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration:stream=width,height",
                "-of",
                "json",
                file_path,
            ]
        )
        data = json.loads(output or "{}")
        stream = next((item for item in data.get("streams", []) if "width" in item), {})
        duration = None
        if data.get("format"):
            duration = data["format"].get("duration")
        return {
            "width": stream.get("width"),
            "height": stream.get("height"),
            "duration": float(duration) if duration else None,
        }
    except Exception:
        return {}


def _upload_file(storage, local_path, key, content_type=None):
    if content_type:
        storage.s3_client.upload_file(
            local_path,
            storage.aws_storage_bucket_name,
            key,
            ExtraArgs={"ContentType": content_type},
        )
    else:
        storage.s3_client.upload_file(local_path, storage.aws_storage_bucket_name, key)


def _ensure_ffmpeg():
    if not shutil.which("ffmpeg"):
        raise RuntimeError("ffmpeg is not available in the media worker environment.")


def _render_thumbnail(source_path, output_path, width):
    _ensure_ffmpeg()
    _run_command(
        [
            "ffmpeg",
            "-y",
            "-i",
            source_path,
            "-vf",
            f"scale={width}:-2",
            "-vframes",
            "1",
            output_path,
        ]
    )


def _transcode_mp4(source_path, output_path, height, bitrate_kbps):
    _ensure_ffmpeg()
    _run_command(
        [
            "ffmpeg",
            "-y",
            "-i",
            source_path,
            "-vf",
            f"scale=-2:{height}",
            "-c:v",
            "libx264",
            "-profile:v",
            "main",
            "-preset",
            "fast",
            "-b:v",
            f"{bitrate_kbps}k",
            "-maxrate",
            f"{bitrate_kbps}k",
            "-bufsize",
            f"{bitrate_kbps * 2}k",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            output_path,
        ]
    )


def _transcode_hls(source_path, output_dir, height, bitrate_kbps, label):
    _ensure_ffmpeg()
    playlist_path = str(Path(output_dir) / f"{label}.m3u8")
    segment_path = str(Path(output_dir) / f"{label}_%03d.ts")
    _run_command(
        [
            "ffmpeg",
            "-y",
            "-i",
            source_path,
            "-vf",
            f"scale=-2:{height}",
            "-c:v",
            "libx264",
            "-profile:v",
            "main",
            "-preset",
            "fast",
            "-b:v",
            f"{bitrate_kbps}k",
            "-maxrate",
            f"{bitrate_kbps}k",
            "-bufsize",
            f"{bitrate_kbps * 2}k",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-hls_time",
            "4",
            "-hls_playlist_type",
            "vod",
            "-hls_segment_filename",
            segment_path,
            playlist_path,
        ]
    )
    return playlist_path


def _derive_media_kind(mime_type):
    if not mime_type:
        return MediaAsset.MediaKind.OTHER
    if mime_type.startswith("image/"):
        return MediaAsset.MediaKind.IMAGE
    if mime_type.startswith("video/"):
        return MediaAsset.MediaKind.VIDEO
    if mime_type.startswith("audio/"):
        return MediaAsset.MediaKind.AUDIO
    if mime_type in [
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]:
        return MediaAsset.MediaKind.DOCUMENT
    if mime_type in ["application/zip", "application/x-zip-compressed", "application/x-rar"]:
        return MediaAsset.MediaKind.ARCHIVE
    return MediaAsset.MediaKind.OTHER


@shared_task
def process_media_asset(media_asset_id):
    try:
        asset = MediaAsset.objects.get(id=media_asset_id)
    except MediaAsset.DoesNotExist:
        return

    if not asset.is_uploaded:
        return

    storage = S3Storage()
    asset.status = MediaAsset.Status.PROCESSING
    asset.processing_error = ""
    asset.save(update_fields=["status", "processing_error"])

    try:
        MediaRendition.objects.filter(media_asset=asset).delete()

        if asset.media_kind == MediaAsset.MediaKind.OTHER:
            asset.media_kind = _derive_media_kind(asset.mime_type)

        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            source_path = str(tmp_path / asset.file_name)

            storage.s3_client.download_file(
                storage.aws_storage_bucket_name,
                str(asset.asset.name),
                source_path,
            )

            metadata = _ffprobe_metadata(source_path)
            asset.width = metadata.get("width") or asset.width
            asset.height = metadata.get("height") or asset.height
            asset.duration = metadata.get("duration") or asset.duration

            prefix = f"{asset.workspace.id}/media/{asset.id}"
            thumbnail_width = getattr(settings, "MEDIA_LIBRARY_THUMBNAIL_WIDTH", 480)

            if asset.media_kind == MediaAsset.MediaKind.IMAGE or (
                asset.media_kind == MediaAsset.MediaKind.DOCUMENT and asset.mime_type == "application/pdf"
            ):
                thumb_path = str(tmp_path / "thumb.jpg")
                _render_thumbnail(source_path, thumb_path, thumbnail_width)
                thumb_key = f"{prefix}/thumb.jpg"
                _upload_file(storage, thumb_path, thumb_key, "image/jpeg")
                MediaRendition.objects.create(
                    media_asset=asset,
                    kind=MediaRendition.Kind.THUMBNAIL,
                    format="jpg",
                    path=thumb_key,
                    mime_type="image/jpeg",
                    is_primary=True,
                    metadata={"name": "thumbnail.jpg"},
                )

            if asset.media_kind == MediaAsset.MediaKind.VIDEO:
                poster_path = str(tmp_path / "poster.jpg")
                _render_thumbnail(source_path, poster_path, thumbnail_width)
                poster_key = f"{prefix}/poster.jpg"
                _upload_file(storage, poster_path, poster_key, "image/jpeg")
                MediaRendition.objects.create(
                    media_asset=asset,
                    kind=MediaRendition.Kind.THUMBNAIL,
                    format="jpg",
                    path=poster_key,
                    mime_type="image/jpeg",
                    is_primary=True,
                    metadata={"name": "poster.jpg"},
                )

                renditions = getattr(settings, "MEDIA_LIBRARY_VIDEO_RENDITIONS", [])
                for rendition in renditions:
                    label = rendition.get("label")
                    height = rendition.get("height")
                    bitrate_kbps = rendition.get("bitrate_kbps", 1200)
                    if not label or not height:
                        continue
                    if asset.height and height > asset.height:
                        continue
                    output_path = str(tmp_path / f"{label}.mp4")
                    _transcode_mp4(source_path, output_path, height, bitrate_kbps)
                    output_key = f"{prefix}/renditions/{label}.mp4"
                    _upload_file(storage, output_path, output_key, "video/mp4")
                    MediaRendition.objects.create(
                        media_asset=asset,
                        kind=MediaRendition.Kind.PREVIEW,
                        format="mp4",
                        path=output_key,
                        mime_type="video/mp4",
                        height=height,
                        bitrate=bitrate_kbps,
                        metadata={"name": f"{label}.mp4", "label": label},
                    )

                try:
                    hls_dir = str(tmp_path / "hls")
                    os.makedirs(hls_dir, exist_ok=True)
                    hls_label = "adaptive"
                    hls_height = min(asset.height or 720, 720)
                    hls_bitrate = 1800
                    playlist_path = _transcode_hls(source_path, hls_dir, hls_height, hls_bitrate, hls_label)
                    playlist_key = f"{prefix}/hls/{hls_label}.m3u8"
                    for file_path in Path(hls_dir).glob("*"):
                        key = f"{prefix}/hls/{file_path.name}"
                        content_type = (
                            "application/vnd.apple.mpegurl" if file_path.suffix == ".m3u8" else "video/mp2t"
                        )
                        _upload_file(storage, str(file_path), key, content_type)
                    MediaRendition.objects.create(
                        media_asset=asset,
                        kind=MediaRendition.Kind.HLS,
                        format="m3u8",
                        path=playlist_key,
                        mime_type="application/vnd.apple.mpegurl",
                        height=hls_height,
                        bitrate=hls_bitrate,
                        metadata={"name": os.path.basename(playlist_path), "label": hls_label},
                    )
                except Exception as exc:
                    log_exception(exc)

            asset.status = MediaAsset.Status.READY
            asset.save(update_fields=["status", "media_kind", "width", "height", "duration"])

    except Exception as exc:
        log_exception(exc)
        asset.status = MediaAsset.Status.FAILED
        asset.processing_error = str(exc)[:1000]
        asset.save(update_fields=["status", "processing_error", "media_kind", "width", "height", "duration"])
