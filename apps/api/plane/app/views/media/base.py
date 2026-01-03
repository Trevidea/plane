# Python imports
import json
import os
import mimetypes

# Django imports
from django.conf import settings
from django.db.models import Count, Q
from django.http import HttpResponse, HttpResponseRedirect
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.template.defaultfilters import slugify

# Third party imports
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.serializers import (
    MediaAssetDetailSerializer,
    MediaAssetSerializer,
    MediaCollectionSerializer,
    MediaShareSerializer,
    MediaTagSerializer,
)
from plane.app.views.base import BaseAPIView
from plane.bgtasks.media_processing import process_media_asset
from plane.bgtasks.media_processing_manifest import process_media_manifest
from plane.db.models import (
    MediaAsset,
    MediaAssetTag,
    MediaCollection,
    MediaCollectionItem,
    MediaRendition,
    MediaShare,
    MediaTag,
    Project,
    Workspace,
)
from plane.settings.storage import S3Storage
from plane.utils.host import base_host
from plane.app.media_manifest import (
    ensure_root_manifest,
    list_file_manifests,
    list_collections as manifest_list_collections,
    list_tags as manifest_list_tags,
    create_collection as manifest_create_collection,
    update_collection as manifest_update_collection,
    delete_collection as manifest_delete_collection,
    create_file_from_upload,
    load_file_manifest,
    update_file_manifest,
    update_file_tags_collections,
    delete_file as manifest_delete_file,
    create_share as manifest_create_share,
    revoke_share as manifest_revoke_share,
    resolve_share as manifest_resolve_share,
    get_media_library_root,
    read_manifest,
)


def _derive_media_kind(mime_type):
    if not mime_type:
        return MediaAsset.MediaKind.OTHER
    if mime_type.startswith("image/"):
        return MediaAsset.MediaKind.IMAGE
    if mime_type.startswith("video/"):
        return MediaAsset.MediaKind.VIDEO
    if mime_type.startswith("audio/"):
        return MediaAsset.MediaKind.AUDIO
    if mime_type in [
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]:
        return MediaAsset.MediaKind.DOCUMENT
    if mime_type in ["application/zip", "application/x-zip-compressed", "application/x-rar"]:
        return MediaAsset.MediaKind.ARCHIVE
    return MediaAsset.MediaKind.OTHER


def _manifest_asset_summary(manifest, request, slug, project_id):
    mime_type = manifest.get("original", {}).get("mime_type")
    kind = _derive_media_kind(mime_type)
    thumbnail_url = None
    if manifest.get("thumbnails"):
        thumbnail_url = (
            f"/api/media/workspaces/{slug}/projects/{project_id}/assets/{manifest.get('id')}/file/"
            f"?kind=thumbnail"
        )
    metadata = manifest.get("metadata", {}) or {}
    return {
        "id": manifest.get("id"),
        "title": manifest.get("title"),
        "description": manifest.get("description"),
        "file_name": manifest.get("original", {}).get("filename"),
        "mime_type": mime_type,
        "size": manifest.get("original", {}).get("bytes", 0),
        "status": manifest.get("status"),
        "media_kind": kind,
        "is_uploaded": manifest.get("status") != "UPLOADING",
        "duration": metadata.get("duration_sec"),
        "width": metadata.get("width"),
        "height": metadata.get("height"),
        "created_at": manifest.get("created_at"),
        "thumbnail_url": thumbnail_url,
    }


def _manifest_asset_detail(manifest, request, slug, project_id):
    detail = _manifest_asset_summary(manifest, request, slug, project_id)
    preview_path = manifest.get("preview", {}).get("preferred") or manifest.get("preview", {}).get("fallback")
    preview_url = None
    if preview_path:
        preview_url = (
            f"/api/media/workspaces/{slug}/projects/{project_id}/assets/{manifest.get('id')}/file/"
            f"?path={preview_path}"
        )
    download_url = (
        f"/api/media/workspaces/{slug}/projects/{project_id}/assets/{manifest.get('id')}/file/"
        f"?kind=original&download=1"
    )
    tags = [
        {"id": tag.get("slug"), "name": tag.get("name"), "slug": tag.get("slug")}
        for tag in manifest.get("tags", [])
    ]
    detail.update(
        {
            "tags": tags,
            "collections": [],
            "renditions": manifest.get("renditions", []),
            "download_url": download_url,
            "preview_url": preview_url,
        }
    )
    return detail


def _get_collection_map(root_dir):
    root_manifest_path = os.path.join(root_dir, "manifest.json")
    if not os.path.exists(root_manifest_path):
        return {}
    root_manifest = read_manifest(root_manifest_path)
    return {folder.get("id"): folder for folder in root_manifest.get("folders", []) if folder.get("id")}


def _manifest_asset_with_collections(manifest, request, slug, project_id, root_dir):
    detail = _manifest_asset_detail(manifest, request, slug, project_id)
    folder_map = _get_collection_map(root_dir)
    collections = []
    for collection_id in manifest.get("collections", []):
        folder = folder_map.get(collection_id)
        if not folder:
            continue
        collections.append(
            {
                "id": collection_id,
                "name": folder.get("name"),
                "slug": folder.get("slug"),
                "description": folder.get("description", ""),
                "parent": folder.get("parent_id"),
                "created_at": folder.get("created_at"),
                "updated_at": folder.get("updated_at"),
            }
        )
    detail["collections"] = collections
    return detail


