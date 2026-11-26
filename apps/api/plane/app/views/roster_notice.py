from django.http import Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.authentication import SessionAuthentication
from rest_framework.response import Response

from plane.app.views.base import BaseAPIView
from plane.utils.roster_notices import notices_for


PRIVATE = {"Cache-Control": "private, no-store"}


class RosterNoticeQuery(serializers.Serializer):
    limit = serializers.IntegerField(min_value=1, max_value=50, default=25)
    offset = serializers.IntegerField(min_value=0, max_value=2**31 - 1, default=0)


class RosterNoticeEndpoint(BaseAPIView):
    authentication_classes = [SessionAuthentication]
    user_role_access = True

    def get(self, request, slug=None, notice_id=None):
        if notice_id:
            raise Http404
        query = RosterNoticeQuery(data=request.query_params)
        query.is_valid(raise_exception=True)
        limit, offset = query.validated_data["limit"], query.validated_data["offset"]
        rows = notices_for(request.user, staff_workspace=slug)
        return Response(
            {
                "total_count": rows.count(),
                "unread_count": rows.filter(read_at__isnull=True).count(),
                "limit": limit,
                "offset": offset,
                "results": [
                    {
                        "id": notice.pk,
                        "kind": notice.kind,
                        "program_id": notice.project_id,
                        "program_name": notice.project.name,
                        "workspace_slug": notice.project.workspace.slug,
                        "workspace_name": notice.project.workspace.name,
                        "status": notice.status or None,
                        "created_at": notice.created_at,
                        "read_at": notice.read_at,
                    }
                    for notice in rows.select_related("project__workspace").order_by("-created_at", "-id")[
                        offset : offset + limit
                    ]
                ],
            },
            headers=PRIVATE,
        )

    def post(self, request, slug=None, notice_id=None):
        if not notice_id:
            raise Http404
        if request.data:
            raise serializers.ValidationError("Marking a notice read accepts an empty object only.")
        rows = notices_for(request.user, staff_workspace=slug)
        now = timezone.now()
        rows.filter(pk=notice_id, read_at__isnull=True).update(read_at=now, updated_at=now)
        notice = get_object_or_404(rows.only("read_at"), pk=notice_id)
        return Response({"read_at": notice.read_at}, headers=PRIVATE)
