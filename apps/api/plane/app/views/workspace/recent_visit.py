from plane.utils.user_role_access import has_user_role, user_readonly_projects

# Third party imports
from rest_framework import status
from rest_framework.response import Response

from plane.db.models import UserRecentVisit
from plane.app.serializers import WorkspaceRecentVisitSerializer

# Modules imports
from ..base import BaseViewSet
from plane.app.permissions import allow_permission, ROLE


class UserRecentVisitViewSet(BaseViewSet):
    user_role_readonly = True
    model = UserRecentVisit
    use_read_replica = True

    def get_serializer_class(self):
        return WorkspaceRecentVisitSerializer

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def list(self, request, slug):
        user_recent_visits = UserRecentVisit.objects.filter(workspace__slug=slug, user=request.user)

        if has_user_role(request, self):
            user_recent_visits = user_recent_visits.filter(
                project_id__in=user_readonly_projects(request.user, slug).values("id")
            ).exclude(entity_name="page")
        entity_name = request.query_params.get("entity_name")

        if entity_name:
            user_recent_visits = user_recent_visits.filter(entity_name=entity_name)

        user_recent_visits = user_recent_visits.filter(entity_name__in=["issue", "page", "project"])

        serializer = WorkspaceRecentVisitSerializer(
            user_recent_visits[:20],
            many=True,
            context=(
                {"readonly_project_ids": user_readonly_projects(request.user, slug).values_list("id", flat=True)}
                if has_user_role(request, self)
                else {}
            ),
        )
        return Response(serializer.data, status=status.HTTP_200_OK)
