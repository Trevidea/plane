"use client";

import { useRef, useState } from "react";
import { Dialog } from "@headlessui/react";
import { isAxiosError } from "axios";
import { Copy, KeyRound } from "lucide-react";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { beginRosterUI, rosterUIFailure } from "@plane/logger/diagnostics-browser";
import type { IRosterPlayer } from "@plane/types";
import { Button, EModalWidth, ModalCore } from "@plane/ui";
import { useUserPermissions } from "@/hooks/store/user";
import { RosterService } from "@/services/roster.service";
import { useRoster } from "../store/roster-context";
import { isPendingPlayer } from "../utils/roster-presentation";

const service = new RosterService();

export function RosterPasswordReset({ player }: { player: IRosterPlayer }) {
  const { workspaceSlug, projectId, canManage } = useRoster();
  const { allowPermissions } = useUserPermissions();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  if (
    !canManage ||
    !player.user ||
    isPendingPlayer(player) ||
    !["active", "injured"].includes(player.status) ||
    !allowPermissions([EUserPermissions.ADMIN, EUserPermissions.MEMBER], EUserPermissionsLevel.WORKSPACE, workspaceSlug)
  )
    return null;

  const close = () => {
    if (pending.current) return;
    setCode(null);
    setCopied(false);
    setError("");
    setOpen(false);
  };
  const issue = async () => {
    if (pending.current || code || !player.user) return;
    pending.current = true;
    setBusy(true);
    setError("");
    const span = beginRosterUI("reset-issue");
    try {
      setCode(await service.issuePlayerResetCode(workspaceSlug, projectId, player.id, player.user, span.headers));
      span.finish("confirmed");
    } catch (err) {
      span.finish(rosterUIFailure(err));
      const status = isAxiosError(err) ? err.response?.status : undefined;
      setError(
        status === 403
          ? "You cannot issue a code for this account. Contact your school administrator."
          : status === 409 || status === 404
            ? "The roster changed. Refresh it before trying again."
            : status === 429
              ? "Too many requests. Wait a minute before trying again."
              : "Could not issue a reset code. Try again."
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3 border-t border-custom-border-200 pt-5">
      <h3 className="text-xs font-medium text-custom-text-300">Password</h3>
      <Button variant="neutral-primary" size="sm" prependIcon={<KeyRound />} onClick={() => setOpen(true)}>
        Reset password
      </Button>
      {open && (
        <ModalCore isOpen handleClose={close} width={EModalWidth.LG}>
          <div className="space-y-4 p-5">
            <Dialog.Title data-support-private={code ? undefined : true} className="break-words text-base font-semibold text-custom-text-100">
              {code ? "One-time reset code" : `Reset password for ${player.player_name}`}
            </Dialog.Title>
            {code ? (
              <>
                <code data-support-private className="block select-all break-all rounded border border-custom-border-200 p-3 text-lg">
                  {code.code}
                </code>
                <p className="text-sm text-custom-text-300">
                  Share it privately with the player. It expires at {new Date(code.expiresAt).toLocaleString()} and
                  cannot be shown again after closing this window.
                </p>
              </>
            ) : (
              <p className="text-sm text-custom-text-300">
                Issuing a code replaces any previous code. Once the player uses it, their current sessions are signed
                out.
              </p>
            )}
            {error && (
              <p role="alert" className="text-sm text-red-500">
                {error}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button size="sm" variant="neutral-primary" disabled={busy} onClick={close}>
                {code ? "Done" : "Cancel"}
              </Button>
              {code ? (
                <Button
                  size="sm"
                  variant="neutral-primary"
                  prependIcon={<Copy />}
                  onClick={() => {
                    void (async () => {
                      try {
                        await navigator.clipboard.writeText(code.code);
                        setCopied(true);
                        setError("");
                      } catch {
                        setError("Copy is unavailable. Select and copy the code.");
                      }
                    })();
                  }}
                >
                  {copied ? "Copied" : "Copy code"}
                </Button>
              ) : (
                <Button size="sm" variant="primary" loading={busy} disabled={busy} onClick={() => void issue()}>
                  Issue reset code
                </Button>
              )}
            </div>
          </div>
        </ModalCore>
      )}
    </section>
  );
}
