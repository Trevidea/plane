"use client";

import { useState } from "react";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { IRosterPlayer } from "@plane/types";
import { Button } from "@plane/ui";
import { useUserPermissions } from "@/hooks/store/user";
import { RosterService } from "@/services/roster.service";
import { useRoster } from "../store/roster-context";

const service = new RosterService();

export const RosterApprovalButton = ({ player }: { player: IRosterPlayer }) => {
  const { workspaceSlug, projectId, canManage, refetchRoster } = useRoster();
  const { allowPermissions } = useUserPermissions();
  const [busy, setBusy] = useState(false);
  const allowed =
    canManage &&
    allowPermissions([EUserPermissions.ADMIN, EUserPermissions.MEMBER], EUserPermissionsLevel.WORKSPACE, workspaceSlug);
  if (!allowed || player.registration_status !== "pending") return null;
  return (
    <Button
      size="sm"
      variant="primary"
      loading={busy}
      disabled={busy}
      aria-label={`Approve ${player.player_name}`}
      onClick={() => {
        if (busy) return;
        setBusy(true);
        void service
          .approvePlayer(workspaceSlug, projectId, player.id)
          .then(async () => {
            await refetchRoster();
            setToast({
              type: TOAST_TYPE.SUCCESS,
              title: "Athlete approved",
              message: "Program and workspace memberships are linked.",
            });
          })
          .catch(() =>
            setToast({
              type: TOAST_TYPE.ERROR,
              title: "Approval failed",
              message: "Refresh the roster and check the athlete's memberships before trying again.",
            })
          )
          .finally(() => setBusy(false));
      }}
    >
      Approve
    </Button>
  );
};
