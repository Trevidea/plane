import { createContext, useContext } from "react";
import { useObserver } from "mobx-react";
import { useParams } from "next/navigation";
import { isUserReadOnly } from "@/helpers/user-readonly";
import { useUserPermissions } from "@/hooks/store/user";

export const UserReadOnlyContext = createContext(false);

/** Read-only access is resolved for the resource, never every program in a workspace. */
export const useUserReadOnly = (resourceWorkspaceSlug?: string, resourceProjectId?: string): boolean => {
  const params = useParams();
  const inheritedReadOnly = useContext(UserReadOnlyContext);
  const workspaceSlug = resourceWorkspaceSlug ?? params.workspaceSlug?.toString();
  const projectId = resourceProjectId ?? params.projectId?.toString();
  const permissions = useUserPermissions();
  return useObserver(() => {
    const workspaceRole = workspaceSlug ? permissions.getWorkspaceRoleByWorkspaceSlug(workspaceSlug) : undefined;
    const projectRole =
      workspaceSlug && projectId
        ? permissions.getProjectRoleByWorkspaceSlugAndProjectId(workspaceSlug, projectId)
        : undefined;
    return (
      inheritedReadOnly ||
      workspaceRole === undefined ||
      (!!projectId && projectRole === undefined) ||
      isUserReadOnly(workspaceRole, projectRole)
    );
  });
};
