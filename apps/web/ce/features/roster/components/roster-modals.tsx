"use client";

import { useState } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
import { Trash2 } from "lucide-react";

import { Button } from "@plane/propel/button";
import { AlertModalCore, EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
import { RosterService } from "@/services/roster.service";
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

const rosterService = new RosterService();

function AccountDeletionPreview({ id, name }: { id: string; name: string }) {
  const { workspaceSlug, projectId, isSubmitting, closeDeleteAccountModal, deleteAccount } = useRoster();
  const [reviewed, setReviewed] = useState<string | null>(null);
  const preview = useSWR(
    ["roster-delete-preview", workspaceSlug, projectId, id],
    () => rosterService.previewPlayerAccountDeletion(workspaceSlug, projectId, id),
    { shouldRetryOnError: false, dedupingInterval: 0, revalidateOnFocus: false }
  );
  const result = preview.data;
  const impact = result?.impact;
  const acknowledged = Boolean(result?.confirmation && result.confirmation === reviewed);
  const canConfirm = Boolean(
    result?.enabled && result.confirmation && acknowledged && !preview.isValidating && !preview.error
  );
  const close = () => {
    if (!isSubmitting) closeDeleteAccountModal();
  };
  return (
    <ModalCore isOpen handleClose={close} position={EModalPosition.TOP} width={EModalWidth.LG}>
      <div className="max-h-[68vh] space-y-4 overflow-y-auto p-5">
        <div>
          <h2 className="text-lg font-semibold">Account deletion preview</h2>
          <p className="break-words text-sm text-custom-text-300">{name}</p>
        </div>
        {preview.isValidating && (
          <p role="status" className="text-sm">
            Checking account impact…
          </p>
        )}
        {preview.error && (
          <p role="alert" className="text-sm text-red-500">
            {typeof preview.error.response?.data?.detail === "string"
              ? preview.error.response.data.detail
              : "The deletion preview could not be loaded."}
          </p>
        )}
        {!preview.error && impact && (
          <>
            <section className="space-y-2 border-t border-custom-border-200 pt-3">
              <h3 className="text-sm font-semibold">Removed or revoked</h3>
              <p className="text-sm text-custom-text-300">
                Login and sessions, profile images, memberships and personal coaching cards.
              </p>
              <dl className="grid grid-cols-[1fr_auto] gap-2 text-sm">
                {[
                  ["Workspace memberships", impact.workspace_memberships],
                  ["Program memberships", impact.program_memberships],
                  ["Personal coaching cards", impact.personal_cards],
                  ["Profile image files", impact.profile_images],
                  ["Private messages", impact.private_messages],
                  ["Private attachments", impact.private_attachments],
                  ["Activity progress records", impact.activity_progress],
                  ["Join records", impact.join_records],
                  ["Roster notices", impact.roster_notices ?? 0],
                ].map(([label, value]) => (
                  <div className="contents" key={label}>
                    <dt>{label}</dt>
                    <dd className="text-right tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
              {impact.legacy_profile_image && (
                <p className="text-xs text-custom-text-300">The account also has a legacy profile image link.</p>
              )}
            </section>
            <section className="space-y-2 border-t border-custom-border-200 pt-3">
              <h3 className="text-sm font-semibold">Kept</h3>
              <p className="text-sm text-custom-text-300">
                Shared cards stay available to their other recipients. Team film, tags, and historical roster identities
                are kept.
              </p>
              <dl className="grid grid-cols-[1fr_auto] gap-2 text-sm">
                <dt>Shared cards kept</dt>
                <dd className="text-right tabular-nums">{impact.shared_cards}</dd>
                <dt>Roster entries anonymized</dt>
                <dd className="text-right tabular-nums">{impact.roster_entries}</dd>
              </dl>
            </section>
            {result?.enabled ? (
              <label className="flex items-start gap-2 border-t border-custom-border-200 pt-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={acknowledged}
                  disabled={isSubmitting || preview.isValidating}
                  onChange={(event) => setReviewed(event.target.checked ? (result.confirmation ?? null) : null)}
                />{" "}
                I reviewed the impact. Permanent deletion cannot be undone.
              </label>
            ) : (
              <p role="status" className="border-t border-custom-border-200 pt-3 text-sm font-medium">
                Permanent deletion is disabled.
              </p>
            )}
          </>
        )}
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-custom-border-200 p-4">
        <Button type="button" size="sm" variant="neutral-primary" disabled={isSubmitting} onClick={close}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          variant="neutral-primary"
          disabled={isSubmitting || preview.isValidating}
          onClick={() => {
            setReviewed(null);
            void preview.mutate();
          }}
        >
          Refresh preview
        </Button>
        {result?.enabled && (
          <Button
            type="button"
            size="sm"
            variant="danger"
            prependIcon={<Trash2 size={15} />}
            disabled={!canConfirm || isSubmitting}
            onClick={async () => {
              if (canConfirm && result.confirmation && !(await deleteAccount(result.confirmation))) {
                setReviewed(null);
                void preview.mutate();
              }
            }}
          >
            Delete account
          </Button>
        )}
      </div>
    </ModalCore>
  );
}

export const DeleteAccountModal = observer(() => {
  const { accountDeletionTarget, canPreviewAccounts } = useRoster();
  if (!accountDeletionTarget || !canPreviewAccounts) return null;
  return (
    <AccountDeletionPreview
      key={accountDeletionTarget.id}
      id={accountDeletionTarget.id}
      name={accountDeletionTarget.player_name}
    />
  );
});

export { AddPlayerModal } from "./roster-add-player-modal";
export { ImportRosterModal } from "./roster-import-modal";
