import { useMemo, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { Popover } from "@headlessui/react";

type Props = {
  groups: string[];
  selectedGroup: string;
  onChange: (group: string) => void;
  isLoading: boolean;
  hasError: boolean;
  onRetry: () => void;
  disabled: boolean;
};

export const CreateCardPositionGroupPicker = ({
  groups,
  selectedGroup,
  onChange,
  isLoading,
  hasError,
  onRetry,
  disabled,
}: Props) => {
  const [query, setQuery] = useState("");
  const filteredGroups = useMemo(() => {
    const search = query.trim().toLowerCase();
    return groups.filter((group) => group.toLowerCase().includes(search));
  }, [groups, query]);
  const selectedCount = selectedGroup ? 1 : 0;

  return (
    <section className="relative z-20">
      <Popover>
        {({ close, open }) => (
          <>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm text-custom-text-200">Position Group</span>
                <span className="text-[11px] text-custom-text-300">select one group to share at once</span>
              </div>
              <span className="text-[11px] text-custom-text-300">{selectedCount} selected</span>
            </div>
            <div className="relative">
              <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-custom-border-300 bg-custom-background-90 p-2 focus-within:border-custom-primary-100">
                {selectedGroup && (
                  <span className="inline-flex max-w-full items-center gap-2 rounded-md border border-custom-border-300 bg-custom-background-80 px-2 py-1 text-xs text-custom-text-100">
                    <span className="truncate">{selectedGroup}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${selectedGroup} position group`}
                      onClick={() => onChange("")}
                      disabled={disabled}
                      className="shrink-0 rounded text-custom-text-300 hover:text-custom-text-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-custom-primary-100 disabled:opacity-40"
                    >
                      <X aria-hidden="true" className="h-3 w-3" />
                    </button>
                  </span>
                )}
                <Popover.Button
                  disabled={disabled || isLoading || hasError || groups.length === 0}
                  aria-label={open ? "Hide position groups" : "Show position groups"}
                  aria-describedby="create-card-position-group-status"
                  className="flex min-w-8 flex-1 items-center justify-end gap-2 rounded p-1 text-xs text-custom-text-300 focus-visible:ring-1 focus-visible:ring-custom-primary-100 disabled:opacity-40"
                >
                  {!selectedGroup && (
                    <span className="flex-1 text-left">
                      {isLoading ? "Loading position groups…" : "Select a group…"}
                    </span>
                  )}
                  <ChevronDown
                    aria-hidden="true"
                    className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
                  />
                </Popover.Button>
              </div>
              <Popover.Panel className="absolute left-0 right-0 top-full z-50 mt-1.5 overflow-hidden rounded-lg border border-custom-border-300 bg-custom-background-100 shadow-xl ring-1 ring-black/20">
                <div className="m-2 flex items-center gap-2 rounded-md border border-custom-border-300 bg-custom-background-90 px-2">
                  <Search aria-hidden="true" className="h-3.5 w-3.5 text-custom-text-300" />
                  <input
                    type="search"
                    aria-label="Search position groups"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search"
                    disabled={disabled}
                    className="min-w-0 flex-1 bg-transparent py-2 text-xs text-custom-text-100 outline-none placeholder:text-custom-text-300"
                  />
                </div>
                <div
                  role="group"
                  aria-label="Position groups"
                  className="vertical-scrollbar scrollbar-sm max-h-56 overflow-y-auto overscroll-contain px-2 pb-2"
                >
                  {filteredGroups.length ? (
                    filteredGroups.map((group) => (
                      <label
                        key={group}
                        className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1.5 text-xs text-custom-text-100 hover:bg-custom-background-80"
                      >
                        <input
                          type="checkbox"
                          checked={selectedGroup === group}
                          disabled={disabled || isLoading || hasError}
                          onChange={() => onChange(selectedGroup === group ? "" : group)}
                          className="h-3.5 w-3.5 shrink-0 rounded border-custom-border-300 bg-custom-background-90 accent-custom-primary-100"
                        />
                        <span className="min-w-0 flex-1 truncate" title={group}>
                          {group}
                        </span>
                      </label>
                    ))
                  ) : (
                    <p className="px-2 py-3 text-xs text-custom-text-300">No matching position groups.</p>
                  )}
                </div>
                <div className="flex items-center justify-between border-t border-custom-border-200 px-3 py-2 text-[11px]">
                  <span aria-live="polite" className="text-custom-text-300">
                    {selectedCount} of {groups.length} selected
                  </span>
                  <span className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => onChange("")}
                      disabled={disabled || !selectedGroup}
                      className="text-custom-primary-100 hover:underline disabled:opacity-40"
                    >
                      Clear all
                    </button>
                    <button type="button" onClick={() => close()} className="text-custom-primary-100 hover:underline">
                      Done
                    </button>
                  </span>
                </div>
              </Popover.Panel>
            </div>
          </>
        )}
      </Popover>
      <p id="create-card-position-group-status" role="status" className="mt-1 text-xs text-custom-text-300">
        {hasError ? (
          <>
            Unable to load the roster.{" "}
            <button type="button" onClick={onRetry} className="text-custom-primary-100 hover:underline">
              Retry
            </button>
          </>
        ) : isLoading ? (
          "Loading position groups…"
        ) : groups.length === 0 ? (
          "No position groups are available in this roster."
        ) : null}
      </p>
    </section>
  );
};
