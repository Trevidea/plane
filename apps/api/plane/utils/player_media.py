"""Read only the assigned file or resources explicitly named in its HLS manifest."""

import mimetypes
from pathlib import Path, PurePosixPath
import re
from urllib.parse import unquote, urlsplit

from django.http import FileResponse, HttpResponse, HttpResponseRedirect, StreamingHttpResponse
from rest_framework.exceptions import NotFound, ValidationError


def is_hls_reference(project_id, package_id, artifact_id):
    from plane.app.views.media_library import read_manifest, manifest_path

    try:
        manifest = read_manifest(manifest_path(str(project_id), package_id))
    except (NotFound, ValidationError, OSError, ValueError):
        return False
    artifact = next((entry for entry in manifest.get("artifacts", []) if entry.get("name") == artifact_id), {})
    return artifact.get("format") == "m3u8" or urlsplit(artifact.get("path") or "").path.lower().endswith(".m3u8")


def hls_resources(manifest):
    base = manifest.parent.resolve()
    allowed, visited, pending = set(), set(), [manifest]
    while pending:
        current = pending.pop()
        if current in visited:
            continue
        try:
            if len(visited) >= 100 or current.stat().st_size > 1_048_576:
                raise NotFound("Manifest is too large.")
            visited.add(current)
            content = current.read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            raise NotFound("Manifest unavailable.")
        uris = [line.strip() for line in content.splitlines() if line.strip() and not line.startswith("#")]
        uris += re.findall(r'URI="([^"\n]+)"', content)
        for uri in uris:
            parts = urlsplit(uri)
            relative = PurePosixPath(unquote(parts.path))
            if parts.scheme or parts.netloc or relative.is_absolute() or ".." in relative.parts:
                continue
            candidate = (current.parent / str(relative)).resolve()
            if not candidate.is_relative_to(base) or not candidate.is_file():
                continue
            allowed.add(candidate)
            if candidate.suffix.lower() == ".m3u8":
                pending.append(candidate)
    return allowed


def assigned_media_response(request, project_id, package_id, artifact_id, artifact_path=None):
    # Keep existing filesystem roots and manifests, but do not delegate arbitrary
    # sibling paths or conversion operations to the generic artifact endpoint.
    from plane.app.views.media_library import (
        read_manifest,
        manifest_path,
        media_library_root,
        package_root,
        validate_segment,
        _parse_http_range,
        _iter_file_range,
    )

    for value, name in ((str(project_id), "projectId"), (package_id, "packageId"), (artifact_id, "artifactId")):
        validate_segment(value, name)
    manifest = read_manifest(manifest_path(str(project_id), package_id))
    artifact = next((entry for entry in manifest.get("artifacts", []) if entry.get("name") == artifact_id), None)
    if not artifact:
        raise NotFound("Artifact not found.")
    root = media_library_root().resolve()
    raw_path = artifact.get("path") or ""
    if raw_path.startswith(("https://", "http://")):
        if artifact_path:
            raise NotFound("Artifact file not found.")
        return HttpResponseRedirect(raw_path)
    file = Path(raw_path) if raw_path else None
    if file is not None:
        file = (file if file.is_absolute() else root / file).resolve()
    else:
        matches = list((package_root(str(project_id), package_id) / "artifacts").glob(f"{artifact_id}.*"))
        file = matches[0].resolve() if matches else None
    if file is None or not file.is_relative_to(root) or not file.is_file():
        raise NotFound("Artifact file not found.")
    if artifact_path:
        relative = PurePosixPath(unquote(artifact_path))
        if file.suffix.lower() != ".m3u8" or relative.is_absolute() or ".." in relative.parts:
            raise NotFound("Artifact file not found.")
        target = (file.parent / str(relative)).resolve()
        if target not in hls_resources(file):
            raise NotFound("Artifact file not referenced by the assigned manifest.")
        file = target
    content_type = (
        "application/vnd.apple.mpegurl"
        if file.suffix.lower() == ".m3u8"
        else (mimetypes.guess_type(file.name)[0] or "application/octet-stream")
    )
    range_header = request.headers.get("range")
    size = file.stat().st_size
    if range_header:
        bounds = _parse_http_range(range_header, size)
        if bounds is None:
            response = HttpResponse(status=416)
            response["Content-Range"] = f"bytes */{size}"
            return response
        start, end = bounds
        response = StreamingHttpResponse(_iter_file_range(file, start, end), status=206, content_type=content_type)
        response["Content-Range"] = f"bytes {start}-{end}/{size}"
        response["Content-Length"] = str(end - start + 1)
    else:
        response = FileResponse(file.open("rb"), content_type=content_type)
    response["Accept-Ranges"] = "bytes"
    response["Cache-Control"] = "private, no-store"
    return response
