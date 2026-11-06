"""Private clip messages retain participant and source authorization."""

import subprocess
import tempfile
from pathlib import Path
from unittest.mock import patch
from django.test import override_settings
from plane.tests.contract.app import test_private_card_thread


class PrivateCardAttachmentTests(test_private_card_thread.PrivateCardThreadTests):
    def setUp(self):
        super().setUp()
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        settings = override_settings(PRIVATE_CONVERSATION_MEDIA_ROOT=self.directory.name)
        settings.enable()
        self.addCleanup(settings.disable)
        self.client.force_authenticate(self.players[0])

    def upload(self, actor=None, url=None):
        path = Path(self.directory.name) / "fixture.mp4"
        subprocess.run(
            [
                "ffmpeg",
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=c=black:s=32x32:d=1",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-y",
                str(path),
            ],
            check=True,
        )
        self.client.force_authenticate(actor or self.players[0])
        return self.client.post(
            (url or self.url) + "attachments/",
            path.read_bytes(),
            content_type="video/mp4",
            HTTP_X_VIDEO_NAME="practice.mp4",
        )

    def test_catalog_advertises_private_attachment_capability(self):
        response = self.client.get(self.url + "attachments/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["max_bytes"], 1024 * 1024 * 1024)
        self.assertEqual(response.json()["visibility"], "private")

    def test_phone_video_can_be_sent_without_text_and_coach_can_reply(self):
        uploaded = self.upload()
        self.assertEqual(uploaded.status_code, 201)
        payload = {
            "visibility": "private",
            "comment_html": "",
            "attachment": {"kind": "upload", "id": uploaded.json()["id"]},
            "client_id": "phone-message-1",
        }
        sent = self.client.post(self.url, payload, format="json")
        self.assertEqual(sent.status_code, 201)
        self.assertEqual(sent.json()["attachment"]["name"], "practice.mp4")
        self.client.force_authenticate(self.coach)
        self.assertEqual(
            self.client.get(self.coach_url).json()["results"][0]["attachment"]["id"], uploaded.json()["id"]
        )
        coach_upload = self.upload(self.coach, self.coach_url)
        payload["attachment"]["id"] = coach_upload.json()["id"]
        payload["client_id"] = "coach-message-1"
        self.assertEqual(self.client.post(self.coach_url, payload, format="json").status_code, 201)

    def test_peer_cannot_use_upload_or_guess_playback(self):
        uploaded = self.upload()
        self.assertEqual(uploaded.status_code, 201)
        attachment_id = uploaded.json()["id"]
        self.client.force_authenticate(self.players[1])
        self.assertEqual(
            self.client.post(
                self.url,
                {
                    "visibility": "private",
                    "comment_html": "",
                    "attachment": {"kind": "upload", "id": attachment_id},
                    "client_id": "peer-attempt",
                },
                format="json",
            ).status_code,
            404,
        )
        self.assertEqual(self.client.get(self.url + f"attachments/{attachment_id}/playback/").status_code, 404)

    def test_retry_is_idempotent_and_changed_payload_is_rejected(self):
        uploaded = self.upload()
        self.assertEqual(uploaded.status_code, 201)
        payload = {
            "visibility": "private",
            "comment_html": "",
            "attachment": {"kind": "upload", "id": uploaded.json()["id"]},
            "client_id": "retry-message-1",
        }
        first = self.client.post(self.url, payload, format="json")
        again = self.client.post(self.url, payload, format="json")
        self.assertEqual(first.status_code, 201)
        self.assertEqual(again.status_code, 200)
        self.assertEqual(first.json()["id"], again.json()["id"])
        payload["comment_html"] = "<p>Changed</p>"
        self.assertEqual(self.client.post(self.url, payload, format="json").status_code, 409)
        self.assertEqual(self.client.get(self.url).json()["total_count"], 1)

    def test_signed_range_access_stops_on_delete_or_assignment_revocation(self):
        uploaded = self.upload()
        self.assertEqual(uploaded.status_code, 201)
        aid = uploaded.json()["id"]
        sent = self.client.post(
            self.url,
            {
                "visibility": "private",
                "comment_html": "",
                "attachment": {"kind": "upload", "id": aid},
                "client_id": "range-message",
            },
            format="json",
        )
        grant = self.client.get(self.url + f"attachments/{aid}/playback/")
        self.assertEqual(grant.status_code, 200)
        media = grant.json()["source_url"]
        self.client.force_authenticate(None)
        response = self.client.get(media, HTTP_RANGE="bytes=0-15")
        self.assertEqual(response.status_code, 206)
        self.assertEqual(len(b"".join(response.streaming_content)), 16)
        self.client.force_authenticate(self.players[0])
        self.assertEqual(self.client.delete(self.url + sent.json()["id"] + "/").status_code, 204)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(media).status_code, 404)

    def test_upload_rejects_spoofed_content_and_oversize_without_saving(self):
        response = self.client.post(self.url + "attachments/", b"not a movie", content_type="video/mp4")
        self.assertEqual(response.status_code, 400)
        response = self.client.post(self.url + "attachments/", b"bytes", content_type="text/html")
        self.assertEqual(response.status_code, 400)
        response = self.client.post(
            self.url + "attachments/", b"bytes", content_type="video/mp4", HTTP_X_VIDEO_SIZE=str(1024 * 1024 * 1024 + 1)
        )
        self.assertEqual(response.status_code, 400)

    def test_existing_clip_is_pinned_and_reordered_source_is_unavailable(self):
        clips = [
            {"id": "first", "name": "First", "start_seconds": 1, "end_seconds": 2, "source_url": "first.m3u8"},
            {"id": "second", "name": "Second", "start_seconds": 3, "end_seconds": 4, "source_url": "second.m3u8"},
        ]
        self.card.coaching_card_data = {
            **self.card.coaching_card_data,
            "playlists": [{"id": "p", "name": "p", "clips": clips}],
        }
        self.card.save(update_fields=["coaching_card_data"], disable_auto_set_user=True)
        with override_settings(PLAYER_ARCHIVED_HLS_BASE_URL="https://archive.fixture.invalid/hls"):
            options = self.client.get(self.url + "attachments/")
            self.assertEqual(options.status_code, 200)
            choice = options.json()["clips"][0]
            sent = self.client.post(
                self.url,
                {
                    "visibility": "private",
                    "comment_html": "",
                    "attachment": {
                        "kind": "card_clip",
                        "clip_index": choice["clip_index"],
                        "revision": choice["revision"],
                    },
                    "client_id": "existing-message",
                },
                format="json",
            )
            self.assertEqual(sent.status_code, 201)
            aid = sent.json()["attachment"]["id"]
            self.card.coaching_card_data["playlists"][0]["clips"].reverse()
            self.card.save(update_fields=["coaching_card_data"], disable_auto_set_user=True)
            self.assertEqual(self.client.get(self.url + f"attachments/{aid}/playback/").status_code, 409)

    def test_signed_upload_grant_rechecks_assignment_and_expiry(self):
        import time

        uploaded = self.upload()
        aid = uploaded.json()["id"]
        self.client.post(
            self.url,
            {
                "visibility": "private",
                "comment_html": "",
                "attachment": {"kind": "upload", "id": aid},
                "client_id": "expiry-message",
            },
            format="json",
        )
        grant = self.client.get(self.url + f"attachments/{aid}/playback/").json()
        self.client.force_authenticate(None)
        with patch("django.core.signing.time.time", return_value=time.time() + 301):
            self.assertEqual(self.client.get(grant["source_url"]).status_code, 403)
        self.card.coaching_card_data = {"recipient_ids": [str(self.rosters[1].id)]}
        self.card.save(update_fields=["coaching_card_data"], disable_auto_set_user=True)
        self.assertEqual(self.client.get(grant["source_url"]).status_code, 404)

    def test_foreign_fields_invalid_upload_id_and_reused_upload_fail_closed(self):
        for attachment in [
            {"kind": "upload", "id": "../secret"},
            {"kind": "upload", "id": str(self.card.id), "path": "secret"},
        ]:
            response = self.client.post(
                self.url,
                {"visibility": "private", "comment_html": "", "attachment": attachment, "client_id": "forged-message"},
                format="json",
            )
            self.assertIn(response.status_code, [400, 404])
        uploaded = self.upload()
        body = {
            "visibility": "private",
            "comment_html": "",
            "attachment": {"kind": "upload", "id": uploaded.json()["id"]},
            "client_id": "original-upload",
        }
        self.assertEqual(self.client.post(self.url, body, format="json").status_code, 201)
        body["client_id"] = "reused-upload"
        self.assertEqual(self.client.post(self.url, body, format="json").status_code, 404)

    def test_deleted_upload_cannot_be_reused_or_revive_old_grant(self):
        uploaded = self.upload()
        aid = uploaded.json()["id"]
        body = {
            "visibility": "private",
            "comment_html": "",
            "attachment": {"kind": "upload", "id": aid},
            "client_id": "deleted-retry",
        }
        sent = self.client.post(self.url, body, format="json").json()
        media = self.client.get(self.url + f"attachments/{aid}/playback/").json()["source_url"]
        self.assertEqual(self.client.delete(self.url + sent["id"] + "/").status_code, 204)
        self.assertEqual(self.client.post(self.url, body, format="json").status_code, 404)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(media).status_code, 404)

    def test_changed_archive_clock_invalidates_existing_attachment(self):
        clip = {
            "id": "first",
            "title": "First",
            "start_seconds": 120,
            "end_seconds": 125,
            "source_url": "first.m3u8",
            "playlist_start_seconds": 0,
            "playlist_duration_seconds": 10,
        }
        self.card.coaching_card_data = {
            **self.card.coaching_card_data,
            "playlists": [{"id": "p", "name": "p", "clips": [clip]}],
        }
        self.card.save(update_fields=["coaching_card_data"], disable_auto_set_user=True)
        with override_settings(PLAYER_ARCHIVED_HLS_BASE_URL="https://archive.fixture.invalid/hls"):
            choice = self.client.get(self.url + "attachments/").json()["clips"][0]
            sent = self.client.post(
                self.url,
                {
                    "visibility": "private",
                    "comment_html": "",
                    "attachment": {"kind": "card_clip", "clip_index": 0, "revision": choice["revision"]},
                    "client_id": "clock-message",
                },
                format="json",
            )
            self.assertEqual(sent.status_code, 201)
            clip["playlist_start_seconds"] = 5
            self.card.save(update_fields=["coaching_card_data"], disable_auto_set_user=True)
            aid = sent.json()["attachment"]["id"]
            self.assertEqual(self.client.get(self.url + f"attachments/{aid}/playback/").status_code, 409)

    def test_changed_resolved_external_artifact_invalidates_existing_attachment(self):
        self.card.coaching_card_data = {
            **self.card.coaching_card_data,
            "playlists": [
                {
                    "id": "p",
                    "name": "p",
                    "clips": [{"id": "first", "title": "First", "start_seconds": 0, "end_seconds": 2}],
                }
            ],
        }
        self.card.save(update_fields=["coaching_card_data"], disable_auto_set_user=True)
        source = ["https://cdn.fixture.invalid/first.mp4"]
        with patch(
            "plane.app.views.private_card_attachments._source",
            side_effect=lambda *args: (source[0], False, "a" * 64, "external"),
        ):
            choice = self.client.get(self.url + "attachments/").json()["clips"][0]
            sent = self.client.post(
                self.url,
                {
                    "visibility": "private",
                    "comment_html": "",
                    "attachment": {"kind": "card_clip", "clip_index": 0, "revision": choice["revision"]},
                    "client_id": "manifest-message",
                },
                format="json",
            )
            self.assertEqual(sent.status_code, 201)
            source[0] = "https://cdn.fixture.invalid/different.mp4"
            aid = sent.json()["attachment"]["id"]
            self.assertEqual(self.client.get(self.url + f"attachments/{aid}/playback/").status_code, 409)

    def test_repeated_cleanup_reaches_orphans_after_500_retained_files(self):
        import os
        import time
        import uuid
        from datetime import timedelta
        from io import StringIO
        from django.core.management import call_command
        from django.utils import timezone
        from plane.db.models import CoachingCardPrivateAttachment

        rows = [
            CoachingCardPrivateAttachment(
                issue=self.card,
                coach=self.coach,
                recipient=self.players[0],
                actor=self.players[0],
                kind="upload",
                name="retained.mp4",
                expires_at=timezone.now() + timedelta(days=1),
            )
            for _ in range(500)
        ]
        CoachingCardPrivateAttachment.objects.bulk_create(rows)
        live = [Path(self.directory.name) / (str(row.id) + ".mp4") for row in rows]
        orphan = [Path(self.directory.name) / (str(uuid.uuid4()) + ".mp4") for _ in range(2)]
        for path in live + orphan:
            path.write_bytes(b"x")
            os.utime(path, (time.time() - 172800, time.time() - 172800))
        with patch.object(Path, "iterdir", lambda root: iter(live + orphan)):
            for _ in range(3):
                call_command("cleanup_private_clips", stdout=StringIO())
        self.assertTrue(all(path.exists() for path in live))
        self.assertTrue(all(not path.exists() for path in orphan))

    def send_file(self, content, name, content_type, client_id="file-message", url=None):
        uploaded = self.client.post(
            (url or self.url) + "attachments/",
            content,
            content_type=content_type,
            HTTP_X_VIDEO_NAME=name,
            HTTP_X_VIDEO_SIZE=str(len(content)),
        )
        self.assertEqual(uploaded.status_code, 201, uploaded.data)
        sent = self.client.post(
            url or self.url,
            {
                "visibility": "private",
                "comment_html": "",
                "attachment": {"kind": "upload", "id": uploaded.json()["id"]},
                "client_id": client_id,
            },
            format="json",
        )
        self.assertEqual(sent.status_code, 201, sent.data)
        grant = self.client.get((url or self.url) + "attachments/" + uploaded.json()["id"] + "/playback/")
        self.assertEqual(grant.status_code, 200)
        return uploaded.json(), grant.json(), sent.json()

    def test_pdf_is_private_download_and_revoked_after_message_deletion(self):
        pdf = b"%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF"
        uploaded, grant, sent = self.send_file(pdf, "session-notes.pdf", "application/pdf")
        self.assertEqual(uploaded["media_type"], "document")
        self.assertEqual(grant["content_type"], "document")
        response = self.client.get(grant["source_url"])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "application/pdf")
        self.assertIn('attachment; filename="session-notes.pdf"', response["Content-Disposition"])
        self.assertEqual(response["X-Content-Type-Options"], "nosniff")
        self.assertEqual(b"".join(response.streaming_content), pdf)
        self.client.force_authenticate(self.coach)
        self.assertEqual(self.client.get(self.coach_url).json()["results"][0]["attachment"]["media_type"], "document")
        self.client.force_authenticate(self.players[0])
        self.assertEqual(self.client.delete(self.url + sent["id"] + "/").status_code, 204)
        self.assertEqual(self.client.get(grant["source_url"]).status_code, 404)

    def test_user_attachment_routes_preserve_coach_ownership_and_revoked_assignment(self):
        pdf = b"%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF"
        uploaded, grant, _ = self.send_file(pdf, "private-notes.pdf", "application/pdf")
        player_playback = self.url + "attachments/" + uploaded["id"] + "/playback/"
        coach_playback = self.coach_url + "attachments/" + uploaded["id"] + "/playback/"

        for actor in [self.players[0], self.players[1], self.other_coach]:
            self.client.force_authenticate(actor)
            self.assertEqual(self.client.get(self.coach_url + "attachments/").status_code, 404)
            self.assertEqual(self.client.get(coach_playback).status_code, 404)
            self.assertEqual(
                self.client.post(
                    self.coach_url + "attachments/",
                    pdf,
                    content_type="application/pdf",
                    HTTP_X_VIDEO_NAME="private-notes.pdf",
                ).status_code,
                404,
            )

        self.card.coaching_card_data = {"recipient_ids": [str(self.rosters[1].id)]}
        self.card.save(update_fields=["coaching_card_data"], disable_auto_set_user=True)
        for actor, url, playback in [
            (self.players[0], self.url, player_playback),
            (self.coach, self.coach_url, coach_playback),
        ]:
            self.client.force_authenticate(actor)
            self.assertEqual(self.client.get(url + "attachments/").status_code, 404)
            self.assertEqual(self.client.get(playback).status_code, 404)
            self.assertEqual(
                self.client.post(
                    url + "attachments/",
                    pdf,
                    content_type="application/pdf",
                    HTTP_X_VIDEO_NAME="private-notes.pdf",
                ).status_code,
                404,
            )
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(grant["source_url"]).status_code, 404)

    def test_png_preview_reuses_private_participant_authorization(self):
        import base64

        png = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1kAAAAASUVORK5CYII="
        )
        uploaded, grant, _ = self.send_file(png, "technique.png", "image/png")
        self.assertEqual(uploaded["media_type"], "image")
        self.assertEqual(grant["content_type"], "image")
        response = self.client.get(grant["source_url"])
        self.assertEqual(response["Content-Type"], "image/png")
        self.assertEqual(b"".join(response.streaming_content), png)
        self.client.force_authenticate(self.players[1])
        self.assertEqual(self.client.get(self.url + "attachments/" + uploaded["id"] + "/playback/").status_code, 404)

    def test_office_documents_validate_container_before_accepting(self):
        from io import BytesIO
        import zipfile

        data = BytesIO()
        with zipfile.ZipFile(data, "w") as archive:
            archive.writestr("[Content_Types].xml", "<Types/>")
            archive.writestr("word/document.xml", "<document/>")
        self.client.force_authenticate(self.coach)
        uploaded, grant, _ = self.send_file(
            data.getvalue(),
            "feedback.docx",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            url=self.coach_url,
        )
        self.assertEqual(uploaded["media_type"], "document")
        self.assertEqual(self.client.get(grant["source_url"]).status_code, 200)

    def test_spoofed_documents_images_and_active_file_types_are_rejected(self):
        for name, mime, payload in (
            ("notes.pdf", "application/pdf", b"<html>not PDF</html>"),
            ("photo.png", "image/png", b"not an image"),
            ("notes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", b"not a package"),
            ("page.html", "text/html", b"<html/>"),
        ):
            with self.subTest(name=name):
                response = self.client.post(
                    self.url + "attachments/",
                    payload,
                    content_type=mime,
                    HTTP_X_VIDEO_NAME=name,
                    HTTP_X_VIDEO_SIZE=str(len(payload)),
                )
                self.assertEqual(response.status_code, 400)
