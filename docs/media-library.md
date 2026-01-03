# Media Library

This doc describes the media library feature: data model, API flow, background processing, and the UI.

## Flow (end-to-end)

### S3/MinIO mode

1) User selects one or more files in the media library UI.
2) Frontend requests presigned upload data from the API.
3) Browser uploads files directly to object storage (S3/MinIO).
4) Frontend notifies the API that uploads are complete.
5) Celery worker downloads the file, extracts metadata, generates thumbnails and renditions, then uploads results.
6) API marks the asset as READY; UI updates with preview and metadata.

Access control: project Admin/Member only. Guest access is blocked, except for public share links.

### Manifest mode (local filesystem)

When `MEDIA_LIBRARY_STORAGE=manifest`, the API accepts multipart uploads directly. The local filesystem
is the source of truth and every level (root, folders, files) has a manifest.

1) User selects one or more files in the media library UI.
2) Frontend posts multipart `files` + `metadata` to the API.
3) API writes file data to disk and creates per-file manifests.
4) Celery worker processes the local file (ffprobe/ffmpeg) to add thumbnails and renditions.
5) API updates the file manifest status to READY; UI updates with preview and metadata.

## Backend

### Models

File: `apps/api/plane/db/models/media.py`

- MediaAsset: core uploaded file metadata and status.
- MediaRendition: thumbnail, preview MP4, HLS playlist and segments.
- MediaTag: tag entity for assets.
- MediaCollection: folder/collection entity for assets.
- MediaAssetTag: join table for tags.
- MediaCollectionItem: join table for collections.
- MediaShare: share token for public access.

### Migrations

- `apps/api/plane/db/migrations/0110_media_library.py`
  Creates all media tables and indexes.
- `apps/api/plane/db/migrations/0111_alter_mediaasset_asset.py`
  Aligns MediaAsset.asset with the model field definition.

### Serializers

File: `apps/api/plane/app/serializers/media.py`

- MediaAssetSerializer: list view data + thumbnail URL.
- MediaAssetDetailSerializer: detail view + tags/collections/renditions + preview and download URLs.
- MediaTagSerializer, MediaCollectionSerializer, MediaRenditionSerializer, MediaShareSerializer.

Presigned URLs are generated via `S3Storage`. HLS uses a signed playlist endpoint.

### Views / Endpoints

File: `apps/api/plane/app/views/media/base.py`

- POST `/api/media/workspaces/{slug}/projects/{project_id}/assets/`
  Create assets and return presigned upload data (supports multiple files).
- POST `/api/media/workspaces/{slug}/projects/{project_id}/assets/complete/`
  Mark assets as uploaded and enqueue processing.
- GET `/api/media/workspaces/{slug}/projects/{project_id}/assets/`
  List assets with search/tag/collection filters.
- GET/PATCH/DELETE `/api/media/workspaces/{slug}/projects/{project_id}/assets/{asset_id}/`
  Detail, update tags/collections, delete.
- GET `/api/media/workspaces/{slug}/projects/{project_id}/assets/{asset_id}/download/`
  Signed download of original file.
- GET `/api/media/workspaces/{slug}/projects/{project_id}/assets/{asset_id}/hls/{rendition_id}/`
  Signed HLS playlist and segments.
- GET/POST `/api/media/workspaces/{slug}/projects/{project_id}/collections/`
  List/create collections.
- PATCH/DELETE `/api/media/workspaces/{slug}/projects/{project_id}/collections/{collection_id}/`
  Update/delete collection.
- GET/POST `/api/media/workspaces/{slug}/projects/{project_id}/tags/`
  List/create tags.
- POST `/api/media/workspaces/{slug}/projects/{project_id}/assets/{asset_id}/share/`
  Create share link.
- DELETE `/api/media/workspaces/{slug}/projects/{project_id}/assets/{asset_id}/share/{share_id}/`
  Revoke share link.
- GET `/api/media/shares/{token}/`
  Public share access (preview or download).

Manifest-specific additions:

- GET `/api/media/workspaces/{slug}/projects/{project_id}/assets/{asset_id}/file/`
  Serve local file/thumbnail/preview for manifest mode.
- GET `/api/media/shares/{token}/file/`
  Serve shared preview/download for manifest mode (requires workspace + project in query string).

### Settings

File: `apps/api/plane/settings/common.py`

Media settings:

- MEDIA_LIBRARY_FILE_SIZE_LIMIT
- MEDIA_LIBRARY_MIME_TYPES
- MEDIA_LIBRARY_VIDEO_RENDITIONS
- MEDIA_LIBRARY_THUMBNAIL_WIDTH

