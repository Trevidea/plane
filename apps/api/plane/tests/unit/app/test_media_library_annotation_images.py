from plane.app.views.media_library import _externalize_annotation_image_content

PNG_DATA_URL = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
)


def test_externalize_annotation_image_content_writes_transcode_blob(settings, tmp_path):
    settings.MEDIA_LIBRARY_ROOT = str(tmp_path)
    settings.MEDIA_TRANSCODE_OUTPUT_BASE_URL = "/sports/api/blobs/media"
    settings.MEDIA_TRANSCODE_OUTPUT_ROOT = str(tmp_path / "transcoded")
    manifest = {
        "id": "package-1",
        "projectId": "project-1",
        "artifacts": [
            {
                "name": "clip-1",
                "title": "clip.mp4",
                "format": "mp4",
                "path": "projects/project-1/packages/package-1/artifacts/clip-1.mp4",
                "link": None,
                "action": "play",
                "metadata_ref": "clip-1",
                "work_item_id": "issue-1",
                "created_at": "2026-08-24T00:00:00Z",
                "updated_at": "2026-08-24T00:00:00Z",
            }
        ],
        "metadata": {"clip-1": {}},
    }
    payload = {
        "meta": {
            "annotations": [
                {
                    "id": "image-1",
                    "type": "image",
                    "title": "Logo",
                    "content": PNG_DATA_URL,
                }
            ]
        }
    }

    externalized, created_count = _externalize_annotation_image_content(
        payload,
        "project-1",
        "package-1",
        source_artifact_id="clip-1",
    )

    assert created_count == 1
    image_url = externalized["meta"]["annotations"][0]["content"]
    assert image_url.startswith("/sports/api/blobs/media/media-annotation-")
    assert image_url.endswith(".png")
    assert len(manifest["artifacts"]) == 1

    image_path = tmp_path / "transcoded" / image_url.removeprefix("/sports/api/blobs/media/")
    assert image_path.exists()
    assert image_path.read_bytes()
