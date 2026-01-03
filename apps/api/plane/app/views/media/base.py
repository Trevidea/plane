# Python imports
import os

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


def _derive_media_kind(mime_type):
    if not mime_type:
        return MediaAsset.MediaKind.OTHER
    if mime_type.startswith("image/"):
        return MediaAsset.MediaKind.IMAGE
    if mime_type.startswith("video/"):
        return MediaAsset.MediaKind.VIDEO
    if mime_type.startswith("audio/"):
        return MediaAsset.MediaKind.AUDIO
    if mime_type in ["application/pdf"]:
        return MediaAsset.MediaKind.DOCUMENT
    if mime_type in ["application/zip", "application/x-zip-compressed", "application/x-rar"]:
        return MediaAsset.MediaKind.ARCHIVE
    return MediaAsset.MediaKind.OTHER


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
        asset = MediaAsset.objects.get(id=asset_id, workspace__slug=slug, project_id=project_id)
        asset.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class MediaAssetUploadCompleteEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def post(self, request, slug, project_id):
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


class MediaCollectionEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def get(self, request, slug, project_id):
        collections = (
            MediaCollection.objects.filter(workspace__slug=slug, project_id=project_id)
            .annotate(asset_count=Count("media_assets", distinct=True))
            .order_by("name")
        )
        serializer = MediaCollectionSerializer(collections, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def post(self, request, slug, project_id):
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
        collection = MediaCollection.objects.get(id=collection_id, workspace__slug=slug, project_id=project_id)
        collection.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class MediaTagEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def get(self, request, slug, project_id):
        tags = (
            MediaTag.objects.filter(workspace__slug=slug, project_id=project_id)
            .annotate(asset_count=Count("media_assets", distinct=True))
            .order_by("name")
        )
        serializer = MediaTagSerializer(tags, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def post(self, request, slug, project_id):
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
        share = MediaShare.objects.get(id=share_id, media_asset_id=asset_id)
        share.revoked_at = timezone.now()
        share.save(update_fields=["revoked_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class MediaShareAccessEndpoint(BaseAPIView):
    permission_classes = [AllowAny]

    def get(self, request, token):
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
