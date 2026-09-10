import { useMemo, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { Combobox } from "@headlessui/react";
import type { IRosterPlayer } from "@plane/types";
import { formatCardPlayer } from "./create-card-model";

type Props = {
  players: IRosterPlayer[];
  selectedPlayers: IRosterPlayer[];
  onChange: (ids: string[]) => void;
  isLoading: boolean;
  hasError: boolean;
  onRetry: () => void;
};

export const CreateCardRosterPicker = ({ players, selectedPlayers, onChange, isLoading, hasError, onRetry }: Props) => {
  const [query, setQuery] = useState("");
  const filteredPlayers = useMemo(() => {
    const search = query.trim().toLowerCase();
    return players.filter((player) =>
      `${formatCardPlayer(player)} ${player.position ?? ""}`.toLowerCase().includes(search)
    );
  }, [players, query]);

  return (
    <section>
      <Combobox
        as="div"
        multiple
        value={selectedPlayers.map((player) => player.id)}
        onChange={(ids: string[]) => onChange(ids)}
        disabled={isLoading || hasError || players.length === 0}
      >
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <Combobox.Label className="text-sm text-custom-text-200">Player Name</Combobox.Label>
            <span className="text-[11px] text-custom-text-300">select multiple to share at once</span>
          </div>
          <span className="text-[11px] text-custom-text-300">{selectedPlayers.length} selected</span>
        </div>
        <div className="relative">
          <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-custom-border-300 bg-custom-background-90 p-2 focus-within:border-custom-primary-100">
            {selectedPlayers.map((player) => (
              <span
                key={player.id}
                className="inline-flex max-w-full items-center gap-2 rounded-md border border-custom-border-300 bg-custom-background-80 px-2 py-1 text-xs text-custom-text-100"
              >
                <span className="truncate">{formatCardPlayer(player)}</span>
                <button
                  type="button"
                  aria-label={`Remove ${formatCardPlayer(player)}`}
                  onClick={() =>
                    onChange(
                      selectedPlayers.filter((selected) => selected.id !== player.id).map((selected) => selected.id)
                    )
                  }
                  className="shrink-0 rounded text-custom-text-300 hover:text-custom-text-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-custom-primary-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            <div className="flex min-w-28 flex-1 items-center">
              <Combobox.Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                displayValue={() => query}
                placeholder={isLoading ? "Loading roster…" : "Search roster…"}
                aria-describedby="create-card-roster-status"
                className="min-w-0 flex-1 bg-transparent py-1 text-xs text-custom-text-100 outline-none placeholder:text-custom-text-300 disabled:cursor-not-allowed"
              />
              <Combobox.Button
                aria-label="Show roster players"
                className="rounded p-1 text-custom-text-200 disabled:opacity-40"
              >
                <ChevronDown className="h-4 w-4" />
              </Combobox.Button>
            </div>
          </div>
          <Combobox.Options className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-custom-border-300 bg-custom-background-100 p-1 shadow-lg focus:outline-none">
            {filteredPlayers.length ? (
              filteredPlayers.map((player) => (
                <Combobox.Option
                  key={player.id}
                  value={player.id}
                  className={({ active }) =>
                    `flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-2 text-xs text-custom-text-100 ${active ? "bg-custom-background-80" : ""}`
                  }
                >
                  {({ selected }) => (
                    <>
                      <span>
                        {formatCardPlayer(player)} <span className="text-custom-text-300">{player.position}</span>
                      </span>
                      {selected && <Check className="h-3.5 w-3.5 shrink-0 text-custom-primary-100" />}
                    </>
                  )}
                </Combobox.Option>
              ))
            ) : (
              <li className="px-2 py-3 text-xs text-custom-text-300">No matching roster players.</li>
            )}
          </Combobox.Options>
        </div>
      </Combobox>
      <p id="create-card-roster-status" role="status" className="mt-1 text-xs text-custom-text-300">
        {hasError ? (
          <>
            Unable to load the roster.{" "}
            <button type="button" onClick={onRetry} className="text-custom-primary-100 hover:underline">
              Retry
            </button>
          </>
        ) : isLoading ? (
          "Loading roster players…"
        ) : players.length === 0 ? (
          "Add players to this program’s roster to select them here."
        ) : null}
      </p>
    </section>
  );
};
