"use client";

import { useState } from "react";
import { observer } from "mobx-react";
import { Link2Off } from "lucide-react";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { Button } from "@plane/propel/button";
import { EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
import { useUserPermissions } from "@/hooks/store/user";
import { RosterService } from "@/services/roster.service";
import type { RosterCorrectionTarget } from "@/services/team-season.service";
import { TeamSeasonService, teamSeasonError } from "@/services/team-season.service";
import { useRoster } from "../store/roster-context";

const service = new TeamSeasonService();
const rosterService = new RosterService();

export const RosterAccountCorrection = observer(
  ({ player: rosterPlayer, historyId }: { player?: RosterCorrectionTarget; historyId?: string }) => {
    const { workspaceSlug, projectId, canManage, refetchRoster, refetchEvents } = useRoster();
    const { allowPermissions } = useUserPermissions();
    const [open, setOpen] = useState(false);
    const [choice, setChoice] = useState("");
    const [results, setResults] = useState<Awaited<ReturnType<RosterService["findReturningAccounts"]>>>();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [historicalTarget, setHistoricalTarget] = useState<RosterCorrectionTarget>();
    const player = rosterPlayer ?? historicalTarget;
    const admin = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.WORKSPACE, workspaceSlug);
    if (!canManage || !admin || (!rosterPlayer?.user && !historyId)) return null;
    const lookupAllowed = !historyId && !!player && ["active", "injured"].includes(player.status);

    const begin = async () => {
      setChoice("");
      setResults(undefined);
      setError("");
      setHistoricalTarget(undefined);
      setOpen(true);
      if (!historyId) return;
      setBusy(true);
      try {
        setHistoricalTarget(await service.getCorrectionTarget(workspaceSlug, projectId, historyId));
      } catch (error) {
        setError(teamSeasonError(error));
      } finally {
        setBusy(false);
      }
    };

    const close = () => {
      if (!busy) setOpen(false);
    };
    const checkMatches = async () => {
      if (busy || !lookupAllowed || !player?.class_year) return;
      setError("");
      setBusy(true);
      setChoice("");
      setResults(undefined);
      try {
        setResults(
          await rosterService.findReturningAccounts(workspaceSlug, projectId, player.player_name, player.class_year)
        );
      } catch (error) {
        setError(teamSeasonError(error));
      } finally {
        setBusy(false);
      }
    };
    const confirm = async () => {
      if (!player?.user || !choice || busy) return;
      setError("");
      setBusy(true);
      try {
        await service.correctAccount(
          workspaceSlug,
          projectId,
          player.id,
          player.user,
          choice === "unlink" ? null : choice
        );
        setOpen(false);
        await Promise.all([refetchRoster(), refetchEvents()]);
      } catch (error) {
        setError(teamSeasonError(error));
      } finally {
        setBusy(false);
      }
    };

    return (
      <>
        <Button
          type="button"
          size="sm"
          variant="neutral-primary"
          prependIcon={<Link2Off size={16} />}
          onClick={() => void begin()}
        >
          {historyId ? "Revoke mistaken access" : "Correct account link"}
        </Button>
        <ModalCore isOpen={open} handleClose={close} position={EModalPosition.TOP} width={EModalWidth.LG}>
          <div className="space-y-3 p-5">
            <h2 className="text-lg font-semibold">Correct account link</h2>
            {!player && busy && (
              <p role="status" className="text-sm">
                Checking linked account…
              </p>
            )}
            {player && (
              <>
                <p className="text-sm text-custom-text-300">
                  {player.player_name} · {player.account_email || "Linked account"}
                </p>
                <p className="text-sm text-custom-text-300">
                  This removes the wrong account’s player access to this program and clears its roster contact email. It
                  does not delete either account or send an invitation. If there is history, removing the link holds
                  this roster identity for review and prevents new claims. Cards, tags, and activity stay where they
                  are.
                </p>
                <fieldset className="space-y-2 text-sm" disabled={busy}>
                  <legend className="mb-2 font-medium">Correct this link</legend>
                  <label className="flex items-start gap-2">
                    <input
                      type="radio"
                      name={`correct-${player.id}`}
                      checked={choice === "unlink"}
                      onChange={() => setChoice("unlink")}
                    />{" "}
                    Revoke access and leave unlinked
                  </label>
                  {results?.results.map((account) => (
                    <label className="flex items-start gap-2" key={account.id}>
                      <input
                        type="radio"
                        name={`correct-${player.id}`}
                        checked={choice === account.id}
                        onChange={() => setChoice(account.id)}
                      />
                      <span className="min-w-0 break-all">{account.email}</span>
                    </label>
                  ))}
                </fieldset>
                {lookupAllowed && (
                  <Button
                    type="button"
                    size="sm"
                    variant="neutral-primary"
                    disabled={busy || !/^\d{4}$/.test(player.class_year?.trim() || "")}
                    onClick={() => void checkMatches()}
                  >
                    Find returning accounts
                  </Button>
                )}
                {results && results.results.length === 0 && (
                  <p role="status" className="text-sm">
                    No matching accounts.
                  </p>
                )}
                {results?.has_more && (
                  <p role="status" className="text-sm">
                    Not all matches are shown.
                  </p>
                )}
              </>
            )}
            {error && (
              <p role="alert" className="text-sm text-red-500">
                {error}
              </p>
            )}
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-t border-custom-border-200 p-4">
            <Button type="button" size="sm" variant="neutral-primary" disabled={busy} onClick={close}>
              Cancel
            </Button>
            <Button type="button" size="sm" disabled={!choice || busy} onClick={() => void confirm()}>
              Confirm correction
            </Button>
          </div>
        </ModalCore>
      </>
    );
  }
);
