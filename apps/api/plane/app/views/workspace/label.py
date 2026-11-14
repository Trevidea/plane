from plane.utils.user_role_access import has_user_role, user_readonly_projects

# Third party modules
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.serializers import LabelSerializer
from plane.app.views.base import BaseAPIView
from plane.db.models import Label
from plane.app.permissions import WorkspaceViewerPermission
from plane.utils.cache import cache_response


class WorkspaceLabelsEndpoint(BaseAPIView):
    user_role_readonly = True
    permission_classes = [WorkspaceViewerPermission]
    use_read_replica = True

    @cache_response(60 * 60 * 2)
    def get(self, request, slug):
        labels = Label.objects.filter(
            workspace__slug=slug,
            **(
                {"project_id__in": user_readonly_projects(request.user, slug).values("id")}
                if has_user_role(request, self)
                else {
                    "project__project_projectmember__member": request.user,
                    "project__project_projectmember__is_active": True,
                }
            ),
            project__archived_at__isnull=True,
        )
        serializer = LabelSerializer(labels, many=True).data
        return Response(serializer, status=status.HTTP_200_OK)
