# Python imports
from uuid import uuid4

# Django imports
from django.db import models
from django.template.defaultfilters import slugify

# Module imports
from .base import BaseModel


def get_media_upload_path(instance, filename):
    if instance.workspace_id is not None:
        return f"{instance.workspace.id}/media/{uuid4().hex}-{filename}"
    return f"media/{uuid4().hex}-{filename}"


class MediaTag(BaseModel):
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="media_tags")
    project = models.ForeignKey("db.Project", on_delete=models.CASCADE, related_name="media_tags")
    name = models.CharField(max_length=255)
    slug = models.CharField(max_length=255)

    class Meta:
        db_table = "media_tags"
        ordering = ("-created_at",)
        unique_together = ("project", "slug")
        indexes = [
            models.Index(fields=["project", "slug"], name="media_tag_project_slug_idx"),
        ]

    def save(self, *args, **kwargs):
        if self.name:
            self.slug = slugify(self.name)
        super().save(*args, **kwargs)


class MediaCollection(BaseModel):
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="media_collections")
    project = models.ForeignKey("db.Project", on_delete=models.CASCADE, related_name="media_collections")
    name = models.CharField(max_length=255)
    slug = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    parent = models.ForeignKey(
        "db.MediaCollection",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="children",
    )

    class Meta:
        db_table = "media_collections"
        ordering = ("-created_at",)
        unique_together = ("project", "slug")
        indexes = [
            models.Index(fields=["project", "slug"], name="media_coll_proj_slug_idx"),
        ]

    def save(self, *args, **kwargs):
        if self.name:
            self.slug = slugify(self.name)
        super().save(*args, **kwargs)


class MediaAsset(BaseModel):
    class Status(models.TextChoices):
        UPLOADING = "UPLOADING"
        PROCESSING = "PROCESSING"
        READY = "READY"
        FAILED = "FAILED"

    class MediaKind(models.TextChoices):
        IMAGE = "IMAGE"
        VIDEO = "VIDEO"
        AUDIO = "AUDIO"
        DOCUMENT = "DOCUMENT"
        ARCHIVE = "ARCHIVE"
        OTHER = "OTHER"

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="media_assets")
    project = models.ForeignKey("db.Project", on_delete=models.CASCADE, related_name="media_assets")
    title = models.CharField(max_length=255, blank=True)
    description = models.TextField(blank=True)
    file_name = models.CharField(max_length=255)
    mime_type = models.CharField(max_length=255)
    size = models.BigIntegerField(default=0)
    asset = models.FileField(upload_to=get_media_upload_path, max_length=800)
    status = models.CharField(max_length=32, choices=Status.choices, default=Status.UPLOADING)
    media_kind = models.CharField(max_length=32, choices=MediaKind.choices, default=MediaKind.OTHER)
    is_uploaded = models.BooleanField(default=False)
    duration = models.FloatField(null=True, blank=True)
    width = models.IntegerField(null=True, blank=True)
    height = models.IntegerField(null=True, blank=True)
    page_count = models.IntegerField(null=True, blank=True)
    processing_error = models.TextField(blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    tags = models.ManyToManyField("db.MediaTag", through="db.MediaAssetTag", related_name="media_assets", blank=True)
    collections = models.ManyToManyField(
        "db.MediaCollection",
        through="db.MediaCollectionItem",
        related_name="media_assets",
        blank=True,
    )

    class Meta:
        db_table = "media_assets"
        ordering = ("-created_at",)
        indexes = [
            models.Index(fields=["project"], name="media_asset_project_idx"),
            models.Index(fields=["status"], name="media_asset_status_idx"),
            models.Index(fields=["media_kind"], name="media_asset_kind_idx"),
        ]

    def __str__(self):
        return self.title or self.file_name


class MediaAssetTag(BaseModel):
    media_asset = models.ForeignKey("db.MediaAsset", on_delete=models.CASCADE, related_name="asset_tags")
    tag = models.ForeignKey("db.MediaTag", on_delete=models.CASCADE, related_name="asset_tags")

    class Meta:
        db_table = "media_asset_tags"
        unique_together = ("media_asset", "tag")
        indexes = [
            models.Index(fields=["media_asset"], name="media_asset_tag_asset_idx"),
            models.Index(fields=["tag"], name="media_asset_tag_tag_idx"),
        ]


class MediaCollectionItem(BaseModel):
    media_asset = models.ForeignKey("db.MediaAsset", on_delete=models.CASCADE, related_name="collection_items")
    collection = models.ForeignKey("db.MediaCollection", on_delete=models.CASCADE, related_name="collection_items")
    sort_order = models.IntegerField(default=0)

    class Meta:
        db_table = "media_collection_items"
        unique_together = ("media_asset", "collection")
        indexes = [
            models.Index(fields=["media_asset"], name="mcolitem_asset_idx"),
            models.Index(fields=["collection"], name="mcolitem_coll_idx"),
        ]


class MediaRendition(BaseModel):
    class Kind(models.TextChoices):
        THUMBNAIL = "THUMBNAIL"
        PREVIEW = "PREVIEW"
        HLS = "HLS"
        DERIVATIVE = "DERIVATIVE"

    media_asset = models.ForeignKey("db.MediaAsset", on_delete=models.CASCADE, related_name="renditions")
    kind = models.CharField(max_length=32, choices=Kind.choices)
    format = models.CharField(max_length=32)
    path = models.CharField(max_length=800)
    mime_type = models.CharField(max_length=255, blank=True)
    size = models.BigIntegerField(default=0)
    width = models.IntegerField(null=True, blank=True)
    height = models.IntegerField(null=True, blank=True)
    duration = models.FloatField(null=True, blank=True)
    bitrate = models.IntegerField(null=True, blank=True)
    is_primary = models.BooleanField(default=False)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = "media_renditions"
        ordering = ("-created_at",)
        indexes = [
            models.Index(fields=["media_asset"], name="media_rendition_asset_idx"),
            models.Index(fields=["kind"], name="media_rendition_kind_idx"),
        ]


class MediaShare(BaseModel):
    media_asset = models.ForeignKey("db.MediaAsset", on_delete=models.CASCADE, related_name="shares")
    token = models.UUIDField(default=uuid4, unique=True, db_index=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "media_shares"
        ordering = ("-created_at",)

    def is_active(self):
        if self.revoked_at:
            return False
        if self.expires_at:
            from django.utils import timezone

            return self.expires_at > timezone.now()
        return True
