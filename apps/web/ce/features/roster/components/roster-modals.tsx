"use client";

import { observer } from "mobx-react";

import { AlertModalCore } from "@plane/ui";
import { useRoster } from "../store/roster-context";
import { isPendingPlayer } from "../utils/roster-presentation";
import { canDeleteRosterPlayer } from "../utils/roster.utils";

export const DeletePlayerModal = observer(() => {
  const { deletingPlayer, canManage, isSubmitting, closeDeletePlayerModal, deletePlayer } = useRoster();
  if (!deletingPlayer || !canManage || !canDeleteRosterPlayer(deletingPlayer)) return null;

  return (
    <AlertModalCore
      isOpen
      title={isPendingPlayer(deletingPlayer) ? "Decline join request" : "Remove from roster"}
      primaryButtonText={{
        default: isPendingPlayer(deletingPlayer) ? "Decline request" : "Remove from roster",
        loading: isPendingPlayer(deletingPlayer) ? "Declining" : "Removing",
      }}
      isSubmitting={isSubmitting}
      handleClose={() => {
        if (!isSubmitting) closeDeletePlayerModal();
      }}
      handleSubmit={() => void deletePlayer()}
      content={
        isPendingPlayer(deletingPlayer) ? (
          <>
            Decline the join request from{" "}
            <span className="font-medium text-custom-text-100">{deletingPlayer.player_name}</span>? Their account
            remains and no team access will be granted.{" "}
            {deletingPlayer.status === "pending"
              ? "This new pending roster entry will be removed."
              : "The existing roster entry, email, jersey number and tagging history will remain unchanged."}
          </>
        ) : (
          <>
            Remove <span className="font-medium text-custom-text-100">{deletingPlayer.player_name}</span> from this
            program&apos;s roster? Their account and historical coaching cards, including playback, will remain. They
            will lose access to team film and playlists. Their jersey number will be freed.
          </>
        )
      }
    />
  );
});

export const DeleteAccountModal = observer(() => {
  const { accountDeletionTarget, canDeleteAccounts, isSubmitting, closeDeleteAccountModal, deleteAccount } =
    useRoster();
  if (!accountDeletionTarget || !canDeleteAccounts) return null;
  return (
    <AlertModalCore
      isOpen
      title="Permanently delete account"
      primaryButtonText={{ default: "Delete account", loading: "Deleting account" }}
      isSubmitting={isSubmitting}
      handleClose={() => {
        if (!isSubmitting) closeDeleteAccountModal();
      }}
      handleSubmit={() => void deleteAccount()}
      content={
        <>
          Permanently delete the account for{" "}
          <span className="font-medium text-custom-text-100">{accountDeletionTarget.player_name}</span>? This globally
          removes their login, profile photo, memberships, and their own coaching cards across all teams. Cards shared
          with other players remain for those players. This cannot be undone.
        </>
      }
    />
  );
});

export { AddPlayerModal } from "./roster-add-player-modal";
export { ImportRosterModal } from "./roster-import-modal";