Defaults are documented in `.env.example`.

Manifest mode settings:

- `MEDIA_LIBRARY_STORAGE=manifest`
- `MEDIA_LIBRARY_ROOT` (base directory for the local media library)
- `NEXT_PUBLIC_MEDIA_LIBRARY_STORAGE=manifest` (web app upload flow)

### Background processing

File: `apps/api/plane/bgtasks/media_processing.py`

Processing steps:

1) Download file from object storage.
2) Extract metadata via `ffprobe` (width/height/duration).
3) Generate thumbnail (images, documents, videos).
4) For video: generate MP4 renditions and HLS playlist.
5) Upload renditions; update asset status to READY or FAILED.

Requires `ffmpeg` and `ffprobe` in the worker environment.

## Frontend

### Types

- `packages/types/src/media.ts`
  Shared media types for API and UI.

### Service

- `apps/web/core/services/media.service.ts`
  API client for all media endpoints + presigned upload handling.

### UI components

- `apps/web/core/components/media-library/root.tsx`
  Media library grid, filters, search, upload queue.
- `apps/web/core/components/media-library/media-card.tsx`
  Thumbnail card with status overlay.
- `apps/web/core/components/media-library/detail-view.tsx`
  Asset detail view with preview, tags/collections, share, download.
- `apps/web/core/components/media-library/share-view.tsx`
  Public share page.

### Routes

- `apps/web/app/(all)/[workspaceSlug]/(projects)/projects/(detail)/[projectId]/media/page.tsx`
  Media library page.
- `apps/web/app/(all)/[workspaceSlug]/(projects)/projects/(detail)/[projectId]/media/[assetId]/page.tsx`
  Asset detail page.
- `apps/web/app/share/media/[token]/page.tsx`
  Public share view.

### Navigation

- `apps/web/core/components/workspace/sidebar/project-navigation.tsx`
  Adds "Media library" to the project sidebar for Admin/Member.
- `packages/i18n/src/locales/en/core.ts`
  Adds the `sidebar.media_library` label.

## Notes

- Uploads use presigned POSTs; the API never receives the file directly.
- HLS URLs are signed per request and returned from the API.
- Share links bypass auth but are time/revocation controlled.

## Manifest storage layout

When manifest mode is enabled, a project media library is stored on disk as:

```
media-library/
  workspaces/{workspace_id}/projects/{project_id}/media-library/
    manifest.json
    files/
      {file_id}/
        manifest.json
        original/{filename}
        renditions/{...}
        thumbs/{...}
    folders/
      {folder_id}/
        manifest.json
        files/{file_id}/...
        folders/...
```

Each level has a `manifest.json` and all UI/API queries are derived from these manifests.

### Root manifest (manifest mode)

```json
{
  "schema_version": "1.0",
  "id": "root",
  "type": "root",
  "title": "Media Library",
  "folders": [],
  "files": [],
  "files_index": {},
  "shares_index": {},
  "stats": {
    "file_count": 0,
    "folder_count": 0,
    "total_bytes": 0
  },
  "created_at": "iso",
  "updated_at": "iso",
  "revision": 1
}
```

### Folder manifest

```json
{
  "schema_version": "1.0",
  "id": "f_...",
  "type": "folder",
  "name": "My Folder",
  "slug": "my-folder",
  "parent_id": null,
  "path": "/My Folder",
  "folders": [],
  "files": [],
  "description": "",
  "created_at": "iso",
  "updated_at": "iso",
  "revision": 1
}
```

### File manifest

```json
{
  "schema_version": "1.0",
  "id": "m_...",
  "type": "file",
  "parent_id": "root",
  "path": "/filename.mp4",
  "title": "filename",
  "description": "",
  "original": {
    "filename": "filename.mp4",
    "relative_path": "original/filename.mp4",
    "bytes": 0,
    "mime_type": "video/mp4",
    "sha256": "..."
  },
  "kind": "video",
  "status": "PROCESSING",
  "metadata": {
    "duration_sec": null,
    "width": null,
    "height": null,
    "page_count": null
  },
  "tags": [],
  "collections": [],
  "renditions": [],
  "thumbnails": [],
  "preview": {
    "preferred": null,
    "fallback": "original/filename.mp4"
  },
  "errors": [],
  "created_at": "iso",
  "updated_at": "iso",
  "revision": 1
}
```

Manifest writes use atomic temp file replacement with fsync and a lightweight lock file.
