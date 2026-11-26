"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
  Clock3,
  GraduationCap,
  Hash,
  Link2,
  Mail,
  Maximize2,
  Minimize2,
  Pencil,
  Shirt,
  Trash2,
  X,
} from "lucide-react";
import type { IRosterPlayer } from "@plane/types";
import { Avatar, Button, cn } from "@plane/ui";
import { useRoster } from "../store/roster-context";
import { isPendingPlayer } from "../utils/roster-presentation";
import { formatTimestamp, getRosterDisplayEmail, toDisplayStatus } from "../utils/roster.utils";
import { RosterAccountCorrection } from "./roster-account-correction";
import { RosterApprovalButton } from "./roster-approval-button";
import { RosterInvitationDelivery } from "./roster-invitation-delivery";
import { RosterAccountStatusPill, RosterStatusPill } from "./roster-list";
import { RosterPasswordReset } from "./roster-password-reset";

export const RosterPlayerDetails = ({ player, onClose }: { player: IRosterPlayer; onClose: () => void }) => {
  const {
    canManage,
    isSubmitting,
    setPlayerStatus,
    openEditPlayerModal,
    openDeletePlayerModal,
    events,
    refetchEvents,
    isLoadingEvents,
    eventsError,
  } = useRoster();
  const [expanded, setExpanded] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  const pending = isPendingPlayer(player);
  const active = ["active", "injured"].includes(player.status) && !pending;
  useEffect(() => {
    void refetchEvents();
  }, [refetchEvents, player.updated_at]);
  const playerEvents = events.filter((event) => event.roster_identity === player.id);
  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    return () => {
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      // Nested Plane dialogs handle Escape themselves.
      if (event.key === "Escape" && !document.querySelector('[role="dialog"]')) onClose();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onClose]);
  const properties = [
    { icon: Hash, label: "Jersey #", value: player.jersey_number || "Not assigned" },
    { icon: Shirt, label: "Position", value: player.position || "Not set" },
    { icon: GraduationCap, label: "Grad year / class", value: player.class_year || "Not set" },
    { icon: Link2, label: "Account", value: <RosterAccountStatusPill player={player} /> },
    { icon: Mail, label: "Email", value: getRosterDisplayEmail(player) || "Not provided" },
  ];
  return (
    <aside
      aria-labelledby="roster-player-detail-title"
      className={cn(
        "absolute inset-y-0 right-0 z-20 flex w-full flex-col border-l border-custom-border-200 bg-custom-background-100 shadow-custom-shadow-md",
        expanded ? "max-w-full" : "max-w-[420px] sm:w-[420px]"
      )}
    >
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-custom-border-200 px-4">
        <span className="text-xs font-medium text-custom-text-300">Player details</span>
        <Button
          unstyled
          aria-label={expanded ? "Collapse player details" : "Expand player details"}
          onClick={() => setExpanded((value) => !value)}
          className="ml-auto mr-2 rounded p-1.5 text-custom-text-300 hover:bg-custom-background-80"
        >
          {expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </Button>
        <Button
          ref={closeButton}
          unstyled
          aria-label="Close player details"
          onClick={onClose}
          className="rounded p-1.5 text-custom-text-300 hover:bg-custom-background-80"
        >
          <X className="size-4" />
        </Button>
      </div>
      <div className="flex-1 space-y-6 overflow-y-auto p-5">
        <div className="flex items-center gap-3">
          <Avatar name={player.player_name} size={48} showTooltip={false} />
          <div className="min-w-0">
            <h2 id="roster-player-detail-title" className="break-words text-lg font-semibold text-custom-text-100">
              {player.player_name}
            </h2>
            <p className="mt-1 text-xs text-custom-text-300">
              {[player.jersey_number && `#${player.jersey_number}`, player.position, player.class_year]
                .filter(Boolean)
                .join(" · ") || "Roster player"}
            </p>
          </div>
        </div>
        <section className="space-y-3">
          <h3 className="text-xs font-medium text-custom-text-300">Status on this program</h3>
          {pending ? (
            <RosterStatusPill status="pending" />
          ) : (
            <div
              className="grid grid-cols-3 gap-1 rounded-md border border-custom-border-200 p-1"
              role="group"
              aria-label="Roster status"
            >
              {(["active", "inactive"] as const).map((status) => (
                <Button
                  key={status}
                  unstyled
                  disabled={!canManage || isSubmitting}
                  aria-pressed={status === "active" ? active : player.status === "inactive"}
                  onClick={() => void setPlayerStatus(player, status)}
                  className={cn(
                    "flex items-center justify-center gap-2 rounded px-3 py-2 text-xs capitalize text-custom-text-300 disabled:opacity-50",
                    (status === "active" ? active : player.status === "inactive") &&
                      "bg-custom-background-80 text-custom-text-100"
                  )}
                >
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      status === "active" ? "bg-emerald-500" : "bg-custom-text-400"
                    )}
                  />
                  {status}
                </Button>
              ))}
              <Button
                unstyled
                disabled={!canManage || isSubmitting}
                onClick={() => openDeletePlayerModal(player)}
                className="rounded px-3 py-2 text-xs text-red-500 hover:bg-red-500/10 disabled:opacity-50"
              >
                Removed
              </Button>
            </div>
          )}
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 text-xs">
            <dt className="text-custom-text-300">Team film and playlists</dt>
            <dd className={active ? "text-emerald-500" : "text-custom-text-400"}>{active ? "Yes" : "No"}</dd>
            <dt className="text-custom-text-300">Holds a jersey number</dt>
            <dd className={active && player.jersey_number ? "text-emerald-500" : "text-custom-text-400"}>
              {active && player.jersey_number ? `#${player.jersey_number}` : "No"}
            </dd>
            <dt className="text-custom-text-300">Own assigned coaching cards</dt>
            <dd className="text-custom-text-200">{player.user ? "Retained" : "Account not linked"}</dd>
            <dt className="text-custom-text-300">Operator’s roster</dt>
            <dd className={active ? "text-emerald-500" : "text-custom-text-400"}>{active ? "Yes" : "No"}</dd>
          </dl>
          <p className="text-xs leading-5 text-custom-text-400">
            Status changes leave historical tags, playlists and coaching cards intact.
          </p>
        </section>
        <RosterPasswordReset key={`${player.id}:${player.user}`} player={player} />
        <RosterAccountCorrection key={`correction:${player.id}:${player.user}`} player={player} />
        <section className="space-y-3 border-t border-custom-border-200 pt-5">
          <h3 className="text-xs font-medium text-custom-text-300">Properties</h3>
          <dl className="space-y-3">
            {properties.map(({ icon: Icon, label, value }) => (
              <div key={label} className="grid grid-cols-[130px_1fr] gap-2 text-xs">
                <dt className="flex items-center gap-2 text-custom-text-300">
                  <Icon className="size-3.5 text-custom-text-400" />
                  {label}
                </dt>
                <dd className="min-w-0 break-words text-custom-text-100">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
        <RosterInvitationDelivery key={player.id} player={player} />
        {player.notes && (
          <section className="space-y-2 border-t border-custom-border-200 pt-5">
            <h3 className="text-xs font-medium text-custom-text-300">Notes</h3>
            <p className="whitespace-pre-wrap break-words text-sm text-custom-text-200">{player.notes}</p>
          </section>
        )}
        <section className="space-y-3 border-t border-custom-border-200 pt-5">
          <h3 className="text-xs font-medium text-custom-text-300">Activity</h3>
          {isLoadingEvents && (
            <p role="status" className="text-xs text-custom-text-400">
              Loading activity…
            </p>
          )}
          {eventsError && (
            <p className="text-xs text-custom-text-400">
              Activity could not be loaded.{" "}
              <button type="button" onClick={() => void refetchEvents()} className="text-custom-primary-100">
                Retry
              </button>
            </p>
          )}
          {playerEvents.slice(0, 8).map((event) => (
            <div key={event.id} className="flex gap-3 text-xs">
              <Clock3 className="mt-0.5 size-4 shrink-0 text-custom-text-400" />
              <div className="space-y-1">
                <p className="text-custom-text-200">
                  {event.actor_name ? `${event.actor_name} · ` : ""}
                  {toDisplayStatus(event.action.replace(/_/g, " "))}
                </p>
                <p className="text-custom-text-400">
                  {formatTimestamp(event.created_at)}
                  {event.jersey_number ? ` · #${event.jersey_number}` : ""}
                </p>
              </div>
            </div>
          ))}
          <div className="flex gap-3 text-xs">
            <Clock3 className="mt-0.5 size-4 text-custom-text-400" />
            <div className="space-y-1">
              <p className="text-custom-text-200">Added to roster</p>
              <p className="text-custom-text-400">{formatTimestamp(player.created_at)}</p>
            </div>
          </div>
          <div className="flex gap-3 text-xs">
            <Check className="mt-0.5 size-4 text-custom-text-400" />
            <div className="space-y-1">
              <p className="text-custom-text-200">Last updated</p>
              <p className="text-custom-text-400">{formatTimestamp(player.updated_at)}</p>
            </div>
          </div>
        </section>
      </div>
      {canManage && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-custom-border-200 p-4">
          {pending ? (
            <RosterApprovalButton player={player} />
          ) : (
            <Button
              variant="neutral-primary"
              size="sm"
              prependIcon={<Pencil />}
              onClick={() => openEditPlayerModal(player)}
              disabled={isSubmitting}
            >
              Edit player
            </Button>
          )}
          <Button
            variant="neutral-primary"
            size="sm"
            className="text-red-500"
            prependIcon={<Trash2 />}
            onClick={() => openDeletePlayerModal(player)}
            disabled={isSubmitting}
          >
            Remove
          </Button>
        </div>
      )}
    </aside>
  );
};
