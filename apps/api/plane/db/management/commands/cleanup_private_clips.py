"""Run periodically to remove expired unbound private uploads and deleted-message files."""

from datetime import timedelta
import re
from django.core.management.base import BaseCommand
from django.utils import timezone
from plane.db.models import CoachingCardPrivateAttachment
from plane.app.views.private_card_attachments import storage_root, upload_file


class Command(BaseCommand):
    help = "Remove at most 500 expired private conversation uploads and 500 orphan files."

    def handle(self, *args, **options):
        count = 0
        for item in CoachingCardPrivateAttachment.objects.filter(
            message__isnull=True, expires_at__lt=timezone.now()
        ).order_by("expires_at")[:500]:
            if item.kind == "upload":
                upload_file(item).unlink(missing_ok=True)
            item.delete()
            count += 1
        cutoff = (timezone.now() - timedelta(days=1)).timestamp()
        # Bounded scan; opaque filenames only. Missing DB rows include cascading card deletion.
        # Persist a lexical cursor so retained live files cannot starve later orphans.
        # Filename enumeration uses bounded memory; only 500 files incur stat/DB work.
        import heapq
        import tempfile
        import os

        root = storage_root()
        cursor_file = root / ".cleanup-cursor"
        cursor = cursor_file.read_text()[:255] if cursor_file.is_file() else ""
        names = heapq.nsmallest(
            500,
            (
                path.name
                for path in root.iterdir()
                if path.name > cursor
                and (path.name.startswith("upload-") or re.fullmatch(r"[a-f0-9-]{36}\.mp4", path.name))
            ),
        )
        for name in names:
            path = root / name
            if not path.is_file() or path.stat().st_mtime >= cutoff:
                continue
            if name.startswith("upload-") or not CoachingCardPrivateAttachment.objects.filter(pk=path.stem).exists():
                path.unlink(missing_ok=True)
                count += 1
        with tempfile.NamedTemporaryFile(mode="w", dir=root, prefix=".cleanup-cursor-", delete=False) as handle:
            handle.write(names[-1] if names else "")
            cursor_temporary = handle.name
        os.replace(cursor_temporary, cursor_file)
        self.stdout.write(f"Removed {count} expired private clip records/files.")
