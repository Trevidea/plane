"use client";

import { observer } from "mobx-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
// components
import { ProjectRoot } from "@/components/project/root";
// hooks
import { useProject } from "@/hooks/store/use-project";
import { useWorkspace } from "@/hooks/store/use-workspace";
import { useUserPermissions } from "@/hooks/store/user";

export const ProjectPageRoot = observer(() => {
  // router
  const { workspaceSlug } = useParams();
  // store
  const { currentWorkspace } = useWorkspace();
  const { fetchProjects } = useProject();
  const { allowPermissions } = useUserPermissions();
  // fetching workspace projects
  useSWR(
    workspaceSlug && currentWorkspace ? `WORKSPACE_PROJECTS_${workspaceSlug}` : null,
    workspaceSlug && currentWorkspace ? () => fetchProjects(workspaceSlug.toString()) : null,
    { revalidateIfStale: false, revalidateOnFocus: false }
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {typeof workspaceSlug === "string" &&
        allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.WORKSPACE, workspaceSlug) && (
          <div className="border-b border-custom-border-200 px-5 py-2">
            <Link
              href={`/${workspaceSlug}/projects/teams`}
              className="text-sm font-medium text-custom-primary-100 hover:underline"
            >
              Teams and seasons
            </Link>
          </div>
        )}
      <div className="min-h-0 flex-1">
        <ProjectRoot />
      </div>
    </div>
  );
});
