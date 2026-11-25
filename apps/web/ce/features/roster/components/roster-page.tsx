"use client";

import { useCallback, useState } from "react";
import { observer } from "mobx-react";
import { Pause, Play, Radio, RefreshCw, Trash2, X } from "lucide-react";
import { AlertModalCore, Button, cn } from "@plane/ui";
import { PageHead } from "@/components/core/page-title";
import type { TRosterTab } from "../store/roster-context";
import { useRoster } from "../store/roster-context";
import { summarizeRoster } from "../utils/roster-presentation";
import { RosterEmptyState } from "./roster-empty-state";
import { RosterEventLog } from "./roster-event-log";
import { RosterJoinRequests } from "./roster-join-requests";
import { RosterTable } from "./roster-list";
import { AddPlayerModal, DeleteAccountModal, DeletePlayerModal, ImportRosterModal } from "./roster-modals";
import { RosterPlayerDetails } from "./roster-player-details";

const ProgramRosterPage = observer(() => {
  const {
    allPlayers,
    players,
    groupedRoster,
    isLoading,
    isLoadingEvents,
    refetchRoster,
    refetchEvents,
    rosterTab,
    setRosterTab,
    canManage,
    selectedPlayerIds,
    selectedPlayers,
    setSelectedPlayerStatus,
    clearSelectedPlayers,
    isBulkDeleteModalOpen,
    openBulkDeleteModal,
    closeBulkDeleteModal,
    deleteSelectedPlayers,
    isSubmitting,
  } = useRoster();
  const [detailId, setDetailId] = useState<string | null>(null);
  const closeDetails = useCallback(() => setDetailId(null), []);
  const detailPlayer = allPlayers.find((player) => player.id === detailId);
  const summary = summarizeRoster(allPlayers);
  const tabs: { key: TRosterTab; label: string; count?: number }[] = [
    { key: "all", label: "All players", count: summary.active },
    { key: "inactive", label: "Inactive", count: summary.inactive },
    ...(canManage
      ? [
          { key: "requests" as const, label: "Join requests", count: summary.requests },
          { key: "events" as const, label: "Event log" },
        ]
      : []),
  ];
  const showEmptyState = !isLoading && allPlayers.length === 0;
  const showEventLog = rosterTab === "events" && canManage;
  const isRefreshing = showEventLog ? isLoadingEvents : isLoading;
  const refresh = showEventLog ? refetchEvents : refetchRoster;

  return (
    <>
      <PageHead title="Roster" />
      <div className="roster-surface relative flex h-full min-h-0 w-full flex-col bg-custom-background-100">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-custom-border-200 px-4 py-2 sm:px-6">
          <div className="flex items-center gap-1 overflow-x-auto" role="tablist" aria-label="Roster views">
            {tabs.map((tab, index) => (
              <Button
                key={tab.key}
                unstyled
                id={`roster-tab-${tab.key}`}
                role="tab"
                aria-label={`${tab.label}${tab.count !== undefined ? ` (${tab.count})` : ""}`}
                aria-controls="roster-view-panel"
                aria-selected={rosterTab === tab.key}
                tabIndex={rosterTab === tab.key ? 0 : -1}
                onClick={() => {
                  setRosterTab(tab.key);
                  closeDetails();
                }}
                onKeyDown={(event) => {
                  const next =
                    event.key === "ArrowRight"
                      ? (index + 1) % tabs.length
                      : event.key === "ArrowLeft"
                        ? (index - 1 + tabs.length) % tabs.length
                        : event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? tabs.length - 1
                            : -1;
                  if (next < 0) return;
                  event.preventDefault();
                  setRosterTab(tabs[next].key);
                  closeDetails();
                  document.getElementById(`roster-tab-${tabs[next].key}`)?.focus();
                }}
                className={cn(
                  "flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium text-custom-text-300 hover:bg-custom-background-90 hover:text-custom-text-100",
                  rosterTab === tab.key && "bg-custom-background-80 text-custom-text-100"
                )}
              >
                {tab.label}
                {tab.count !== undefined && (
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[11px] tabular-nums",
                      tab.key === "requests" && tab.count > 0
                        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                        : "bg-custom-background-90 text-custom-text-300"
                    )}
                  >
                    ({tab.count})
                  </span>
                )}
              </Button>
            ))}
          </div>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
            <Button
              variant="neutral-primary"
              size="sm"
              prependIcon={<RefreshCw aria-hidden="true" className={cn(isRefreshing && "motion-safe:animate-spin")} />}
              loading={isRefreshing}
              aria-busy={isRefreshing}
              onClick={() => void refresh()}
            >
              Refresh
            </Button>
            {canManage && (
              <div className="flex items-center gap-4 text-[11px] text-custom-text-300" aria-label="Account summary">
                <span>
                  <i className="mr-1.5 inline-block size-1.5 rounded-full bg-emerald-500" />
                  {summary.linked} linked
                </span>
                <span>
                  <i className="mr-1.5 inline-block size-1.5 rounded-full bg-amber-500" />
                  {summary.requests} requested
                </span>
                <span>
                  <i className="mr-1.5 inline-block size-1.5 rounded-full bg-custom-text-400" />
                  {summary.unmatched} not linked
                </span>
              </div>
            )}
          </div>
        </div>
        {/* {canManage && rosterTab === "all" && !isLoading && (
          <div className="mx-4 my-3 flex shrink-0 items-start gap-2 rounded-lg border border-custom-border-200 bg-custom-background-90 px-3 py-2.5 sm:mx-6">
            <Radio className="mt-0.5 size-4 shrink-0 text-emerald-500" />
            <p className="text-xs leading-5 text-custom-text-300">
              <strong className="font-medium text-custom-text-100">Live tagging ready.</strong> Operators can tag all{" "}
              {summary.active} active players by jersey number, with or without a linked account.
            </p>
          </div>
        )} */}
        <div
          id="roster-view-panel"
          role="tabpanel"
          aria-labelledby={`roster-tab-${rosterTab}`}
          className="flex min-h-0 flex-1 flex-col"
        >
          {showEventLog ? (
            <RosterEventLog />
          ) : rosterTab === "requests" && canManage ? (
            <RosterJoinRequests />
          ) : showEmptyState ? (
            <RosterEmptyState />
          ) : (
            <RosterTable
              players={players}
              groupedRoster={groupedRoster}
              isLoading={isLoading}
              onSelectPlayer={canManage ? (player) => setDetailId(player.id) : undefined}
            />
          )}
        </div>
        {rosterTab === "inactive" && !showEmptyState && (
          <p className="shrink-0 border-t border-custom-border-200 px-6 py-3 text-xs leading-5 text-custom-text-400">
            Inactive players keep their assigned cards. They can be made active again from their player details.
          </p>
        )}
        {canManage && selectedPlayerIds.length > 0 && (
          <div className="absolute bottom-5 left-1/2 z-20 flex max-w-[95%] -translate-x-1/2 items-center gap-3 whitespace-nowrap rounded-lg border border-custom-border-300 bg-custom-background-100 p-2 pl-4 shadow-custom-shadow-md">
            <span className="text-xs text-custom-text-200">{selectedPlayerIds.length} selected</span>
            {rosterTab !== "requests" && (
              <Button
                variant="neutral-primary"
                size="sm"
                prependIcon={rosterTab === "inactive" ? <Play /> : <Pause />}
                aria-label={rosterTab === "inactive" ? "Make selected players active" : "Set selected players inactive"}
                disabled={
                  isSubmitting ||
                  selectedPlayers.some(
                    (player) => player.status === "pending" || player.registration_status === "pending"
                  )
                }
                onClick={() => void setSelectedPlayerStatus(rosterTab === "inactive" ? "active" : "inactive")}
              >
                {rosterTab === "inactive" ? "Make active" : "Set inactive"}
              </Button>
            )}
            <Button
              variant="neutral-primary"
              size="sm"
              prependIcon={<Trash2 />}
              onClick={openBulkDeleteModal}
              disabled={isSubmitting}
            >
              Remove from roster
            </Button>
            <Button
              unstyled
              aria-label="Clear selected players"
              onClick={clearSelectedPlayers}
              className="p-1 text-custom-text-300"
            >
              <X className="size-4" />
            </Button>
          </div>
        )}
        {canManage && detailPlayer && <RosterPlayerDetails player={detailPlayer} onClose={closeDetails} />}
        <AddPlayerModal />
        <DeletePlayerModal />
        <DeleteAccountModal />
        <ImportRosterModal />
        <AlertModalCore
          isOpen={isBulkDeleteModalOpen}
          title="Remove selected players"
          primaryButtonText={{ default: "Remove from roster", loading: "Removing" }}
          isSubmitting={isSubmitting}
          handleClose={() => {
            if (!isSubmitting) closeBulkDeleteModal();
          }}
          handleSubmit={() => void deleteSelectedPlayers()}
          content={`Remove ${selectedPlayerIds.length} players from this program? Their accounts and historical coaching cards remain. They will lose access to team film and playlists.`}
        />
      </div>
    </>
  );
});

export default ProgramRosterPage;
