from plane.utils.user_role_access import has_user_role, user_readonly_projects

# Django imports
from django.db.models import Prefetch, Q, Count

# Third party modules
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.views.base import BaseAPIView
from plane.db.models import Module, ModuleLink
from plane.app.permissions import WorkspaceViewerPermission
from plane.app.serializers.module import ModuleSerializer


class WorkspaceModulesEndpoint(BaseAPIView):
    user_role_readonly = True
    permission_classes = [WorkspaceViewerPermission]

    def get(self, request, slug):
        modules = (
            Module.objects.filter(workspace__slug=slug)
            .filter(
                **(
                    {"project_id__in": user_readonly_projects(request.user, slug).values("id")}
                    if has_user_role(request, self)
                    else {}
                )
            )
            .select_related("project")
            .select_related("workspace")
            .select_related("lead")
            .prefetch_related("members")
            .filter(archived_at__isnull=True)
            .prefetch_related(
                Prefetch(
                    "link_module",
                    queryset=ModuleLink.objects.select_related("module", "created_by"),
                )
            )
            .annotate(
                total_issues=Count(
                    "issue_module",
                    filter=Q(
                        issue_module__issue__archived_at__isnull=True,
                        issue_module__issue__is_draft=False,
                        issue_module__deleted_at__isnull=True,
                    ),
                    distinct=True,
                )
            )
            .annotate(
                completed_issues=Count(
                    "issue_module__issue__state__group",
                    filter=Q(
                        issue_module__issue__state__group="completed",
                        issue_module__issue__archived_at__isnull=True,
                        issue_module__issue__is_draft=False,
                        issue_module__deleted_at__isnull=True,
                    ),
                    distinct=True,
                )
            )
            .annotate(
                cancelled_issues=Count(
                    "issue_module__issue__state__group",
                    filter=Q(
                        issue_module__issue__state__group="cancelled",
                        issue_module__issue__archived_at__isnull=True,
                        issue_module__issue__is_draft=False,
                        issue_module__deleted_at__isnull=True,
                    ),
                    distinct=True,
                )
            )
            .annotate(
                started_issues=Count(
                    "issue_module__issue__state__group",
                    filter=Q(
                        issue_module__issue__state__group="started",
                        issue_module__issue__archived_at__isnull=True,
                        issue_module__issue__is_draft=False,
                        issue_module__deleted_at__isnull=True,
                    ),
                    distinct=True,
                )
            )
            .annotate(
                unstarted_issues=Count(
                    "issue_module__issue__state__group",
                    filter=Q(
                        issue_module__issue__state__group="unstarted",
                        issue_module__issue__archived_at__isnull=True,
                        issue_module__issue__is_draft=False,
                        issue_module__deleted_at__isnull=True,
                    ),
                    distinct=True,
                )
            )
            .annotate(
                backlog_issues=Count(
                    "issue_module__issue__state__group",
                    filter=Q(
                        issue_module__issue__state__group="backlog",
                        issue_module__issue__archived_at__isnull=True,
                        issue_module__issue__is_draft=False,
                        issue_module__deleted_at__isnull=True,
                    ),
                    distinct=True,
                )
            )
            .order_by(self.kwargs.get("order_by", "-created_at"))
        )

        serializer = ModuleSerializer(modules, many=True).data
        return Response(serializer, status=status.HTTP_200_OK)
