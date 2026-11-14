from plane.utils.user_role_access import has_user_role, user_readonly_projects

# Third party modules
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import WorkspaceEntityPermission
from plane.app.serializers import WorkspaceEstimateSerializer
from plane.app.views.base import BaseAPIView
from plane.db.models import Estimate, Project
from plane.utils.cache import cache_response


class WorkspaceEstimatesEndpoint(BaseAPIView):
    user_role_readonly = True
    permission_classes = [WorkspaceEntityPermission]
    use_read_replica = True

    @cache_response(60 * 60 * 2)
    def get(self, request, slug):
        estimate_ids = (
            (
                user_readonly_projects(request.user, slug)
                if has_user_role(request, self)
                else Project.objects.filter(workspace__slug=slug)
            )
            .filter(estimate__isnull=False)
            .values_list("estimate_id", flat=True)
        )
        estimates = (
            Estimate.objects.filter(pk__in=estimate_ids, workspace__slug=slug)
            .prefetch_related("points")
            .select_related("workspace", "project")
        )

        serializer = WorkspaceEstimateSerializer(estimates, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)
