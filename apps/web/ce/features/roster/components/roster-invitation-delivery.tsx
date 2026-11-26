"use client";

import { useState } from "react";
import { Mail, RefreshCw } from "lucide-react";
import { beginRosterUI, rosterUIFailure } from "@plane/logger/diagnostics-browser";
import type { IRosterPlayer } from "@plane/types";
import { Button } from "@plane/ui";
import { RosterService } from "@/services/roster.service";
import { useRoster } from "../store/roster-context";
import { invitationDeliveryLabels } from "../utils/roster.utils";

const service = new RosterService();

export const RosterInvitationDelivery = ({ player }: { player: IRosterPlayer }) => {
  const { workspaceSlug, projectId, canManage, refetchRoster } = useRoster();
  const [busy, setBusy] = useState<"refresh" | "resend" | null>(null);
  const [error, setError] = useState(false);
  const delivery = player.invitation_delivery;
  if (!canManage || !delivery) return null;

  const update = async (action: "refresh" | "resend") => {
    setBusy(action);
    setError(false);
    const span = action === "resend" ? beginRosterUI("invitation-retry") : null;
    try {
      if (span) await service.resendPlayerInvitation(workspaceSlug, projectId, player.id, span.headers);
      await refetchRoster();
      span?.finish("confirmed");
    } catch (failure) {
      span?.finish(rosterUIFailure(failure));
      setError(true);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="space-y-2 border-t border-custom-border-200 pt-5">
      <h3 className="text-xs font-medium text-custom-text-300">Invitation email</h3>
      <p className="text-xs text-custom-text-100" role="status">
        {invitationDeliveryLabels[delivery.status]}
      </p>
      {delivery.status === "accepted" && (
        <p className="text-xs text-custom-text-300">Inbox delivery is not confirmed.</p>
      )}
      {(delivery.status === "failed" || delivery.status === "unconfirmed") && (
        <p className="text-xs text-custom-text-300">You can also share the team join link from the roster toolbar.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="neutral-primary"
          prependIcon={<Mail />}
          disabled={busy !== null || delivery.retry_after !== null}
          loading={busy === "resend"}
          onClick={() => void update("resend")}
        >
          Resend invitation
        </Button>
        <Button
          size="sm"
          variant="neutral-primary"
          prependIcon={<RefreshCw />}
          disabled={busy !== null}
          loading={busy === "refresh"}
          onClick={() => void update("refresh")}
        >
          Refresh status
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-500">
          Could not resend. Refresh the status before trying again.
        </p>
      )}
    </section>
  );
};
