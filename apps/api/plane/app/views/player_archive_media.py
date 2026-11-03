"""Cookie-free archive streaming restricted to signed playlist references."""

import asyncio
import hashlib
import re
import threading
from pathlib import PurePosixPath
from urllib.parse import urljoin, urlsplit

import requests
from asgiref.sync import sync_to_async
from django.core import signing
from django.core.handlers.asgi import ASGIRequest
from django.http import HttpResponse, StreamingHttpResponse
from django.urls import reverse
from rest_framework.exceptions import APIException, PermissionDenied

REFERENCE_SALT = "plane.player.archive-reference.v1"
MAX_PLAYLIST_BYTES = 2 * 1024 * 1024
EXTENSIONS = {".m3u8", ".ts", ".m4s", ".mp4", ".aac", ".key", ".vtt"}


class ArchiveUnavailable(APIException):
    status_code = 502
    default_detail = "Video streaming was interrupted or unavailable. Retry the video."


def _reference_url(reference, current, root):
    url = urljoin(current, reference)
    parsed, archive = urlsplit(url), urlsplit(root)
    prefix = archive.path.rsplit("/", 1)[0] + "/"
    if (
        len(url) > 1024
        or parsed.scheme != "https"
        or parsed.netloc != archive.netloc
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or not parsed.path.startswith(prefix)
        or "%" in parsed.path
        or "\\" in parsed.path
        or any(part in {".", ".."} for part in parsed.path.split("/"))
        or PurePosixPath(parsed.path).suffix.lower() not in EXTENSIONS
    ):
        raise ArchiveUnavailable()
    return url


def _resource_name(url):
    return "media" + PurePosixPath(urlsplit(url).path).suffix.lower()


def _playlist(text, current, root, token):
    if not text.startswith("#EXTM3U"):
        raise ArchiveUnavailable()
    parent = hashlib.sha256(token.encode()).hexdigest()
    size, lines = 0, []

    def rewrite(reference):
        url = _reference_url(reference, current, root)
        signed = signing.dumps({"parent": parent, "url": url}, salt=REFERENCE_SALT, compress=True)
        encoded = signing.b64_encode(signed.encode()).decode()
        path = reverse(
            "player-signed-media",
            kwargs={
                "token": token,
                "resource": "refs/" + encoded + "/" + _resource_name(url),
            },
        )
        if len(path) > 4096:
            raise ArchiveUnavailable()
        return path

    for line in text.splitlines():
        line = line.strip()
        output = (
            rewrite(line)
            if line and not line.startswith("#")
            else re.sub(r'\bURI="([^"]+)"', lambda match: 'URI="' + rewrite(match[1]) + '"', line)
        )
        size += len(output.encode()) + 1
        if size > MAX_PLAYLIST_BYTES:
            raise ArchiveUnavailable()
        lines.append(output)
    return "\n".join(lines) + "\n"


class _Chunks:
    def __init__(self, response, session):
        self.response, self.session = response, session
        self.closed = False
        self.close_lock = threading.Lock()

    def __iter__(self):
        try:
            yield from self.response.iter_content(chunk_size=64 * 1024)
        finally:
            self.close()

    def close(self):
        with self.close_lock:
            if self.closed:
                return
            self.closed = True
        try:
            self.response.close()
        finally:
            self.session.close()


class _AsyncChunks:
    """Read at most one requests chunk off the event loop; never buffer the response."""

    def __init__(self, chunks):
        self.chunks = chunks

    async def __aiter__(self):
        iterator = iter(self.chunks)
        pending = None
        try:
            while True:
                pending = asyncio.create_task(sync_to_async(next, thread_sensitive=False)(iterator, None))
                chunk = await asyncio.shield(pending)
                pending = None
                if chunk is None:
                    break
                yield chunk
        finally:
            try:
                await sync_to_async(self.close, thread_sensitive=False)()
            finally:
                if pending is not None:
                    # A cancelled await cannot stop the blocking read. Close its socket, then reap it.
                    await asyncio.gather(pending, return_exceptions=True)

    def close(self):
        self.chunks.close()


def stream_archive(request, root, token, resource):
    url = root
    if resource != "playlist.m3u8":
        parts = resource.split("/")
        try:
            if len(parts) != 3 or parts[0] != "refs" or len(parts[1]) > 2048:
                raise ValueError()
            signed = signing.b64_decode(parts[1].encode()).decode()
            reference = signing.loads(signed, salt=REFERENCE_SALT)
            if reference["parent"] != hashlib.sha256(token.encode()).hexdigest():
                raise ValueError()
            url = _reference_url(reference["url"], root, root)
            if parts[2] != _resource_name(url):
                raise ValueError()
        except (ValueError, KeyError, TypeError, signing.BadSignature):
            raise PermissionDenied("Invalid video resource.")
    playlist = urlsplit(url).path.lower().endswith(".m3u8")
    headers = {"Accept": "*/*", "Accept-Encoding": "identity", "User-Agent": "KanavioPlayer/1.0"}
    requested = request.headers.get("Range")
    if requested:
        if len(requested) > 80 or not re.fullmatch(r"bytes=\d*-\d*", requested):
            return HttpResponse(status=416)
        if not playlist:
            headers["Range"] = requested
    session = requests.Session()
    session.trust_env = False
    upstream = None
    streaming = False
    try:
        upstream = session.get(url, headers=headers, stream=True, allow_redirects=False, timeout=(5, 30))
        if upstream.status_code == 416:
            return HttpResponse(
                status=416, headers={"Content-Range": upstream.headers.get("Content-Range", "bytes */0")}
            )
        if upstream.status_code not in (200, 206):
            raise ArchiveUnavailable()
        content_type = upstream.headers.get("Content-Type", "").split(";")[0].strip().lower()
        if not (
            content_type.startswith(("video/", "audio/"))
            or content_type
            in {
                "application/octet-stream",
                "application/vnd.apple.mpegurl",
                "application/x-mpegurl",
                "text/vtt",
            }
        ):
            raise ArchiveUnavailable()
        if not playlist and upstream.headers.get("Content-Encoding", "").lower() not in {"", "identity"}:
            raise ArchiveUnavailable()
        output = {
            key: upstream.headers[key]
            for key in (
                "Content-Length",
                "Content-Range",
                "Accept-Ranges",
            )
            if key in upstream.headers
        }
        if request.method == "HEAD":
            return HttpResponse(status=upstream.status_code, content_type=content_type, headers=output)
        if playlist:
            if upstream.status_code != 200:
                raise ArchiveUnavailable()
            data = bytearray()
            for chunk in upstream.iter_content(chunk_size=64 * 1024):
                if len(data) + len(chunk) > MAX_PLAYLIST_BYTES:
                    raise ArchiveUnavailable()
                data.extend(chunk)
            text = _playlist(data.decode("utf-8-sig"), url, root, token)
            return HttpResponse(text, content_type="application/vnd.apple.mpegurl")
        chunks = _Chunks(upstream, session)
        stream = _AsyncChunks(chunks) if isinstance(getattr(request, "_request", request), ASGIRequest) else chunks
        response = StreamingHttpResponse(stream, status=upstream.status_code, content_type=content_type, headers=output)
        streaming = True  # The streaming response owns both resources, including early close.
        return response
    except (requests.RequestException, UnicodeError, ValueError):
        raise ArchiveUnavailable()
    finally:
        if not streaming:
            if upstream is not None:
                upstream.close()
            session.close()
