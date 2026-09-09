import importlib
import json
from types import SimpleNamespace

import pytest
from django.db import connection, models
from django.db.migrations.state import ModelState, ProjectState


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

    # Filesystem writes survive a rolled-back database migration. Retrying must
    # not duplicate playlists that were already copied.
    migration.move_custom_playlists_to_artifact_metadata(apps, schema_editor)
    assert json.loads(manifest_path.read_text(encoding="utf-8"))["metadata"] == saved_manifest["metadata"]


@pytest.mark.unit
@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("has_matching_artifact", [True, False])
def test_migration_preserves_legacy_rows_and_removes_only_model_state(
    settings, tmp_path, caplog, has_matching_artifact
):
    settings.MEDIA_LIBRARY_ROOT = str(tmp_path / "media-library")
    manifest_path = (
        tmp_path / "media-library" / "projects" / "project-1" / "packages" / "package-1" / "manifest.json"
    )
    if has_matching_artifact:
        manifest_path.parent.mkdir(parents=True)
        manifest_path.write_text(
            json.dumps(
                {
                    "artifacts": [{"name": "coach-event-42", "format": "json", "work_item_id": "issue-42"}],
                    "metadata": {"coach-event-42": {"existing": True}},
                }
            ),
            encoding="utf-8",
        )

    # Use real historical models and a real schema editor. In particular, this
    # must detect an accidental DeleteModel that would destroy unresolved rows.
    state = ProjectState()
    state.add_model(
        ModelState(
            "db",
            "CustomPlaylist",
            fields=[
                ("id", models.CharField(max_length=64, primary_key=True)),
                ("event_id", models.BigIntegerField()),
                ("name", models.CharField(max_length=255)),
                ("subtitle", models.TextField(null=True)),
                ("url", models.TextField()),
                ("thumbnail", models.TextField(null=True)),
                ("clip", models.PositiveIntegerField(default=0)),
                ("clips", models.JSONField(default=list)),
                ("created_at", models.DateTimeField(null=True)),
                ("updated_at", models.DateTimeField(null=True)),
                ("deleted_at", models.DateTimeField(null=True)),
                ("created_by_id", models.CharField(max_length=64, null=True)),
            ],
            options={"db_table": "test_migration_custom_playlists"},
        )
    )
    state.add_model(
        ModelState(
            "db",
            "Issue",
            fields=[
                ("id", models.CharField(max_length=64, primary_key=True)),
                ("sg_event_id", models.BigIntegerField(null=True)),
            ],
            options={"db_table": "test_migration_issues"},
        )
    )
    CustomPlaylist = state.apps.get_model("db", "CustomPlaylist")
    Issue = state.apps.get_model("db", "Issue")
    with connection.schema_editor() as editor:
        editor.create_model(CustomPlaylist)
        editor.create_model(Issue)

    try:
        Issue.objects.create(id="issue-42", sg_event_id=42)
        for playlist_id, event_id in (("matched-playlist", 42), ("orphaned-playlist", 99)):
            CustomPlaylist.objects.create(
                id=playlist_id,
                event_id=event_id,
                name="Highlights",
                url=f"{playlist_id}.m3u8",
                clips=[{"id": "tag-1", "title": "Goal"}],
                created_by_id="original-owner",
            )
        original_rows = list(CustomPlaylist.objects.order_by("id").values())
        operation = migration.Migration("0124_move_custom_playlists_to_artifact_metadata", "db")
        with connection.schema_editor() as editor:
            migrated_state = operation.apply(state.clone(), editor)

        assert list(CustomPlaylist.objects.order_by("id").values()) == original_rows
        with pytest.raises(LookupError):
            migrated_state.apps.get_model("db", "CustomPlaylist")
        assert "preserved in the legacy custom_playlists table" in caplog.text
        assert "orphaned-playlist" in caplog.text

        if has_matching_artifact:
            metadata = json.loads(manifest_path.read_text(encoding="utf-8"))["metadata"]["coach-event-42"]
            assert metadata["existing"] is True
            assert [playlist["id"] for playlist in metadata["custom_playlists"]] == ["matched-playlist"]
        else:
            assert "matched-playlist" in caplog.text
            assert not manifest_path.exists()

        # State-only removal can also be reversed without trying to recreate
        # the retained table or changing the original data.
        with connection.schema_editor() as editor:
            operation.unapply(state, editor)
        assert list(CustomPlaylist.objects.order_by("id").values()) == original_rows
    finally:
        with connection.schema_editor() as editor:
            editor.delete_model(CustomPlaylist)
            editor.delete_model(Issue)
