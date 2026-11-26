"use client";

import { useState } from "react";
import useSWR from "swr";
import { ChevronLeft, ChevronRight, Pencil, Plus } from "lucide-react";
import { Button } from "@plane/propel/button";
import { EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
import type { DelegatedPlayer } from "@/services/team-season.service";
import { TeamSeasonService, teamSeasonError } from "@/services/team-season.service";

const service = new TeamSeasonService();
const fieldClass = "w-full rounded-md border border-custom-border-200 bg-custom-background-100 px-2 py-1.5 text-sm";

export function DelegatedRosterEditor({
  slug,
  project,
  onChange,
}: {
  slug: string;
  project: string;
  onChange: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<DelegatedPlayer | "new">();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const roster = useSWR(
    ["delegated-roster", slug, project, page],
    () => service.delegatedPlayers(slug, project, page),
    { shouldRetryOnError: false }
  );
  const player = editing === "new" ? undefined : editing;
  if (!open && !roster.data) return null;
  const choose = (value: DelegatedPlayer | "new" | undefined) => {
    setError("");
    setEditing(value);
  };

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="neutral-primary"
        onClick={() => {
          setOpen(true);
          void roster.mutate();
        }}
      >
        Edit roster
      </Button>
      <ModalCore
        isOpen={open}
        handleClose={() => {
          if (!busy) {
            setOpen(false);
            choose(undefined);
          }
        }}
        position={EModalPosition.TOP}
        width={EModalWidth.LG}
      >
        <div className="max-h-[65vh] space-y-3 overflow-y-auto p-5">
          <h2 className="text-lg font-semibold">Edit season roster</h2>
          {roster.error && (
            <p role="alert" className="text-sm text-red-500">
              {teamSeasonError(roster.error)}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-red-500">
              {error}
            </p>
          )}
          {editing && !roster.error ? (
            <form
              key={player?.id ?? "new"}
              className="space-y-3"
              onSubmit={async (event) => {
                event.preventDefault();
                if (busy) return;
                setBusy(true);
                setError("");
                const fields = Object.fromEntries(new FormData(event.currentTarget));
                try {
                  await service.saveDelegatedPlayer(slug, project, fields, player);
                  choose(undefined);
                  await Promise.all([roster.mutate(), onChange()]);
                } catch (error) {
                  setError(teamSeasonError(error));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label className="block text-sm">
                Player name
                <input
                  className={fieldClass}
                  name="player_name"
                  defaultValue={player?.player_name}
                  required
                  maxLength={255}
                  disabled={busy}
                />
              </label>
              <div className="grid gap-2 sm:grid-cols-3">
                <label className="text-sm">
                  Jersey
                  <input
                    className={fieldClass}
                    name="jersey_number"
                    defaultValue={player?.jersey_number ?? ""}
                    maxLength={20}
                    disabled={busy}
                  />
                </label>
                <label className="text-sm">
                  Position
                  <input
                    className={fieldClass}
                    name="position"
                    defaultValue={player?.position ?? ""}
                    maxLength={50}
                    disabled={busy}
                  />
                </label>
                <label className="text-sm">
                  Grad year / class
                  <input
                    className={fieldClass}
                    name="class_year"
                    defaultValue={player?.class_year ?? ""}
                    maxLength={50}
                    disabled={busy}
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" size="sm" disabled={busy}>
                  Save player
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="neutral-primary"
                  disabled={busy}
                  onClick={() => {
                    choose(undefined);
                    void roster.mutate();
                  }}
                >
                  Back to roster
                </Button>
              </div>
            </form>
          ) : (
            !roster.error && (
              <>
                {roster.isLoading && (
                  <p role="status" className="text-sm">
                    Loading roster…
                  </p>
                )}
                {roster.data?.results.length === 0 && (
                  <p className="text-sm text-custom-text-300">No active players.</p>
                )}
                <ul className="divide-y divide-custom-border-200">
                  {roster.data?.results.map((row) => (
                    <li key={row.id} className="flex items-center gap-2 py-2 text-sm">
                      <span className="min-w-0 flex-1 break-words">
                        {row.player_name}
                        {row.jersey_number ? ` · #${row.jersey_number}` : ""}
                      </span>
                      <button
                        type="button"
                        title="Edit player"
                        aria-label={`Edit ${row.player_name}`}
                        onClick={() => choose(row)}
                        className="p-2"
                      >
                        <Pencil size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
                {roster.data && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" size="sm" prependIcon={<Plus size={16} />} onClick={() => choose("new")}>
                      Add player
                    </Button>
                    {roster.data.previous && (
                      <button
                        type="button"
                        title="Previous page"
                        aria-label="Previous page"
                        onClick={() => setPage(page - 1)}
                        className="p-2"
                      >
                        <ChevronLeft size={16} />
                      </button>
                    )}
                    {roster.data.next && (
                      <button
                        type="button"
                        title="Next page"
                        aria-label="Next page"
                        onClick={() => setPage(page + 1)}
                        className="p-2"
                      >
                        <ChevronRight size={16} />
                      </button>
                    )}
                  </div>
                )}
              </>
            )
          )}
        </div>
        <div className="flex justify-end border-t border-custom-border-200 p-4">
          <Button
            type="button"
            size="sm"
            variant="neutral-primary"
            disabled={busy}
            onClick={() => {
              setOpen(false);
              choose(undefined);
            }}
          >
            Close
          </Button>
        </div>
      </ModalCore>
    </>
  );
}
