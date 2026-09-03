import importlib
import json
from types import SimpleNamespace

import pytest


migration = importlib.import_module("plane.db.migrations.0124_move_custom_playlists_to_artifact_metadata")


class _QuerySet:
    def __init__(self, values, apply_soft_delete_filter=False):
        self.values = values
        self.apply_soft_delete_filter = apply_soft_delete_filter
        self.filter_kwargs = None

    def using(self, _alias):
        return self

    def filter(self, **kwargs):
        self.filter_kwargs = kwargs
        if self.apply_soft_delete_filter and kwargs == {"deleted_at__isnull": True}:
            self.values = [value for value in self.values if getattr(value, "deleted_at", None) is None]
        return self

    def order_by(self, _field):
        return self.values

    def values_list(self, *_fields):
        return self.values


@pytest.mark.unit
def test_move_custom_playlists_copies_active_rows_to_event_artifact_metadata(settings, tmp_path):
    settings.MEDIA_LIBRARY_ROOT = str(tmp_path)
    manifest_path = tmp_path / "projects" / "project-1" / "packages" / "package-1" / "manifest.json"
    manifest_path.parent.mkdir(parents=True)
    manifest_path.write_text(
        json.dumps(
            {
                "id": "package-1",
                "artifacts": [
                    {
                        "name": "coach-event-1",
                        "format": "json",
                        "work_item_id": "work-item-1",
                        "metadata_ref": "coach-event-1",
                    }
                ],
                "metadata": {
                    "coach-event-1": {
                        "artifact_type": "completed-event-json",
                        "sg_event_id": 42,
                        "existing": True,
                    }
                },
            }
        ),
        encoding="utf-8",
    )

    active_playlist = SimpleNamespace(
        id="playlist-1",
        event_id=42,
        name="First half",
        subtitle="Highlights",
        url="playlist-1.m3u8",
        thumbnail=None,
        clip=1,
        clips=[{"id": "tag-1", "title": "Goal"}],
        created_at=None,
        updated_at=None,
    )
    deleted_playlist = SimpleNamespace(**{**active_playlist.__dict__, "id": "deleted-playlist", "deleted_at": True})
    playlists = _QuerySet([active_playlist, deleted_playlist], apply_soft_delete_filter=True)
    custom_playlist_model = SimpleNamespace(objects=playlists)
    issue_model = SimpleNamespace(_default_manager=_QuerySet([("work-item-1", 42)]))
    apps = SimpleNamespace(
        get_model=lambda app_label, model_name: {
            ("db", "CustomPlaylist"): custom_playlist_model,
            ("db", "Issue"): issue_model,
        }[(app_label, model_name)]
    )
    schema_editor = SimpleNamespace(connection=SimpleNamespace(alias="default"))

    migration.move_custom_playlists_to_artifact_metadata(apps, schema_editor)

    saved_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    event_metadata = saved_manifest["metadata"]["coach-event-1"]
    assert event_metadata["existing"] is True
    assert event_metadata[migration.CUSTOM_PLAYLISTS_METADATA_KEY] == [
        {
            "id": "playlist-1",
            "event_id": 42,
            "name": "First half",
            "subtitle": "Highlights",
            "url": "playlist-1.m3u8",
            "thumbnail": None,
            "clip": 1,
            "clips": [{"id": "tag-1", "title": "Goal"}],
            "created_at": None,
            "updated_at": None,
        }
    ]
    assert playlists.filter_kwargs == {"deleted_at__isnull": True}
    assert deleted_playlist.id not in json.dumps(saved_manifest)
