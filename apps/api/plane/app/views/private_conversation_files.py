"""Allowlisted file inspection for participant-only conversation attachments."""

import json
import subprocess
import zipfile
from pathlib import Path
from rest_framework.exceptions import ValidationError

FILE_TYPES = {
    ".mp4": ("video", "video/mp4"),
    ".mov": ("video", "video/quicktime"),
    ".jpg": ("image", "image/jpeg"),
    ".jpeg": ("image", "image/jpeg"),
    ".png": ("image", "image/png"),
    ".webp": ("image", "image/webp"),
    ".pdf": ("document", "application/pdf"),
    ".doc": ("document", "application/msword"),
    ".docx": ("document", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    ".xls": ("document", "application/vnd.ms-excel"),
    ".xlsx": ("document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    ".ppt": ("document", "application/vnd.ms-powerpoint"),
    ".pptx": ("document", "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
}


def inspect_attachment(path, name, content_type, inspect_video):
    suffix = Path(name).suffix.lower()
    expected = FILE_TYPES.get(suffix)
    if not expected or content_type != expected[1]:
        raise ValidationError("Choose a supported video, image, PDF or Office document.")
    media, mime = expected
    if media == "video":
        return media, mime, inspect_video(path)
    try:
        if media == "image":
            probe = subprocess.run(
                [
                    "ffprobe",
                    "-v",
                    "error",
                    "-protocol_whitelist",
                    "file",
                    "-print_format",
                    "json",
                    "-show_streams",
                    str(path),
                ],
                capture_output=True,
                text=True,
                check=True,
                timeout=20,
            )
            streams = json.loads(probe.stdout).get("streams", [])
            codec = {"image/jpeg": "mjpeg", "image/png": "png", "image/webp": "webp"}[mime]
            if len(streams) != 1 or streams[0].get("codec_name") != codec:
                raise ValueError()
            width, height = streams[0].get("width", 0), streams[0].get("height", 0)
            if width <= 0 or height <= 0 or width * height > 25_000_000:
                raise ValueError()
        else:
            with path.open("rb") as file:
                prefix = file.read(16)
            if suffix == ".pdf":
                if not prefix.startswith(b"%PDF-"):
                    raise ValueError()
            elif suffix in {".doc", ".xls", ".ppt"}:
                if not prefix.startswith(bytes.fromhex("d0cf11e0a1b11ae1")):
                    raise ValueError()
            else:
                with zipfile.ZipFile(path) as archive:
                    entries = archive.infolist()
                    names = {entry.filename for entry in entries}
                    marker = {
                        ".docx": "word/document.xml",
                        ".xlsx": "xl/workbook.xml",
                        ".pptx": "ppt/presentation.xml",
                    }[suffix]
                    if len(entries) > 10000 or sum(entry.file_size for entry in entries) > 1024**3:
                        raise ValueError()
                    if "[Content_Types].xml" not in names or marker not in names:
                        raise ValueError()
                    if any(name.lower().endswith("vbaproject.bin") for name in names):
                        raise ValueError()
        return media, mime, 0
    except (OSError, ValueError, KeyError, subprocess.SubprocessError, zipfile.BadZipFile):
        raise ValidationError("The file does not match a supported image or document format.")
