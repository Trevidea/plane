from plane.utils.user_role_access import has_user_role, user_readonly_projects

# Third party modules
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.serializers import StateSerializer
from plane.app.views.base import BaseAPIView
from plane.db.models import State
from plane.app.permissions import WorkspaceEntityPermission
from collections import defaultdict


class WorkspaceStatesEndpoint(BaseAPIView):
    user_role_readonly = True
    permission_classes = [WorkspaceEntityPermission]
    use_read_replica = True

    def get(self, request, slug):
        states = State.objects.filter(
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
            is_triage=False,
        )

        grouped_states = defaultdict(list)
        for state in states:
            grouped_states[state.group].append(state)

        for group, group_states in grouped_states.items():
            count = len(group_states)

            for index, state in enumerate(group_states, start=1):
                state.order = index / count

        serializer = StateSerializer(states, many=True).data
        return Response(serializer, status=status.HTTP_200_OK)
