"""Player media grants do not require project membership or expose generic media routes."""

import asyncio
import json
import hashlib
import re
import threading
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from uuid import uuid4

from django.test import AsyncClient, TestCase, override_settings
from asgiref.sync import async_to_sync, sync_to_async
from django.core.signals import request_finished
from django.db import close_old_connections
from rest_framework.test import APIClient
from requests import Response as UpstreamResponse

from plane.db.models import Issue, Project, ProjectMember, RosterPlayer, State, User, Workspace, WorkspaceMember


class PlayerMediaContractTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create(email="media-player@fixture.test", username="media-player")
        cls.other = User.objects.create(email="media-other@fixture.test", username="media-other")
        cls.workspace = Workspace.objects.create(name="Media School", slug="media-school", owner=cls.other)
        cls.membership = WorkspaceMember.objects.create(workspace=cls.workspace, member=cls.user, role=5)
        cls.project = Project.objects.create(workspace=cls.workspace, name="Football", identifier="MED")
        cls.player = RosterPlayer.objects.create(project=cls.project, user=cls.user, player_name="Media Player")
        cls.state = State.objects.create(project=cls.project, name="Assigned", group="started")
        cls.card = Issue.objects.create(
            project=cls.project,
            state=cls.state,
            name="Review this clip",
            category="Coaching Card",
            roster_player=cls.player,
            coaching_card_data={
                "source_media": {"package_id": "film", "artifact_id": "movie"},
                "playlists": [{"id": "p", "name": "Film", "clips": [{"id": "movie", "title": "Clip"}]}],
            },
        )

    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.settings_override = override_settings(MEDIA_LIBRARY_ROOT=self.temp.name)
        self.settings_override.enable()
        self.addCleanup(self.settings_override.disable)
        self.package = self.root / "projects" / str(self.project.id) / "packages" / "film"
        self.file = self.package / "artifacts" / "movie.mp4"
        self.file.parent.mkdir(parents=True)
        self.file.write_bytes(b"test-video-bytes")
        self.manifest = self.package / "manifest.json"
        self.write_manifest(self.file)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.grant_path = (
            f"/api/player/workspaces/{self.workspace.slug}/projects/{self.project.id}/"
            f"coaching-cards/{self.card.id}/clips/0/playback/"
        )

    def write_manifest(self, path):
        self.manifest.write_text(json.dumps({"artifacts": [{"name": "movie", "path": str(path)}]}))

    def grant(self):
        result = self.client.get(self.grant_path)
        self.assertEqual(result.status_code, 200, result.content)
        self.assertIn("no-store", result["Cache-Control"])
        return result.json()["source_url"]

    def read(self, path, **headers):
        response = APIClient().get(path, **headers)
        if response.streaming:
            try:
                content = b"".join(response.streaming_content)
            finally:
                if not response.closed:
                    response.close()
        else:
            content = response.content
        return response, content

    def test_assigned_player_without_project_role_gets_a_cookie_free_signed_file(self):
        self.assertFalse(ProjectMember.objects.filter(member=self.user, project=self.project).exists())
        response, content = self.read(self.grant())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(content, b"test-video-bytes")
        self.assertEqual(response["Content-Type"], "video/mp4")
        self.assertIn("no-store", response["Cache-Control"])
        self.assertFalse(response.has_header("Set-Cookie"))

    def test_progressive_ranges_and_head_do_not_load_the_whole_video(self):
        url = self.grant()
        response, content = self.read(url, HTTP_RANGE="bytes=5-9")
        self.assertEqual(response.status_code, 206)
        self.assertEqual(content, b"video")
        self.assertEqual(response["Content-Range"], "bytes 5-9/16")
        self.assertEqual(response["Content-Length"], "5")
        response = APIClient().head(url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Length"], "16")
        self.assertEqual(response.content, b"")

    def test_invalid_ranges_are_rejected(self):
        url = self.grant()
        for value in ("bytes=999-", "bytes=5-2", "bytes=0-1,4-5", "invalid"):
            with self.subTest(value=value):
                response, _ = self.read(url, HTTP_RANGE=value)
                self.assertEqual(response.status_code, 416)

    def test_grant_requires_authentication_eligibility_and_assignment(self):
        self.assertIn(APIClient().get(self.grant_path).status_code, [401, 403])
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(self.grant_path).status_code, 404)
        self.client.force_authenticate(self.user)
        RosterPlayer.objects.filter(pk=self.player.pk).update(status="inactive")
        self.assertEqual(self.client.get(self.grant_path).status_code, 404)

    def test_invalid_card_clip_and_workspace_cannot_issue_a_grant(self):
        for path in (
            self.grant_path.replace(str(self.card.id), str(uuid4())),
            self.grant_path.replace("/clips/0/", "/clips/9/"),
            self.grant_path.replace("media-school", "another-school"),
        ):
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 404)

    def test_tampered_and_expired_links_fail_closed(self):
        url = self.grant()
        prefix, token, resource = url.rsplit("/", 2)
        response, _ = self.read(f"{prefix}/{token}tampered/{resource}")
        self.assertEqual(response.status_code, 403)
        with patch("django.core.signing.time.time", return_value=0):
            expired = self.grant()
        response, _ = self.read(expired)
        self.assertEqual(response.status_code, 403)

    def test_revoked_membership_or_assignment_invalidates_an_existing_link(self):
        url = self.grant()
        Issue.objects.filter(pk=self.card.pk).update(roster_player=None)
        self.assertEqual(self.read(url)[0].status_code, 404)
        Issue.objects.filter(pk=self.card.pk).update(roster_player=self.player)
        WorkspaceMember.objects.filter(pk=self.membership.pk).update(is_active=False)
        self.assertEqual(self.read(url)[0].status_code, 404)

    def test_source_changes_invalidate_an_existing_link(self):
        url = self.grant()
        replacement = self.file.with_name("replacement.mp4")
        replacement.write_bytes(b"different-private-video")
        self.write_manifest(replacement)
        self.assertEqual(self.read(url)[0].status_code, 403)

    def test_shared_card_assignment_and_absolute_same_server_source_are_supported(self):
        data = self.card.coaching_card_data.copy()
        data["recipient_ids"] = [str(self.player.pk)]
        data["playlists"] = [
            {
                "id": "p",
                "name": "Film",
                "clips": [
                    {
                        "id": "movie",
                        "title": "Clip",
                        "source_url": (
                            f"http://testserver/api/workspaces/{self.workspace.slug}/projects/{self.project.pk}/"
                            "media-library/packages/film/artifacts/movie/file/"
                        ),
                    }
                ],
            }
        ]
        Issue.objects.filter(pk=self.card.pk).update(roster_player=None, coaching_card_data=data)
        self.assertEqual(self.read(self.grant())[1], b"test-video-bytes")

    def test_external_source_is_not_silently_replaced_with_local_media(self):
        data = self.card.coaching_card_data.copy()
        data["playlists"] = [
            {
                "id": "p",
                "name": "Film",
                "clips": [
                    {
                        "id": "movie",
                        "title": "Clip",
                        "source_url": (
                            f"https://another-server.example/api/workspaces/{self.workspace.slug}/projects/{self.project.pk}/"
                            "media-library/packages/film/artifacts/movie/file/"
                        ),
                    }
                ],
            }
        ]
        Issue.objects.filter(pk=self.card.pk).update(coaching_card_data=data)
        self.assertEqual(self.client.get(self.grant_path).status_code, 422)

    def test_stale_clip_identity_cannot_select_a_reordered_or_changed_clip(self):
        identity = '["movie",null,null,null,null,null,null,null,null,null,"film","movie"]'
        revision = hashlib.sha256(identity.encode()).hexdigest()
        path = self.grant_path + "?revision=" + revision
        self.assertEqual(self.client.get(path).status_code, 200)
        data = self.card.coaching_card_data.copy()
        data["playlists"] = [{"id": "p", "name": "Film", "clips": [{"id": "different", "title": "Other"}]}]
        Issue.objects.filter(pk=self.card.pk).update(coaching_card_data=data)
        self.assertEqual(self.client.get(path).status_code, 409)

    def test_assigned_external_transcode_artifact_returns_its_existing_https_delivery_url(self):
        url = "https://media.example/media/fixture/master.m3u8?signature=fixture"
        self.write_manifest(url)
        response = self.client.get(self.grant_path)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["source_url"], url)
        self.assertEqual(response.json()["content_type"], "hls")
        self.assertEqual(response.json()["delivery"], "external")

    def test_client_clock_identity_preserves_zero_offsets_and_detects_duration_changes(self):
        data = self.card.coaching_card_data.copy()
        data["playlists"] = [
            {
                "id": "p",
                "name": "Film",
                "clips": [
                    {
                        "id": "movie",
                        "title": "Clip",
                        "start_seconds": 0,
                        "end_seconds": None,
                        "source_start_seconds": 0,
                        "duration_seconds": 12.5,
                        "playback_mode": "clip",
                    }
                ],
            }
        ]
        Issue.objects.filter(pk=self.card.pk).update(coaching_card_data=data)
        identity = '["movie",null,null,null,null,0,null,0,12500000,"clip","film","movie"]'
        path = self.grant_path + "?revision=" + hashlib.sha256(identity.encode()).hexdigest()
        self.assertEqual(self.client.get(path).status_code, 200)
        data["playlists"][0]["clips"][0]["duration_seconds"] = 14
        Issue.objects.filter(pk=self.card.pk).update(coaching_card_data=data)
        self.assertEqual(self.client.get(path).status_code, 409)

    @override_settings(PLAYER_ARCHIVED_HLS_BASE_URL="https://archive.fixture.test/hls")
    def test_saved_event_playlist_filename_resolves_without_an_upload_or_broad_media_permission(self):
        data = {
            "playlists": [
                {
                    "id": "event",
                    "name": "Tagged film",
                    "clips": [
                        {
                            "id": "tagged",
                            "title": "Play",
                            "source_url": "tagged-playlist.m3u8",
                            "event_id": "fixture-event",
                            "start_seconds": 181,
                            "end_seconds": 189,
                            "duration_seconds": 8,
                        }
                    ],
                }
            ],
        }
        Issue.objects.filter(pk=self.card.pk).update(coaching_card_data=data)
        response = self.client.get(self.grant_path)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["source_url"].startswith("/api/player/media/"))
        self.assertEqual(response.json()["delivery"], "signed")
        self.assertEqual(response.json()["content_type"], "hls")
        self.assertFalse(ProjectMember.objects.filter(member=self.user, project=self.project).exists())

    @override_settings(
        PLAYER_ARCHIVED_HLS_BASE_URL="", SERVICE_GATEWAY_EVENT_API="https://events.fixture.test/sports/api/event"
    )
    def test_archive_filename_uses_the_existing_configured_event_origin_hls_contract(self):
        data = {
            "playlists": [
                {
                    "id": "p",
                    "name": "Film",
                    "clips": [
                        {
                            "id": "tagged",
                            "title": "Play",
                            "source_url": "saved-playlist.m3u8",
                        }
                    ],
                }
            ]
        }
        Issue.objects.filter(pk=self.card.pk).update(coaching_card_data=data)
        response = self.client.get(self.grant_path)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["source_url"].startswith("/api/player/media/"))

    def archive_grant(self):
        Issue.objects.filter(pk=self.card.pk).update(
            coaching_card_data={
                "playlists": [
                    {
                        "id": "p",
                        "name": "Film",
                        "clips": [{"id": "tagged", "title": "Play", "source_url": "saved-playlist.m3u8"}],
                    }
                ]
            }
        )
        return self.grant()

    @staticmethod
    def upstream(content, content_type="application/vnd.apple.mpegurl", status=200, **headers):
        response = UpstreamResponse()
        response.status_code = status
        response.headers.update({"Content-Type": content_type, **headers})
        response._content = content.encode() if isinstance(content, str) else content
        response._content_consumed = True
        return response

    @override_settings(PLAYER_ARCHIVED_HLS_BASE_URL="https://archive.fixture.test/hls")
    def test_archived_init_and_fragment_stream_through_signed_routes_without_cors_or_cookies(self):
        url = self.archive_grant()
        playlist = '#EXTM3U\n#EXT-X-MAP:URI="recording/init.m4s"\n#EXTINF:8,\nrecording/seg.m4s\n'
        responses = [
            self.upstream(playlist),
            self.upstream(b"init", "video/mp4"),
            self.upstream(b"fragment", "video/iso.segment", 206, **{"Content-Range": "bytes 0-7/20"}),
        ]
        with patch("requests.sessions.Session.get", side_effect=responses) as fetch:
            response, body = self.read(url)
            self.assertEqual(response.status_code, 200)
            text = body.decode()
            self.assertNotIn("https://archive.fixture.test", text)
            resources = re.findall(r'/api/player/media/[^\s"]+', text)
            self.assertEqual(len(resources), 2)
            self.assertEqual(self.read(resources[0])[1], b"init")
            segment, data = self.read(resources[1], HTTP_RANGE="bytes=0-7")
            self.assertEqual(segment.status_code, 206)
            self.assertEqual(data, b"fragment")
            self.assertEqual(segment["Content-Range"], "bytes 0-7/20")
            self.assertEqual(
                [call.args[0] for call in fetch.call_args_list],
                [
                    "https://archive.fixture.test/hls/saved-playlist.m3u8",
                    "https://archive.fixture.test/hls/recording/init.m4s",
                    "https://archive.fixture.test/hls/recording/seg.m4s",
                ],
            )
            for call in fetch.call_args_list:
                self.assertFalse(call.kwargs["allow_redirects"])
                self.assertNotIn("Cookie", call.kwargs["headers"])
                self.assertNotIn("Authorization", call.kwargs["headers"])
            self.assertEqual(fetch.call_args_list[-1].kwargs["headers"]["Range"], "bytes=0-7")

    @override_settings(PLAYER_ARCHIVED_HLS_BASE_URL="https://archive.fixture.test/hls")
    def test_archive_playlist_rejects_external_private_and_unsafe_resources(self):
        url = self.archive_grant()
        for reference in [
            "https://other.fixture.test/hls/private.ts",
            "/private.ts",
            "../private.ts",
            "https://archive.fixture.test/hls/../private.ts",
            "//archive.fixture.test/hls/../private.ts",
            "%2e%2e/private.ts",
            "https://user:pass@archive.fixture.test/hls/key.key",
        ]:
            with (
                self.subTest(reference=reference),
                patch("requests.sessions.Session.get", return_value=self.upstream("#EXTM3U\n" + reference)),
            ):
                self.assertEqual(self.read(url)[0].status_code, 502)

    @override_settings(PLAYER_ARCHIVED_HLS_BASE_URL="https://archive.fixture.test/hls")
    def test_archive_resources_need_a_signature_and_current_assignment(self):
        url = self.archive_grant()
        with patch(
            "requests.sessions.Session.get", return_value=self.upstream("#EXTM3U\nrecording/segment.ts\n")
        ) as fetch:
            _, body = self.read(url)
            segment = re.findall(r'/api/player/media/[^\s"]+', body.decode())[0]
            fetch.reset_mock()
            self.assertIn(self.read(url.rsplit("/", 1)[0] + "/private.ts")[0].status_code, [403, 404])
            self.assertIn(self.read(segment.replace("/refs/", "/refs/tampered"))[0].status_code, [403, 404])
            Issue.objects.filter(pk=self.card.pk).update(roster_player=None)
            self.assertEqual(self.read(segment)[0].status_code, 404)
            fetch.assert_not_called()

    @override_settings(PLAYER_ARCHIVED_HLS_BASE_URL="https://archive.fixture.test/hls")
    def test_archive_redirect_html_and_oversized_playlists_fail_without_exposing_upstream_content(self):
        url = self.archive_grant()
        for upstream in [
            self.upstream("private redirect", status=302, Location="https://other.fixture.test"),
            self.upstream("private login page", "text/html"),
            self.upstream("#EXTM3U\n" + "#" * (2 * 1024 * 1024)),
        ]:
            with (
                self.subTest(status=upstream.status_code),
                patch("requests.sessions.Session.get", return_value=upstream),
            ):
                response, body = self.read(url)
                self.assertEqual(response.status_code, 502)
                self.assertNotIn(b"private", body)

    @override_settings(PLAYER_ARCHIVED_HLS_BASE_URL="https://archive.fixture.test/hls")
    def test_archive_head_and_early_disconnect_close_the_upstream_response(self):
        url = self.archive_grant()
        with patch("requests.sessions.Session.get", return_value=self.upstream("#EXTM3U\nsegment.ts\n")):
            _, body = self.read(url)
        segment = re.findall(r'/api/player/media/[^\s"]+', body.decode())[0]
        for method in ("head", "get"):
            upstream = self.upstream(b"segment", "video/mp2t", **{"Content-Length": "7"})
            with (
                self.subTest(method=method),
                patch("requests.sessions.Session.get", return_value=upstream),
                patch.object(upstream, "close", wraps=upstream.close) as close,
            ):
                response = getattr(APIClient(), method)(segment)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response["Content-Length"], "7")
                # Django's test-client iterator normally shields the transaction from this signal.
                request_finished.disconnect(close_old_connections)
                try:
                    response.close()
                finally:
                    request_finished.connect(close_old_connections)
                close.assert_called()

    @override_settings(PLAYER_ARCHIVED_HLS_BASE_URL="https://archive.fixture.test/hls")
    def test_archive_source_change_and_expiry_do_not_fetch_remote_bytes(self):
        url = self.archive_grant()
        with patch("requests.sessions.Session.get") as fetch:
            with override_settings(PLAYER_ARCHIVED_HLS_BASE_URL="https://replacement.fixture.test/hls"):
                self.assertEqual(self.read(url)[0].status_code, 403)
            with patch("django.core.signing.time.time", return_value=0):
                expired = self.archive_grant()
            self.assertEqual(self.read(expired)[0].status_code, 403)
            fetch.assert_not_called()

    @override_settings(PLAYER_ARCHIVED_HLS_BASE_URL="https://archive.fixture.test/hls")
    def test_archive_nested_playlists_and_keys_preserve_exact_relative_references(self):
        url = self.archive_grant()
        with patch(
            "requests.sessions.Session.get",
            side_effect=[
                self.upstream("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2000\nrecording/variant.m3u8\n"),
                self.upstream('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.key"\n#EXTINF:8,\nsegment.ts\n'),
                self.upstream(b"1234567890123456", "application/octet-stream"),
            ],
        ) as fetch:
            _, body = self.read(url)
            variant = re.findall(r'/api/player/media/[^\s"]+', body.decode())[0]
            _, body = self.read(variant)
            key = re.findall(r'/api/player/media/[^\s"]+', body.decode())[0]
            self.assertEqual(self.read(key)[1], b"1234567890123456")
            self.assertEqual(fetch.call_args_list[-1].args[0], "https://archive.fixture.test/hls/recording/key.key")

    @override_settings(PLAYER_ARCHIVED_HLS_BASE_URL="https://archive.fixture.test/hls")
    def test_archive_decoding_cannot_forward_a_stale_compressed_binary_length(self):
        url = self.archive_grant()
        with patch("requests.sessions.Session.get", return_value=self.upstream("#EXTM3U\nsegment.ts\n")):
            _, body = self.read(url)
        segment = re.findall(r'/api/player/media/[^\s"]+', body.decode())[0]
        upstream = self.upstream(b"decoded", "video/mp2t", **{"Content-Encoding": "gzip", "Content-Length": "100"})
        with patch("requests.sessions.Session.get", return_value=upstream):
            self.assertEqual(self.read(segment)[0].status_code, 502)

    @override_settings(PLAYER_ARCHIVED_HLS_BASE_URL="https://archive.fixture.test/hls")
    def test_archive_asgi_streams_incrementally_and_closes_on_early_disconnect(self):
        url = self.archive_grant()
        with patch("requests.sessions.Session.get", return_value=self.upstream("#EXTM3U\nsegment.ts\n")):
            _, body = self.read(url)
        segment = re.findall(r'/api/player/media/[^\s"]+', body.decode())[0]
        read = []

        def chunks(chunk_size):
            read.append(1)
            yield b"first"
            read.append(2)
            yield b"second"

        upstream = self.upstream(b"", "video/mp2t")
        with (
            patch("requests.sessions.Session.get", return_value=upstream),
            patch.object(upstream, "iter_content", side_effect=chunks),
            patch.object(upstream, "close", wraps=upstream.close) as close,
        ):

            async def consume():
                response = await AsyncClient().get(segment)
                self.assertTrue(response.is_async)
                self.assertEqual(read, [])
                iterator = response.streaming_content.__aiter__()
                self.assertEqual(await iterator.__anext__(), b"first")
                self.assertEqual(read, [1])
                await iterator.aclose()
                # ASGIHandler closes the response after its outer iterator is cancelled.
                await sync_to_async(response.close, thread_sensitive=False)()
                close.assert_called()

            async_to_sync(consume)()
        self.assertEqual(read, [1])

    @override_settings(PLAYER_ARCHIVED_HLS_BASE_URL="https://archive.fixture.test/hls")
    def test_archive_asgi_cancellation_closes_an_inflight_blocking_read(self):
        url = self.archive_grant()
        with patch("requests.sessions.Session.get", return_value=self.upstream("#EXTM3U\nsegment.ts\n")):
            _, body = self.read(url)
        segment = re.findall(r'/api/player/media/[^\s"]+', body.decode())[0]
        started, unblock = threading.Event(), threading.Event()

        def chunks(chunk_size):
            yield b"first"
            started.set()
            if not unblock.wait(3):
                raise AssertionError("Cancellation did not close the upstream read")
            yield b"second"

        upstream = self.upstream(b"", "video/mp2t")
        original_close = upstream.close

        def close_response():
            unblock.set()
            original_close()

        with (
            patch("requests.sessions.Session.get", return_value=upstream),
            patch.object(upstream, "iter_content", side_effect=chunks),
            patch.object(upstream, "close", side_effect=close_response) as close,
        ):

            async def consume():
                response = await AsyncClient().get(segment)
                iterator = response.streaming_content.__aiter__()
                self.assertEqual(await iterator.__anext__(), b"first")
                pending = asyncio.create_task(iterator.__anext__())
                try:
                    self.assertTrue(await asyncio.to_thread(started.wait, 2))
                    pending.cancel()
                    with self.assertRaises(asyncio.CancelledError):
                        await pending
                    close.assert_called()
                finally:
                    unblock.set()
                    if not pending.done():
                        pending.cancel()

            async_to_sync(consume)()

    @override_settings(PLAYER_ARCHIVED_HLS_BASE_URL="https://archive.fixture.test/hls")
    def test_archive_source_cannot_traverse_or_supply_an_arbitrary_url(self):
        for source in ("../private.m3u8", "%2e%2e/private.m3u8", "//other.test/film.m3u8", "saved.m3u8?secret=value"):
            data = {
                "playlists": [
                    {
                        "id": "p",
                        "name": "Film",
                        "clips": [
                            {
                                "id": "tagged",
                                "title": "Play",
                                "source_url": source,
                            }
                        ],
                    }
                ]
            }
            Issue.objects.filter(pk=self.card.pk).update(coaching_card_data=data)
            with self.subTest(source=source):
                self.assertEqual(self.client.get(self.grant_path).status_code, 422)

    def test_grant_does_not_authorize_neighbor_files_or_path_traversal(self):
        url = self.grant()
        self.file.with_name("private.mp4").write_bytes(b"private")
        prefix = url.rsplit("/", 1)[0]
        for name in ("private.mp4", "../manifest.json", "%2e%2e/manifest.json", "movie.mp4/extra"):
            with self.subTest(name=name):
                self.assertIn(self.read(prefix + "/" + name)[0].status_code, [403, 404])
        self.write_manifest(self.root / "outside.mp4")
        self.assertEqual(self.client.get(self.grant_path).status_code, 422)

    def test_hls_grant_limits_segments_to_its_artifact_directory(self):
        folder = self.file.parent / "movie"
        folder.mkdir()
        playlist = folder / "index.m3u8"
        playlist.write_text("#EXTM3U\n#EXTINF:1,\nsegment.ts\n")
        (folder / "segment.ts").write_bytes(b"segment")
        (folder / "key.key").write_bytes(b"1234567890123456")
        self.write_manifest(playlist)
        url = self.grant()
        self.assertEqual(self.read(url)[1], playlist.read_bytes())
        response, content = self.read(url.replace("index.m3u8", "segment.ts"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(content, b"segment")
        key_response, key_content = self.read(url.replace("index.m3u8", "key.key"))
        self.assertEqual(key_response["Content-Type"], "application/octet-stream")
        self.assertEqual(key_content, b"1234567890123456")
        self.assertIn(self.read(url.replace("index.m3u8", "../movie.mp4"))[0].status_code, [403, 404])
