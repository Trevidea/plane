import { EUserPermissions } from "@plane/constants";

type TLeadMembership = { role: number; is_active?: boolean };

export const isProgramLeadCandidate = (
  workspaceMember: TLeadMembership | null | undefined,
  projectMember?: TLeadMembership | null
) =>
  Boolean(
    workspaceMember &&
    workspaceMember.is_active !== false &&
    workspaceMember.role !== EUserPermissions.USER &&
    (!projectMember || (projectMember.is_active !== false && projectMember.role !== EUserPermissions.USER))
  );
