"""Shared player comments are retired; only private conversations may be used."""

from html import unescape
from django.utils.html import strip_tags
from rest_framework import serializers
from rest_framework.response import Response
from plane.app.views.base import BaseAPIView
from plane.utils.content_validator import validate_html_content


class PlayerThreadWriteSerializer(serializers.Serializer):
    comment_html = serializers.CharField(max_length=20000, trim_whitespace=True)

    def to_internal_value(self, data):
        if not isinstance(data, dict):
            raise serializers.ValidationError("Expected an object containing comment_html.")
        unknown = set(data) - {"comment_html"}
        if unknown:
            raise serializers.ValidationError({key: "This field is not writable." for key in unknown})
        return super().to_internal_value(data)

    def validate_comment_html(self, value):
        valid, error, cleaned = validate_html_content(value)
        if not valid:
            raise serializers.ValidationError(error)
        if not unescape(strip_tags(cleaned or "")).strip():
            raise serializers.ValidationError("Write a message before sending.")
        return cleaned


class RetiredSharedPlayerThreadEndpoint(BaseAPIView):
    def retired(self, request, *args, **kwargs):
        return Response(
            {
                "code": "private_thread_required",
                "detail": "Shared player conversations are retired. Update your app to use private messaging.",
            },
            status=410,
            headers={"Cache-Control": "private, no-store"},
        )

    get = retired
    post = retired
    patch = retired
    delete = retired


class PlayerThreadEndpoint(RetiredSharedPlayerThreadEndpoint):
    pass


class PlayerThreadMessageEndpoint(RetiredSharedPlayerThreadEndpoint):
    pass
