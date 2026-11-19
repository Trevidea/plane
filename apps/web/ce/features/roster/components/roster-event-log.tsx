"use client";

import { observer } from "mobx-react";
import { useRoster } from "../store/roster-context";
import { formatTimestamp, toDisplayStatus } from "../utils/roster.utils";

export const RosterEventLog = observer(() => {
  const { canManage, events, eventsError, isLoadingEvents, refetchEvents, canDeleteAccounts, openDeleteAccountModal } =
    useRoster();
  if (!canManage) return null;
  if (isLoadingEvents)
    return (
      <p className="p-6 text-sm text-custom-text-300" role="status">
        Loading event log…
      </p>
    );
  if (eventsError)
    return (
      <div className="p-6 text-sm" role="alert">
        <p>{eventsError}</p>
        <button type="button" className="mt-2 text-custom-primary-100" onClick={() => void refetchEvents()}>
          Retry
        </button>
      </div>
    );
  return (
    <div className="overflow-auto p-6">
      <p className="mb-4 text-sm text-custom-text-300">
        Recent 100 roster events. Player names and jersey numbers reflect the event at that time.
      </p>
      {events.length === 0 ? (
        <p className="text-sm text-custom-text-300">No roster events yet.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-custom-border-200 text-custom-text-300">
              {["Player", "Jersey #", "Action", "Status change", "Date", "Changed by", "Account"].map((label) => (
                <th className="p-3 font-medium" key={label}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id} className="border-b border-custom-border-200">
                <td className="p-3">{event.player_name || "Former player"}</td>
                <td className="p-3">{event.jersey_number || "—"}</td>
                <td className="p-3">{toDisplayStatus(event.action.replace(/_/g, " "))}</td>
                <td className="p-3">
                  {event.previous_status ? `${toDisplayStatus(event.previous_status)} → ` : ""}
                  {toDisplayStatus(event.status)}
                </td>
                <td className="p-3">
                  <time dateTime={event.created_at}>{formatTimestamp(event.created_at)}</time>
                </td>
                <td className="p-3">{event.actor_name || "—"}</td>
                <td className="p-3">
                  {canDeleteAccounts && event.has_account ? (
                    <button
                      type="button"
                      className="text-red-500"
                      onClick={() =>
                        openDeleteAccountModal({ id: event.roster_identity, player_name: event.player_name })
                      }
                    >
                      Delete account
                    </button>
                  ) : event.has_account ? (
                    "Linked"
                  ) : (
                    "No linked account"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
});
