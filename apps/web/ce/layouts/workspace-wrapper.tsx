import { useEffect } from "react";
import type { FC } from "react";
import { observer } from "mobx-react";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { LogoSpinner } from "@/components/common/logo-spinner";
// layouts
import { useUser } from "@/hooks/store/user";
import { WorkspaceAuthWrapper as CoreWorkspaceAuthWrapper } from "@/layouts/auth-layout/workspace-wrapper";
import { playerActivityService } from "@/services/player-activity.service";

export type IWorkspaceAuthWrapper = {
  children: React.ReactNode;
};

export const WorkspaceAuthWrapper: FC<IWorkspaceAuthWrapper> = observer((props) => {
  // props
  const { children } = props;
  const { workspaceSlug } = useParams();
  const router = useRouter();
  const { data: user } = useUser();
  const role = useSWR(user?.id ? ["PLAYER_ROLE", user.id] : null, () => playerActivityService.role());
  const restricted =
    role.data?.workspaces.includes(String(workspaceSlug)) ||
    role.data?.project_workspaces.includes(String(workspaceSlug));
  useEffect(() => {
    if (restricted) router.replace("/player");
  }, [restricted, router]);
  if (role.isLoading || restricted) return <LogoSpinner />;
  if (role.error)
    return (
      <div role="alert">
        Unable to check your program access. <button onClick={() => void role.mutate()}>Retry</button>
      </div>
    );

  return <CoreWorkspaceAuthWrapper>{children}</CoreWorkspaceAuthWrapper>;
});
