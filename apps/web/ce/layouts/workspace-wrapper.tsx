import type { FC } from "react";
import { WorkspaceAuthWrapper as CoreWorkspaceAuthWrapper } from "@/layouts/auth-layout/workspace-wrapper";

export type IWorkspaceAuthWrapper = { children: React.ReactNode };

export const WorkspaceAuthWrapper: FC<IWorkspaceAuthWrapper> = ({ children }) => (
  <CoreWorkspaceAuthWrapper>{children}</CoreWorkspaceAuthWrapper>
);
