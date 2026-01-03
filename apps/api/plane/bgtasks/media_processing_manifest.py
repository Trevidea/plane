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
from plane.app.media_manifest import get_media_library_root, get_file_manifest_path, read_manifest, write_manifest
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


@shared_task
def process_media_manifest(workspace_id, project_id, file_id):
    root_dir = get_media_library_root(workspace_id, project_id)
    manifest_path = get_file_manifest_path(root_dir, file_id)
    if not manifest_path or not manifest_path.exists():
        return

    manifest = read_manifest(manifest_path)
    file_dir = manifest_path.parent
    original_relative = manifest.get("original", {}).get("relative_path")
    if not original_relative:
        return
    original_path = file_dir / original_relative
    if not original_path.exists():
        return

    try:
        manifest["status"] = "PROCESSING"
        manifest["errors"] = []

        metadata = _ffprobe_metadata(str(original_path))
        manifest["metadata"]["width"] = metadata.get("width") or manifest["metadata"].get("width")
        manifest["metadata"]["height"] = metadata.get("height") or manifest["metadata"].get("height")
        manifest["metadata"]["duration_sec"] = metadata.get("duration") or manifest["metadata"].get("duration_sec")

        thumbnail_width = getattr(settings, "MEDIA_LIBRARY_THUMBNAIL_WIDTH", 480)
        thumbnails = []
        renditions = []

        mime_type = manifest.get("original", {}).get("mime_type") or ""
        kind = manifest.get("kind")
        if not kind or kind == "other":
            if mime_type in [
                "application/pdf",
                "application/msword",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ]:
                kind = "document"
            else:
                kind = mime_type.split("/")[0] if "/" in mime_type else "other"
        manifest["kind"] = kind

        if kind in ["image", "video"] or (kind == "document" and mime_type == "application/pdf"):
            thumb_path = file_dir / "thumbs" / "thumb.jpg"
            try:
                _render_thumbnail(str(original_path), str(thumb_path), thumbnail_width)
                thumbnails.append(
                    {
                        "id": "thumb",
                        "relative_path": "thumbs/thumb.jpg",
                        "mime_type": "image/jpeg",
                        "width": thumbnail_width,
                        "height": None,
                    }
                )
            except Exception as exc:
                log_exception(exc)

        if kind == "video":
            renditions_cfg = getattr(settings, "MEDIA_LIBRARY_VIDEO_RENDITIONS", [])
            for rendition in renditions_cfg:
                label = rendition.get("label")
                height = rendition.get("height")
                bitrate_kbps = rendition.get("bitrate_kbps", 1200)
                if not label or not height:
                    continue
                if manifest["metadata"].get("height") and height > manifest["metadata"]["height"]:
                    continue
                out_path = file_dir / "renditions" / f"{label}.mp4"
                _transcode_mp4(str(original_path), str(out_path), height, bitrate_kbps)
                renditions.append(
                    {
                        "id": f"preview_{label}",
                        "kind": "PREVIEW",
                        "format": "mp4",
                        "relative_path": f"renditions/{label}.mp4",
                        "mime_type": "video/mp4",
                        "height": height,
                        "bitrate": bitrate_kbps,
                    }
                )

            try:
                hls_dir = file_dir / "renditions" / "hls"
                hls_dir.mkdir(parents=True, exist_ok=True)
                hls_label = "adaptive"
                hls_height = min(manifest["metadata"].get("height") or 720, 720)
                hls_bitrate = 1800
                playlist_path = _transcode_hls(
                    str(original_path), str(hls_dir), hls_height, hls_bitrate, hls_label
                )
                renditions.append(
                    {
                        "id": "hls",
                        "kind": "HLS",
                        "format": "m3u8",
                        "relative_path": f"renditions/hls/{os.path.basename(playlist_path)}",
                        "mime_type": "application/vnd.apple.mpegurl",
                        "height": hls_height,
                        "bitrate": hls_bitrate,
                    }
                )
            except Exception as exc:
                log_exception(exc)

        manifest["thumbnails"] = thumbnails
        manifest["renditions"] = renditions
        preferred = next((item for item in renditions if item.get("kind") == "PREVIEW"), None)
        manifest["preview"]["preferred"] = preferred.get("relative_path") if preferred else None
        manifest["status"] = "READY"
        write_manifest(manifest_path, manifest)

    except Exception as exc:
        log_exception(exc)
        manifest["status"] = "FAILED"
        manifest.setdefault("errors", []).append(str(exc)[:1000])
        write_manifest(manifest_path, manifest)
