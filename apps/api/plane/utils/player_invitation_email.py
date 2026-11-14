"""Self-contained invitation artwork, bundled with the API/worker image."""

from email.mime.image import MIMEImage
from pathlib import Path


ASSET_DIRECTORY = Path(__file__).resolve().parents[2] / "templates/emails/invitations/assets"
ASSET_NAMES = ("logo", "hero", "program", "activities", "progress", "comments", "link", "info")


def attach_player_invitation_images(message, html):
    message.mixed_subtype = "related"
    for name in ASSET_NAMES:
        content_id = f"player-invitation-{name}"
        if f"cid:{content_id}" not in html:
            continue
        image = MIMEImage((ASSET_DIRECTORY / f"{name}.png").read_bytes(), _subtype="png")
        image.add_header("Content-ID", f"<{content_id}>")
        image.add_header("Content-Disposition", "inline", filename=f"player-invitation-{name}.png")
        message.attach(image)