def _serve_local_file(file_path, content_type=None, download_name=None):
    if not os.path.exists(file_path):
        return Response({"error": "File not found."}, status=status.HTTP_404_NOT_FOUND)
    file_handle = open(file_path, "rb")
    response = HttpResponse(file_handle, content_type=content_type or "application/octet-stream")
    if download_name:
        response["Content-Disposition"] = f'attachment; filename="{download_name}"'
    return response


def _clean_tag_name(name):
    trimmed = name.strip()
    if not trimmed:
        return None
    slug = slugify(trimmed) or trimmed.replace(" ", "-").lower()
    return trimmed, slug


def _get_tag_objects(workspace, project_id, tag_names):
    tags = []
    for tag_name in tag_names:
        cleaned = _clean_tag_name(tag_name)
        if not cleaned:
            continue
        name, slug = cleaned
        tag, _ = MediaTag.objects.get_or_create(
            workspace=workspace,
            project_id=project_id,
            slug=slug,
            defaults={"name": name},
        )
        tags.append(tag)
    return tags


def _update_asset_tags(asset, tag_names):
    if isinstance(tag_names, str):
        tag_names = [tag.strip() for tag in tag_names.split(",") if tag.strip()]
    tags = _get_tag_objects(asset.workspace, asset.project_id, tag_names)
    MediaAssetTag.objects.filter(media_asset=asset).delete()
    MediaAssetTag.objects.bulk_create([MediaAssetTag(media_asset=asset, tag=tag) for tag in tags])


def _update_asset_collections(asset, collection_ids):
    if isinstance(collection_ids, str):
        collection_ids = [item.strip() for item in collection_ids.split(",") if item.strip()]
    MediaCollectionItem.objects.filter(media_asset=asset).delete()
    if not collection_ids:
        return
    collections = MediaCollection.objects.filter(
        id__in=collection_ids,
        workspace=asset.workspace,
        project=asset.project,
    )
    MediaCollectionItem.objects.bulk_create(
        [MediaCollectionItem(media_asset=asset, collection=collection) for collection in collections]
    )


class MediaAssetEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def post(self, request, slug, project_id):
        if settings.MEDIA_LIBRARY_STORAGE == "manifest":
            workspace = Workspace.objects.get(slug=slug)
            Project.objects.get(id=project_id, workspace=workspace)
            root_dir, _ = ensure_root_manifest(workspace.id, project_id)

            uploaded_files = request.FILES.getlist("files") or request.FILES.getlist("file")
            if not uploaded_files:
                return Response({"error": "No files provided."}, status=status.HTTP_400_BAD_REQUEST)

            metadata_payload = request.data.get("metadata")
            metadata_list = []
            if metadata_payload:
                try:
                    metadata_list = json.loads(metadata_payload)
                except ValueError:
                    return Response({"error": "Invalid metadata payload."}, status=status.HTTP_400_BAD_REQUEST)
            if metadata_list and len(metadata_list) != len(uploaded_files):
                return Response({"error": "Metadata count does not match files."}, status=status.HTTP_400_BAD_REQUEST)

            response_assets = []
            for index, file_obj in enumerate(uploaded_files):
                meta = metadata_list[index] if metadata_list else {}
                title = meta.get("title") if isinstance(meta, dict) else None
                description = meta.get("description") if isinstance(meta, dict) else ""
                tags = meta.get("tags") if isinstance(meta, dict) else []
                collection_ids = meta.get("collection_ids") if isinstance(meta, dict) else []
                if isinstance(tags, str):
                    tags = [tag.strip() for tag in tags.split(",") if tag.strip()]
                if isinstance(collection_ids, str):
                    collection_ids = [item.strip() for item in collection_ids.split(",") if item.strip()]
                mime_type = (
                    getattr(file_obj, "content_type", "")
                    or mimetypes.guess_type(file_obj.name or "")[0]
                    or "application/octet-stream"
                )
                mime_type = mime_type.split(";")[0].strip()
                size = int(getattr(file_obj, "size", 0) or 0)

                if collection_ids:
                    folder_map = _get_collection_map(root_dir)
                    invalid_collections = [
                        collection_id for collection_id in collection_ids if collection_id not in folder_map
                    ]
                    if invalid_collections:
                        return Response(
                            {"error": "Invalid collection selection."},
                            status=status.HTTP_400_BAD_REQUEST,
                        )

                if settings.MEDIA_LIBRARY_MIME_TYPES and mime_type not in settings.MEDIA_LIBRARY_MIME_TYPES:
                    return Response({"error": "Invalid file type."}, status=status.HTTP_400_BAD_REQUEST)

                if size <= 0:
                    return Response({"error": "Invalid file size."}, status=status.HTTP_400_BAD_REQUEST)

                if size > settings.MEDIA_LIBRARY_FILE_SIZE_LIMIT:
                    return Response({"error": "File too large."}, status=status.HTTP_400_BAD_REQUEST)

                manifest = create_file_from_upload(
                    root_dir=root_dir,
                    file_obj=file_obj,
                    title=title,
                    description=description,
                    tags=tags,
                    collection_ids=collection_ids,
                    mime_type_override=mime_type,
                )
                process_media_manifest.delay(str(workspace.id), str(project_id), manifest.get("id"))
                response_assets.append(
                    {
                        "asset_id": manifest.get("id"),
                        "asset": _manifest_asset_summary(manifest, request, slug, project_id),
                    }
                )

            return Response({"assets": response_assets}, status=status.HTTP_200_OK)

        files = request.data.get("files", [])
        if not files:
            files = [
                {
                    "name": request.data.get("name"),
                    "type": request.data.get("type"),
                    "size": request.data.get("size"),
                    "title": request.data.get("title"),
                    "description": request.data.get("description"),
                    "tags": request.data.get("tags", []),
                    "collection_ids": request.data.get("collection_ids", []),
                }
            ]

        workspace = Workspace.objects.get(slug=slug)
        Project.objects.get(id=project_id, workspace=workspace)
        storage = S3Storage(request=request)

        response_assets = []
        for file in files:
            name = file.get("name")
            file_type = file.get("type")
            size = int(file.get("size") or 0)
            if not name or not file_type:
                return Response({"error": "Invalid file metadata."}, status=status.HTTP_400_BAD_REQUEST)

            if file_type not in settings.MEDIA_LIBRARY_MIME_TYPES:
                return Response({"error": "Invalid file type.", "status": False}, status=status.HTTP_400_BAD_REQUEST)

            if size <= 0:
                return Response({"error": "Invalid file size.", "status": False}, status=status.HTTP_400_BAD_REQUEST)

            if size > settings.MEDIA_LIBRARY_FILE_SIZE_LIMIT:
                return Response(
                    {"error": "File too large.", "status": False},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            asset_key = f"{workspace.id}/media/{os.urandom(8).hex()}-{name}"
            title = file.get("title") or os.path.splitext(name)[0]
            description = file.get("description") or ""
            media_kind = _derive_media_kind(file_type)

            asset = MediaAsset.objects.create(
                workspace=workspace,
                project_id=project_id,
                title=title,
                description=description,
                file_name=name,
                mime_type=file_type,
                size=size,
                asset=asset_key,
                status=MediaAsset.Status.UPLOADING,
                media_kind=media_kind,
                created_by=request.user,
            )

            tags = file.get("tags") or []
            collection_ids = file.get("collection_ids") or []
            if tags:
                _update_asset_tags(asset, tags)
            if collection_ids:
                _update_asset_collections(asset, collection_ids)

            presigned_url = storage.generate_presigned_post(
                object_name=asset_key,
                file_type=file_type,
                file_size=size,
            )
            if not presigned_url:
                asset.delete()
                return Response(
                    {"error": "Failed to create upload URL.", "status": False},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                )
            response_assets.append(
                {
                    "asset_id": str(asset.id),
                    "upload_data": presigned_url,
                    "asset": MediaAssetSerializer(asset, context={"request": request}).data,
                }
            )

        return Response({"assets": response_assets}, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def get(self, request, slug, project_id):
        if settings.MEDIA_LIBRARY_STORAGE == "manifest":
            workspace = Workspace.objects.get(slug=slug)
            Project.objects.get(id=project_id, workspace=workspace)
            root_dir, _ = ensure_root_manifest(workspace.id, project_id)

            search = request.query_params.get("search", "").strip()
            tag_ids = request.query_params.get("tag_ids", "")
            collection_id = request.query_params.get("collection_id")
            media_kind = request.query_params.get("media_kind")
            status_filter = request.query_params.get("status")
            tag_list = [tag.strip() for tag in tag_ids.split(",") if tag.strip()]

            manifests = list_file_manifests(
                root_dir,
                filter_folder_id=collection_id,
                search=search or None,
                tag_ids=tag_list or None,
                media_kind=media_kind.lower() if media_kind else None,
                status_filter=status_filter,
            )

            assets = [_manifest_asset_summary(item, request, slug, project_id) for item in manifests]
            per_page = self.get_per_page(request, default_per_page=24, max_per_page=1000)
            cursor = request.query_params.get("cursor", f"{per_page}:0:0")
            from plane.utils.paginator import Cursor

            cursor_obj = Cursor.from_string(cursor)
            offset = cursor_obj.offset * per_page
            page_items = assets[offset : offset + per_page]
            next_has = offset + per_page < len(assets)
            prev_has = cursor_obj.offset > 0
            return Response(
                {
                    "results": page_items,
                    "next_cursor": str(Cursor(per_page, cursor_obj.offset + 1, False, next_has)),
                    "prev_cursor": str(Cursor(per_page, cursor_obj.offset - 1, True, prev_has)),
                    "next_page_results": next_has,
                    "prev_page_results": prev_has,
                    "count": len(page_items),
                    "total_results": len(assets),
                    "total_count": len(assets),
                    "total_pages": (len(assets) + per_page - 1) // per_page,
                }
            )

        search = request.query_params.get("search", "").strip()
        tag_ids = request.query_params.get("tag_ids", "")
        collection_id = request.query_params.get("collection_id")
        media_kind = request.query_params.get("media_kind")
        status_filter = request.query_params.get("status")

        queryset = MediaAsset.objects.filter(
            workspace__slug=slug,
            project_id=project_id,
        ).prefetch_related("renditions", "tags", "collections")

        if search:
            queryset = queryset.filter(
                Q(title__icontains=search)
                | Q(description__icontains=search)
                | Q(file_name__icontains=search)
            )
        if media_kind:
            queryset = queryset.filter(media_kind=media_kind)
        if status_filter:
            queryset = queryset.filter(status=status_filter)
        if collection_id:
            queryset = queryset.filter(collections__id=collection_id)
        if tag_ids:
            tag_list = [tag_id.strip() for tag_id in tag_ids.split(",") if tag_id.strip()]
            if tag_list:
                queryset = queryset.filter(tags__id__in=tag_list)

        queryset = queryset.distinct()

        return self.paginate(
            request,
            queryset=queryset,
            order_by="-created_at",
            max_per_page=50,
            on_results=lambda items: MediaAssetSerializer(
                items,
                many=True,
                context={"request": request},
            ).data,
        )


class MediaAssetDetailEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def get(self, request, slug, project_id, asset_id):
        if settings.MEDIA_LIBRARY_STORAGE == "manifest":
            workspace = Workspace.objects.get(slug=slug)
            Project.objects.get(id=project_id, workspace=workspace)
            root_dir, _ = ensure_root_manifest(workspace.id, project_id)
            _, manifest = load_file_manifest(root_dir, asset_id)
            if not manifest:
                return Response({"error": "Asset not found."}, status=status.HTTP_404_NOT_FOUND)
            detail = _manifest_asset_with_collections(manifest, request, slug, project_id, root_dir)
            return Response(detail, status=status.HTTP_200_OK)

        asset = MediaAsset.objects.filter(
            id=asset_id,
            workspace__slug=slug,
            project_id=project_id,
        ).prefetch_related("renditions", "tags", "collections").first()
        if not asset:
            return Response({"error": "Asset not found."}, status=status.HTTP_404_NOT_FOUND)
        serializer = MediaAssetDetailSerializer(asset, context={"request": request})
        return Response(serializer.data, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def patch(self, request, slug, project_id, asset_id):
        if settings.MEDIA_LIBRARY_STORAGE == "manifest":
            workspace = Workspace.objects.get(slug=slug)
            Project.objects.get(id=project_id, workspace=workspace)
            root_dir, _ = ensure_root_manifest(workspace.id, project_id)
            title = request.data.get("title")
            description = request.data.get("description")
            tags = request.data.get("tags")
            collection_ids = request.data.get("collection_ids")
            if isinstance(tags, str):
                tags = [tag.strip() for tag in tags.split(",") if tag.strip()]
            if isinstance(collection_ids, str):
                collection_ids = [item.strip() for item in collection_ids.split(",") if item.strip()]

            if collection_ids is not None:
                folder_map = _get_collection_map(root_dir)
                invalid_collections = [collection_id for collection_id in collection_ids if collection_id not in folder_map]
                if invalid_collections:
                    return Response(
                        {"error": "Invalid collection selection."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

            updates = {}
            if title is not None:
                updates["title"] = title
            if description is not None:
                updates["description"] = description
            if updates:
                update_file_manifest(root_dir, asset_id, updates)
            if tags is not None or collection_ids is not None:
                update_file_tags_collections(root_dir, asset_id, tags=tags, collections=collection_ids)
            _, manifest = load_file_manifest(root_dir, asset_id)
            if not manifest:
                return Response({"error": "Asset not found."}, status=status.HTTP_404_NOT_FOUND)
            detail = _manifest_asset_with_collections(manifest, request, slug, project_id, root_dir)
            return Response(detail, status=status.HTTP_200_OK)

        asset = MediaAsset.objects.get(id=asset_id, workspace__slug=slug, project_id=project_id)
        title = request.data.get("title")
        description = request.data.get("description")
        tags = request.data.get("tags")
        collection_ids = request.data.get("collection_ids")

        if title is not None:
            asset.title = title
        if description is not None:
            asset.description = description

        asset.save(update_fields=["title", "description"])

        if tags is not None:
            _update_asset_tags(asset, tags)
        if collection_ids is not None:
            _update_asset_collections(asset, collection_ids)

        serializer = MediaAssetDetailSerializer(asset, context={"request": request})
        return Response(serializer.data, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def delete(self, request, slug, project_id, asset_id):
        if settings.MEDIA_LIBRARY_STORAGE == "manifest":
            workspace = Workspace.objects.get(slug=slug)
            Project.objects.get(id=project_id, workspace=workspace)
            root_dir, _ = ensure_root_manifest(workspace.id, project_id)
            removed = manifest_delete_file(root_dir, asset_id)
            if not removed:
                return Response({"error": "Asset not found."}, status=status.HTTP_404_NOT_FOUND)
            return Response(status=status.HTTP_204_NO_CONTENT)

        asset = MediaAsset.objects.get(id=asset_id, workspace__slug=slug, project_id=project_id)
        asset.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class MediaAssetUploadCompleteEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def post(self, request, slug, project_id):
        if settings.MEDIA_LIBRARY_STORAGE == "manifest":
            return Response(status=status.HTTP_204_NO_CONTENT)

        asset_ids = request.data.get("asset_ids", [])
        if not asset_ids:
            return Response({"error": "No asset ids provided."}, status=status.HTTP_400_BAD_REQUEST)

        assets = MediaAsset.objects.filter(
            id__in=asset_ids,
            workspace__slug=slug,
            project_id=project_id,
        )

        for asset in assets:
            asset.is_uploaded = True
            asset.status = MediaAsset.Status.PROCESSING
            asset.save(update_fields=["is_uploaded", "status"])
            process_media_asset.delay(str(asset.id))

        return Response(status=status.HTTP_204_NO_CONTENT)


class MediaAssetDownloadEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def get(self, request, slug, project_id, asset_id):
        if settings.MEDIA_LIBRARY_STORAGE == "manifest":
            workspace = Workspace.objects.get(slug=slug)
            Project.objects.get(id=project_id, workspace=workspace)
            root_dir, _ = ensure_root_manifest(workspace.id, project_id)
            manifest_path, manifest = load_file_manifest(root_dir, asset_id)
            if not manifest:
                return Response({"error": "The requested asset could not be found."}, status=status.HTTP_404_NOT_FOUND)
            file_dir = manifest_path.parent
            relative_path = manifest.get("original", {}).get("relative_path")
            if not relative_path:
                return Response({"error": "The requested asset could not be found."}, status=status.HTTP_404_NOT_FOUND)
            file_path = file_dir / relative_path
            return _serve_local_file(
                file_path,
                content_type=manifest.get("original", {}).get("mime_type"),
                download_name=manifest.get("original", {}).get("filename"),
            )

        asset = MediaAsset.objects.get(
            id=asset_id,
            workspace__slug=slug,
            project_id=project_id,
        )
        if not asset.is_uploaded:
            return Response(
                {"error": "The requested asset could not be found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        storage = S3Storage(request=request)
        signed_url = storage.generate_presigned_url(
            object_name=asset.asset.name,
            disposition="attachment",
            filename=asset.file_name,
        )
        return HttpResponseRedirect(signed_url)


class MediaAssetHlsEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def get(self, request, slug, project_id, asset_id, rendition_id):
        if settings.MEDIA_LIBRARY_STORAGE == "manifest":
            workspace = Workspace.objects.get(slug=slug)
            Project.objects.get(id=project_id, workspace=workspace)
            root_dir, _ = ensure_root_manifest(workspace.id, project_id)
            manifest_path, manifest = load_file_manifest(root_dir, asset_id)
            if not manifest:
                return Response({"error": "Rendition not found."}, status=status.HTTP_404_NOT_FOUND)
            rendition = next((item for item in manifest.get("renditions", []) if item.get("id") == rendition_id), None)
            if not rendition:
                return Response({"error": "Rendition not found."}, status=status.HTTP_404_NOT_FOUND)
            file_dir = manifest_path.parent
            playlist_path = file_dir / rendition.get("relative_path", "")
            if not playlist_path.exists():
                return Response({"error": "Rendition not found."}, status=status.HTTP_404_NOT_FOUND)
            content = playlist_path.read_text(encoding="utf-8")
            base_path = "renditions/hls"
            signed_lines = []
            for line in content.splitlines():
                if not line or line.startswith("#"):
                    signed_lines.append(line)
                    continue
                segment_path = f"{base_path}/{line}"
                signed_lines.append(
                    f"/api/media/workspaces/{slug}/projects/{project_id}/assets/{asset_id}/file/?path={segment_path}"
                )
            return HttpResponse("\n".join(signed_lines), content_type="application/vnd.apple.mpegurl")

        rendition = MediaRendition.objects.filter(
            id=rendition_id,
            media_asset_id=asset_id,
            media_asset__workspace__slug=slug,
            media_asset__project_id=project_id,
            kind=MediaRendition.Kind.HLS,
        ).first()
        if not rendition:
            return Response({"error": "Rendition not found."}, status=status.HTTP_404_NOT_FOUND)

        storage = S3Storage(request=request)
        response = storage.s3_client.get_object(
            Bucket=storage.aws_storage_bucket_name,
            Key=rendition.path,
        )
        content = response["Body"].read().decode("utf-8")
        base_path = rendition.path.rsplit("/", 1)[0]

        signed_lines = []
        for line in content.splitlines():
            if not line or line.startswith("#"):
                signed_lines.append(line)
                continue
            segment_key = f"{base_path}/{line}"
            signed_url = storage.generate_presigned_url(object_name=segment_key)
            signed_lines.append(signed_url)

        return HttpResponse("\n".join(signed_lines), content_type="application/vnd.apple.mpegurl")


class MediaAssetFileEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def get(self, request, slug, project_id, asset_id):
        if settings.MEDIA_LIBRARY_STORAGE != "manifest":
            return Response({"error": "Unsupported operation."}, status=status.HTTP_400_BAD_REQUEST)
        workspace = Workspace.objects.get(slug=slug)
        Project.objects.get(id=project_id, workspace=workspace)
        root_dir, _ = ensure_root_manifest(workspace.id, project_id)
        manifest_path, manifest = load_file_manifest(root_dir, asset_id)
        if not manifest:
            return Response({"error": "Asset not found."}, status=status.HTTP_404_NOT_FOUND)
        file_dir = manifest_path.parent
        kind = request.query_params.get("kind")
        raw_path = request.query_params.get("path")

        relative_path = None
        download_name = None
        content_type = None

        if raw_path:
            relative_path = raw_path
        elif kind == "thumbnail":
            thumbnail = next(iter(manifest.get("thumbnails", [])), None)
            if thumbnail:
                relative_path = thumbnail.get("relative_path")
                content_type = thumbnail.get("mime_type")
        elif kind == "preview":
            relative_path = manifest.get("preview", {}).get("preferred") or manifest.get("preview", {}).get("fallback")
        else:
            relative_path = manifest.get("original", {}).get("relative_path")
            download_name = manifest.get("original", {}).get("filename") if request.query_params.get("download") else None
            content_type = manifest.get("original", {}).get("mime_type")

        if not relative_path:
            return Response({"error": "File not found."}, status=status.HTTP_404_NOT_FOUND)
        full_path = (file_dir / relative_path).resolve()
        if not str(full_path).startswith(str(file_dir.resolve())):
            return Response({"error": "Invalid path."}, status=status.HTTP_400_BAD_REQUEST)
        if not content_type:
            content_type = mimetypes.guess_type(str(full_path))[0]
        return _serve_local_file(full_path, content_type=content_type, download_name=download_name)


class MediaCollectionEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def get(self, request, slug, project_id):
        if settings.MEDIA_LIBRARY_STORAGE == "manifest":
            workspace = Workspace.objects.get(slug=slug)
            Project.objects.get(id=project_id, workspace=workspace)
            root_dir, _ = ensure_root_manifest(workspace.id, project_id)
            collections = manifest_list_collections(root_dir)
            return Response(collections, status=status.HTTP_200_OK)

        collections = (
            MediaCollection.objects.filter(workspace__slug=slug, project_id=project_id)
            .annotate(asset_count=Count("media_assets", distinct=True))
            .order_by("name")
        )
        serializer = MediaCollectionSerializer(collections, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def post(self, request, slug, project_id):
        if settings.MEDIA_LIBRARY_STORAGE == "manifest":
            name = request.data.get("name", "").strip()
            description = request.data.get("description", "")
            parent_id = request.data.get("parent_id")
            if not name:
                return Response({"error": "Collection name is required."}, status=status.HTTP_400_BAD_REQUEST)
            workspace = Workspace.objects.get(slug=slug)
            Project.objects.get(id=project_id, workspace=workspace)
            root_dir, _ = ensure_root_manifest(workspace.id, project_id)
            collection = manifest_create_collection(root_dir, name=name, description=description, parent_id=parent_id)
            collection["asset_count"] = 0
            return Response(collection, status=status.HTTP_201_CREATED)

        name = request.data.get("name", "").strip()
        description = request.data.get("description", "")
        parent_id = request.data.get("parent_id")
        if not name:
            return Response({"error": "Collection name is required."}, status=status.HTTP_400_BAD_REQUEST)

        workspace = Workspace.objects.get(slug=slug)
        Project.objects.get(id=project_id, workspace=workspace)
        parent = None
        if parent_id:
            parent = MediaCollection.objects.filter(
                id=parent_id,
                workspace=workspace,
                project_id=project_id,
            ).first()

        collection = MediaCollection.objects.create(
            workspace=workspace,
            project_id=project_id,
            name=name,
            description=description,
            parent=parent,
            created_by=request.user,
        )

        serializer = MediaCollectionSerializer(collection)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class MediaCollectionDetailEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def patch(self, request, slug, project_id, collection_id):
        if settings.MEDIA_LIBRARY_STORAGE == "manifest":
            name = request.data.get("name")
            description = request.data.get("description")
            parent_id = request.data.get("parent_id")
            workspace = Workspace.objects.get(slug=slug)
            Project.objects.get(id=project_id, workspace=workspace)
            root_dir, _ = ensure_root_manifest(workspace.id, project_id)
            collection = manifest_update_collection(
                root_dir, collection_id, name=name, description=description, parent_id=parent_id
            )
            if not collection:
                return Response({"error": "Collection not found."}, status=status.HTTP_404_NOT_FOUND)
            collection["asset_count"] = len(collection.get("files", []))
            return Response(collection, status=status.HTTP_200_OK)

        collection = MediaCollection.objects.get(id=collection_id, workspace__slug=slug, project_id=project_id)
        name = request.data.get("name")
        description = request.data.get("description")
        parent_id = request.data.get("parent_id")

        if name is not None:
            collection.name = name
        if description is not None:
            collection.description = description
        if parent_id is not None:
            parent = MediaCollection.objects.filter(
                id=parent_id, workspace__slug=slug, project_id=project_id
            ).first()
            collection.parent = parent

        collection.save(update_fields=["name", "description", "parent"])
        serializer = MediaCollectionSerializer(collection)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def delete(self, request, slug, project_id, collection_id):
        if settings.MEDIA_LIBRARY_STORAGE == "manifest":
            workspace = Workspace.objects.get(slug=slug)
            Project.objects.get(id=project_id, workspace=workspace)
            root_dir, _ = ensure_root_manifest(workspace.id, project_id)
            removed = manifest_delete_collection(root_dir, collection_id)
            if not removed:
                return Response({"error": "Collection not found or not empty."}, status=status.HTTP_400_BAD_REQUEST)
            return Response(status=status.HTTP_204_NO_CONTENT)

        collection = MediaCollection.objects.get(id=collection_id, workspace__slug=slug, project_id=project_id)
        collection.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class MediaTagEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def get(self, request, slug, project_id):
        if settings.MEDIA_LIBRARY_STORAGE == "manifest":
            workspace = Workspace.objects.get(slug=slug)
            Project.objects.get(id=project_id, workspace=workspace)
            root_dir, _ = ensure_root_manifest(workspace.id, project_id)
            tags = manifest_list_tags(root_dir)
            return Response(tags, status=status.HTTP_200_OK)

        tags = (
            MediaTag.objects.filter(workspace__slug=slug, project_id=project_id)
            .annotate(asset_count=Count("media_assets", distinct=True))
            .order_by("name")
        )
        serializer = MediaTagSerializer(tags, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def post(self, request, slug, project_id):
        if settings.MEDIA_LIBRARY_STORAGE == "manifest":
            names = request.data.get("tags", [])
            if not isinstance(names, list):
                return Response({"error": "Invalid tags payload."}, status=status.HTTP_400_BAD_REQUEST)
            workspace = Workspace.objects.get(slug=slug)
            Project.objects.get(id=project_id, workspace=workspace)
            root_dir, _ = ensure_root_manifest(workspace.id, project_id)
            existing = {tag.get("slug"): tag for tag in manifest_list_tags(root_dir)}
            tags = []
            for name in names:
                slug = slugify(name) or name.strip().replace(" ", "-").lower()
                tags.append(existing.get(slug, {"id": slug, "name": name, "slug": slug, "asset_count": 0}))
            return Response(tags, status=status.HTTP_201_CREATED)

        names = request.data.get("tags", [])
        if not isinstance(names, list):
            return Response({"error": "Invalid tags payload."}, status=status.HTTP_400_BAD_REQUEST)
        workspace = Workspace.objects.get(slug=slug)
        Project.objects.get(id=project_id, workspace=workspace)
        tags = _get_tag_objects(workspace, project_id, names)
        serializer = MediaTagSerializer(tags, many=True)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class MediaAssetShareEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def post(self, request, slug, project_id, asset_id):
        if settings.MEDIA_LIBRARY_STORAGE == "manifest":
            workspace = Workspace.objects.get(slug=slug)
            Project.objects.get(id=project_id, workspace=workspace)
            root_dir, _ = ensure_root_manifest(workspace.id, project_id)
            expires_at = request.data.get("expires_at")
            parsed_expiry = parse_datetime(expires_at) if expires_at else None
            if expires_at and not parsed_expiry:
                return Response({"error": "Invalid expiry date."}, status=status.HTTP_400_BAD_REQUEST)
            share, token = manifest_create_share(root_dir, asset_id, parsed_expiry.isoformat() if parsed_expiry else None)
            if not share:
                return Response({"error": "Asset not found."}, status=status.HTTP_404_NOT_FOUND)
            share_url = (
                f"{base_host(request, is_app=True)}/share/media/{token}/"
                f"?workspace={slug}&project_id={project_id}"
            )
            return Response({"share": share, "share_url": share_url}, status=status.HTTP_201_CREATED)

        asset = MediaAsset.objects.get(id=asset_id, workspace__slug=slug, project_id=project_id)
        expires_at = request.data.get("expires_at")
        parsed_expiry = parse_datetime(expires_at) if expires_at else None
        if expires_at and not parsed_expiry:
            return Response({"error": "Invalid expiry date."}, status=status.HTTP_400_BAD_REQUEST)
        share = MediaShare.objects.create(
            media_asset=asset,
            expires_at=parsed_expiry,
            created_by=request.user,
        )
        share_url = f"{base_host(request, is_app=True)}/share/media/{share.token}/"
        serializer = MediaShareSerializer(share)
        return Response(
            {"share": serializer.data, "share_url": share_url},
            status=status.HTTP_201_CREATED,
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def delete(self, request, slug, project_id, asset_id, share_id):
        if settings.MEDIA_LIBRARY_STORAGE == "manifest":
            workspace = Workspace.objects.get(slug=slug)
            Project.objects.get(id=project_id, workspace=workspace)
            root_dir, _ = ensure_root_manifest(workspace.id, project_id)
            manifest_revoke_share(root_dir, asset_id, share_id)
            return Response(status=status.HTTP_204_NO_CONTENT)

        share = MediaShare.objects.get(id=share_id, media_asset_id=asset_id)
        share.revoked_at = timezone.now()
        share.save(update_fields=["revoked_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class MediaShareAccessEndpoint(BaseAPIView):
    permission_classes = [AllowAny]

    def get(self, request, token):
        if settings.MEDIA_LIBRARY_STORAGE == "manifest":
            workspace_slug = request.query_params.get("workspace") or request.query_params.get("slug")
            project_id = request.query_params.get("project_id")
            if not workspace_slug or not project_id:
                return Response({"error": "Invalid share link."}, status=status.HTTP_404_NOT_FOUND)
            workspace = Workspace.objects.get(slug=workspace_slug)
            root_dir, _ = ensure_root_manifest(workspace.id, project_id)
            share_entry = manifest_resolve_share(root_dir, token)
            if not share_entry:
                return Response({"error": "Share link expired."}, status=status.HTTP_404_NOT_FOUND)
            if share_entry.get("revoked_at"):
                return Response({"error": "Share link expired."}, status=status.HTTP_404_NOT_FOUND)
            if share_entry.get("expires_at"):
                parsed_expiry = parse_datetime(share_entry.get("expires_at"))
                if parsed_expiry and parsed_expiry <= timezone.now():
                    return Response({"error": "Share link expired."}, status=status.HTTP_404_NOT_FOUND)

            file_id = share_entry.get("file_id")
            manifest_path, manifest = load_file_manifest(root_dir, file_id)
            if not manifest:
                return Response({"error": "Share link expired."}, status=status.HTTP_404_NOT_FOUND)

            if request.query_params.get("download") == "1":
                file_dir = manifest_path.parent
                relative_path = manifest.get("original", {}).get("relative_path")
                return _serve_local_file(
                    file_dir / relative_path,
                    content_type=manifest.get("original", {}).get("mime_type"),
                    download_name=manifest.get("original", {}).get("filename"),
                )

            asset = _manifest_asset_with_collections(manifest, request, workspace_slug, project_id, root_dir)
            asset["preview_url"] = f"/api/media/shares/{token}/file/?kind=preview&workspace={workspace_slug}&project_id={project_id}"
            asset["download_url"] = f"/api/media/shares/{token}/file/?kind=original&download=1&workspace={workspace_slug}&project_id={project_id}"
            asset["thumbnail_url"] = f"/api/media/shares/{token}/file/?kind=thumbnail&workspace={workspace_slug}&project_id={project_id}"
            return Response({"share": share_entry, "asset": asset}, status=status.HTTP_200_OK)

        share = (
            MediaShare.objects.filter(token=token, revoked_at__isnull=True)
            .select_related("media_asset", "media_asset__workspace", "media_asset__project")
            .first()
        )
        if not share or (share.expires_at and share.expires_at <= timezone.now()):
            return Response({"error": "Share link expired."}, status=status.HTTP_404_NOT_FOUND)

        if request.query_params.get("download") == "1":
            storage = S3Storage(request=request)
            signed_url = storage.generate_presigned_url(
                object_name=share.media_asset.asset.name,
                disposition="attachment",
                filename=share.media_asset.file_name,
            )
            return HttpResponseRedirect(signed_url)

        serializer = MediaAssetDetailSerializer(share.media_asset, context={"request": request})
        return Response(
            {
                "share": MediaShareSerializer(share).data,
                "asset": serializer.data,
            },
            status=status.HTTP_200_OK,
        )


class MediaShareFileEndpoint(BaseAPIView):
    permission_classes = [AllowAny]

    def get(self, request, token):
        if settings.MEDIA_LIBRARY_STORAGE != "manifest":
            return Response({"error": "Unsupported operation."}, status=status.HTTP_400_BAD_REQUEST)
        workspace_slug = request.query_params.get("workspace") or request.query_params.get("slug")
        project_id = request.query_params.get("project_id")
        if not workspace_slug or not project_id:
            return Response({"error": "Invalid share link."}, status=status.HTTP_404_NOT_FOUND)
        workspace = Workspace.objects.get(slug=workspace_slug)
        root_dir, _ = ensure_root_manifest(workspace.id, project_id)
        share_entry = manifest_resolve_share(root_dir, token)
        if not share_entry:
            return Response({"error": "Share link expired."}, status=status.HTTP_404_NOT_FOUND)
        if share_entry.get("revoked_at"):
            return Response({"error": "Share link expired."}, status=status.HTTP_404_NOT_FOUND)
        if share_entry.get("expires_at"):
            parsed_expiry = parse_datetime(share_entry.get("expires_at"))
            if parsed_expiry and parsed_expiry <= timezone.now():
                return Response({"error": "Share link expired."}, status=status.HTTP_404_NOT_FOUND)
        file_id = share_entry.get("file_id")
        manifest_path, manifest = load_file_manifest(root_dir, file_id)
        if not manifest:
            return Response({"error": "Share link expired."}, status=status.HTTP_404_NOT_FOUND)
        file_dir = manifest_path.parent
        kind = request.query_params.get("kind")
        relative_path = None
        content_type = None
        if kind == "preview":
            relative_path = manifest.get("preview", {}).get("preferred") or manifest.get("preview", {}).get("fallback")
        elif kind == "thumbnail":
            thumbnail = next(iter(manifest.get("thumbnails", [])), None)
            if thumbnail:
                relative_path = thumbnail.get("relative_path")
                content_type = thumbnail.get("mime_type")
        else:
            relative_path = manifest.get("original", {}).get("relative_path")
        if not relative_path:
            return Response({"error": "File not found."}, status=status.HTTP_404_NOT_FOUND)
        download_name = manifest.get("original", {}).get("filename") if request.query_params.get("download") else None
        return _serve_local_file(
            file_dir / relative_path,
            content_type=content_type or manifest.get("original", {}).get("mime_type"),
            download_name=download_name,
        )
