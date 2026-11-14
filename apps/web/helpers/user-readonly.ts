import { EUserPermissions } from "@plane/constants";

/** User is a read-only ceiling, independent of stale elevated program roles. */
export const isUserReadOnly = (workspaceRole: unknown, projectRole?: unknown): boolean =>
  Number(workspaceRole) === EUserPermissions.USER || Number(projectRole) === EUserPermissions.USER;

export const getWorkspaceEntryPath = (workspaceSlug: string): string => `/${workspaceSlug}`;

/** Workspace Users only mount supported read-only widgets; program roles do not change workspace home. */
export const getVisibleHomeWidgetKeys = <T extends string>(widgetKeys: T[], workspaceRole: unknown): T[] =>
  isUserReadOnly(workspaceRole) ? widgetKeys.filter((key) => key === "recents") : widgetKeys;
