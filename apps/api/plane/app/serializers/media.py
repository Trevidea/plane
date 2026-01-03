from rest_framework import serializers

from plane.db.models import MediaAsset, MediaCollection, MediaRendition, MediaShare, MediaTag
from plane.settings.storage import S3Storage

from .base import BaseSerializer


class MediaTagSerializer(BaseSerializer):
    asset_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = MediaTag
        fields = "__all__"
        read_only_fields = ["created_by", "updated_by", "created_at", "updated_at"]


class MediaCollectionSerializer(BaseSerializer):
    asset_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = MediaCollection
        fields = "__all__"
        read_only_fields = ["created_by", "updated_by", "created_at", "updated_at"]


class MediaRenditionSerializer(BaseSerializer):
    url = serializers.SerializerMethodField()

    class Meta:
        model = MediaRendition
        fields = "__all__"
        read_only_fields = ["created_by", "updated_by", "created_at", "updated_at"]

    def get_url(self, obj):
        request = self.context.get("request")
        if obj.kind == MediaRendition.Kind.HLS:
            return (
                f"/api/media/workspaces/{obj.media_asset.workspace.slug}/projects/{obj.media_asset.project_id}"
                f"/assets/{obj.media_asset.id}/hls/{obj.id}/"
            )
        storage = S3Storage(request=request)
        return storage.generate_presigned_url(
            object_name=obj.path,
            disposition="inline",
            filename=obj.metadata.get("name") if obj.metadata else None,
        )


class MediaAssetSerializer(BaseSerializer):
    thumbnail_url = serializers.SerializerMethodField()

    class Meta:
        model = MediaAsset
        fields = [
            "id",
            "title",
            "description",
            "file_name",
            "mime_type",
            "size",
            "status",
            "media_kind",
            "is_uploaded",
            "duration",
            "width",
            "height",
            "created_at",
            "thumbnail_url",
        ]

    def get_thumbnail_url(self, obj):
        request = self.context.get("request")
        if not obj.is_uploaded:
            return None
        thumbnail = None
        if hasattr(obj, "renditions"):
            thumbnail = next(
                (item for item in obj.renditions.all() if item.kind == MediaRendition.Kind.THUMBNAIL),
                None,
            )
        if not thumbnail:
            thumbnail = MediaRendition.objects.filter(
                media_asset=obj, kind=MediaRendition.Kind.THUMBNAIL
            ).order_by("-created_at").first()
        if not thumbnail:
            return None
        storage = S3Storage(request=request)
        return storage.generate_presigned_url(
            object_name=thumbnail.path,
            disposition="inline",
            filename=thumbnail.metadata.get("name") if thumbnail.metadata else None,
        )


class MediaAssetDetailSerializer(MediaAssetSerializer):
    tags = MediaTagSerializer(many=True, read_only=True)
    collections = MediaCollectionSerializer(many=True, read_only=True)
    renditions = MediaRenditionSerializer(many=True, read_only=True)
    download_url = serializers.SerializerMethodField()
    preview_url = serializers.SerializerMethodField()

    class Meta(MediaAssetSerializer.Meta):
        fields = MediaAssetSerializer.Meta.fields + [
            "tags",
            "collections",
            "renditions",
            "download_url",
            "preview_url",
        ]

    def get_download_url(self, obj):
        request = self.context.get("request")
        if not obj.is_uploaded:
            return None
        storage = S3Storage(request=request)
        return storage.generate_presigned_url(
            object_name=obj.asset.name,
            disposition="attachment",
            filename=obj.file_name,
        )

    def get_preview_url(self, obj):
        request = self.context.get("request")
        if not obj.is_uploaded:
            return None
        renditions = []
        if hasattr(obj, "renditions"):
            renditions = list(obj.renditions.all())
        else:
            renditions = list(MediaRendition.objects.filter(media_asset=obj))
        preview = next((item for item in renditions if item.kind == MediaRendition.Kind.PREVIEW), None)
        if preview:
            storage = S3Storage(request=request)
            return storage.generate_presigned_url(
                object_name=preview.path,
                disposition="inline",
                filename=preview.metadata.get("name") if preview.metadata else None,
            )
        preview = next((item for item in renditions if item.kind == MediaRendition.Kind.HLS), None)
        if preview:
            return (
                f"/api/media/workspaces/{obj.workspace.slug}/projects/{obj.project_id}/assets/{obj.id}"
                f"/hls/{preview.id}/"
            )
        storage = S3Storage(request=request)
        return storage.generate_presigned_url(
            object_name=obj.asset.name,
            disposition="inline",
            filename=obj.file_name,
        )


class MediaShareSerializer(BaseSerializer):
    class Meta:
        model = MediaShare
        fields = "__all__"
        read_only_fields = ["created_by", "updated_by", "created_at", "updated_at"]
