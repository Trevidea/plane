"use client";

import { ArrowRight, Clock3, Info, UserCheck } from "lucide-react";
import { Avatar, Button } from "@plane/ui";
import { useRoster } from "../store/roster-context";
import { formatTimestamp, getRosterDisplayEmail } from "../utils/roster.utils";
import { RosterApprovalButton } from "./roster-approval-button";

export const RosterJoinRequests = () => {
  const { players, isLoading, refetchRoster, openDeletePlayerModal } = useRoster();
  return (
    <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
      <div className="flex items-start gap-2 rounded-lg border border-custom-border-200 bg-custom-background-90 p-3 text-xs leading-5 text-custom-text-300">
        <Info className="mt-0.5 size-4 shrink-0 text-custom-primary-100" />
        <p>
          Review each player’s registration details before approving. Approval links their account and gives them access
          to this program.
        </p>
      </div>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-custom-text-100">Pending join requests</h2>
        <Button variant="neutral-primary" size="sm" onClick={() => void refetchRoster()} disabled={isLoading}>
          Refresh
        </Button>
      </div>
      {isLoading ? (
        <p role="status" className="p-8 text-center text-sm text-custom-text-300">
          Loading requests…
        </p>
      ) : players.length ? (
        players.map((player) => (
          <article
            key={player.id}
            className="grid items-center gap-4 rounded-lg border border-custom-border-200 bg-custom-background-100 p-4 md:grid-cols-[1fr_auto_1fr_auto]"
          >
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-custom-text-400">Registration</p>
              <div className="flex items-center gap-3">
                <Avatar name={player.player_name} size={36} showTooltip={false} />
                <div className="min-w-0">
                  <h3 className="text-sm font-medium text-custom-text-100">
                    {player.registration_name || player.player_name}
                  </h3>
                  <p className="break-all text-xs text-custom-text-300">
                    {player.registration_email || getRosterDisplayEmail(player) || "Email not provided"}
                  </p>
                  <p className="mt-1 text-xs text-custom-text-400">Submitted {formatTimestamp(player.created_at)}</p>
                </div>
              </div>
            </div>
            <ArrowRight className="hidden size-4 text-custom-text-400 md:block" />
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-custom-text-400">
                Roster details
              </p>
              <p className="text-sm text-custom-text-100">{player.player_name}</p>
              <p className="mt-1 text-xs text-custom-text-300">
                {[player.jersey_number && `#${player.jersey_number}`, player.position, player.class_year]
                  .filter(Boolean)
                  .join(" · ") || "No additional details provided"}
              </p>
              <span className="mt-2 inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                <Clock3 className="size-3" />
                Awaiting approval
              </span>
            </div>
            <div className="flex gap-2 md:flex-col">
              <RosterApprovalButton player={player} />
              <Button variant="neutral-primary" size="sm" onClick={() => openDeletePlayerModal(player)}>
                Decline
              </Button>
            </div>
          </article>
        ))
      ) : (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <UserCheck className="mb-2 size-7 text-custom-text-400" />
          <h3 className="text-sm font-medium text-custom-text-100">No join requests waiting</h3>
          <p className="max-w-sm text-xs leading-5 text-custom-text-300">
            New player registrations appear here. Share your team join link to get started.
          </p>
        </div>
      )}
    </div>
  );
};
