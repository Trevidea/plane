"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
import { Search, UserCheck, X } from "lucide-react";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { Button } from "@plane/propel/button";
import type { TRosterPlayerStatus } from "@plane/types";
import {
  Button as UnstyledButton,
  CustomSelect,
  EModalPosition,
  EModalWidth,
  Input,
  ModalCore,
  TextArea,
  ToggleSwitch,
} from "@plane/ui";
import { useUserPermissions } from "@/hooks/store/user";
import { RosterService } from "@/services/roster.service";
import { STATUS_SELECT_OPTIONS } from "../constants/roster.constants";
import type { TRosterFormState } from "../store/roster-context";
import { getRosterFormState, useRoster } from "../store/roster-context";
import { findRosterJerseyConflict } from "../utils/roster-jersey";
import { getRosterDisplayEmail, toDisplayStatus } from "../utils/roster.utils";

const rosterService = new RosterService();
const Field = ({
  children,
  label,
  id,
  className = "",
}: {
  children: ReactNode;
  label: string;
  id: string;
  className?: string;
}) => (
  <div className={`space-y-2 ${className}`}>
    <label htmlFor={id} className="text-xs font-medium text-custom-text-300">
      {label}
    </label>
    {children}
  </div>
);
const inputClass = "w-full border-custom-border-200 bg-custom-background-100";

export const AddPlayerModal = observer(({ isOpen, onClose }: { isOpen?: boolean; onClose?: () => void }) => {
  const {
    editingPlayer,
    isAddPlayerModalOpen,
    isSubmitting,
    canManage,
    closePlayerModal,
    submitPlayer,
    workspaceSlug,
    projectId,
    allPlayers,
    positionOptions,
    classYearOptions,
  } = useRoster();
  const { allowPermissions } = useUserPermissions();
  const modalOpen = isOpen ?? isAddPlayerModalOpen;
  const handleClose = onClose ?? closePlayerModal;
  const [formState, setFormState] = useState<TRosterFormState>(() => getRosterFormState(editingPlayer));
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [addAnother, setAddAnother] = useState(false);
  const [matchSearch, setMatchSearch] = useState<string | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [saveError, setSaveError] = useState(false);
  const session = useRef<string | null>(null);
  const canLookup =
    canManage &&
    allowPermissions([EUserPermissions.ADMIN, EUserPermissions.MEMBER], EUserPermissionsLevel.WORKSPACE, workspaceSlug);

  useEffect(() => {
    const key = modalOpen ? (editingPlayer?.id ?? "create") : null;
    if (session.current === key) return;
    session.current = key;
    if (!modalOpen) return;
    setFormState(getRosterFormState(editingPlayer));
    setFirstName("");
    setLastName("");
    setAddAnother(false);
    setSelectedAccount(null);
    setSaveError(false);
    setMatchSearch(null);
  }, [modalOpen, editingPlayer]);

  const updateField = <K extends keyof TRosterFormState>(key: K, value: TRosterFormState[K]) => {
    setFormState((state) => ({ ...state, [key]: value }));
    setSaveError(false);
    if (key === "class_year" || key === "status") {
      setSelectedAccount(null);
      setMatchSearch(null);
    }
  };
  const fullName = editingPlayer ? formState.player_name : `${firstName.trim()} ${lastName.trim()}`.trim();
  const jerseyConflict =
    formState.status === "inactive"
      ? undefined
      : findRosterJerseyConflict(allPlayers, formState.jersey_number, editingPlayer?.id);
  const validName = editingPlayer ? Boolean(fullName.trim()) : Boolean(firstName.trim() && lastName.trim());
  const graduationYear = formState.class_year.trim();
  const searchKey = JSON.stringify([workspaceSlug, projectId, fullName, graduationYear]);
  const canSearch = canLookup && validName && /^[0-9]{4}$/.test(graduationYear) && formState.status === "active";
  const searchActive = modalOpen && !editingPlayer && canSearch && matchSearch === searchKey;
  const {
    data: matches,
    error: matchError,
    isValidating: searching,
    mutate: searchAgain,
  } = useSWR(
    searchActive ? ["roster-account-matches", workspaceSlug, projectId, fullName, graduationYear] : null,
    ([, slug, programId, name, year]) => rosterService.findReturningAccounts(slug, programId, name, year),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );
  const confirmed = matches?.results.find(({ id }) => id === selectedAccount);
  const emailConflicts = Boolean(
    confirmed && formState.email.trim() && formState.email.trim().toLowerCase() !== confirmed.email.toLowerCase()
  );
  const matchBlocked = Boolean(selectedAccount && (!confirmed || emailConflicts || matchError || searching));
  const submit = async () => {
    if (isSubmitting || !canManage || !validName || jerseyConflict || matchBlocked) return;
    setSaveError(false);
    const saved = await submitPlayer(
      { ...formState, player_name: fullName },
      { keepOpen: !editingPlayer && addAnother, existingAccountId: confirmed?.id }
    );
    if (!saved) {
      setSaveError(true);
      return;
    }
    if (!editingPlayer && addAnother) {
      setFormState(getRosterFormState());
      setFirstName("");
      setLastName("");
      setSelectedAccount(null);
      setMatchSearch(null);
      requestAnimationFrame(() => document.getElementById("roster-player-first-name")?.focus());
    }
  };
  const close = () => {
    if (!isSubmitting) handleClose();
  };

  return (
    <ModalCore isOpen={modalOpen} handleClose={close} position={EModalPosition.TOP} width={EModalWidth.XXL}>
      <div className="flex items-start justify-between gap-4 border-b border-custom-border-200 px-5 py-4">
        <div>
          <h3 className="text-lg font-semibold text-custom-text-100">{editingPlayer ? "Edit player" : "Add player"}</h3>
          <p className="mt-1 text-sm text-custom-text-300">
            {editingPlayer
              ? "Update this player's roster details."
              : "Add one player to this program. Operators can tag them as soon as you save."}
          </p>
        </div>
        <UnstyledButton
          unstyled
          type="button"
          onClick={close}
          disabled={isSubmitting}
          className="rounded-md p-1.5 text-custom-text-400 hover:bg-custom-background-90"
          aria-label="Close player modal"
        >
          <X className="size-4" />
        </UnstyledButton>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <fieldset
          disabled={isSubmitting || !canManage}
          className="grid max-h-[70vh] gap-4 overflow-y-auto p-5 sm:grid-cols-6"
        >
          {editingPlayer ? (
            <Field id="roster-player-name" label="Player name *" className="sm:col-span-6">
              <Input
                id="roster-player-name"
                name="player_name"
                required
                maxLength={255}
                value={formState.player_name}
                onChange={(event) => updateField("player_name", event.target.value)}
                className={inputClass}
                autoFocus
              />
            </Field>
          ) : (
            <>
              <Field id="roster-player-first-name" label="First name *" className="sm:col-span-3">
                <Input
                  id="roster-player-first-name"
                  name="given-name"
                  autoComplete="on"
                  required
                  maxLength={127}
                  value={firstName}
                  onChange={(event) => {
                    setFirstName(event.target.value);
                    setSelectedAccount(null);
                    setMatchSearch(null);
                  }}
                  className={inputClass}
                  autoFocus
                />
              </Field>
              <Field id="roster-player-last-name" label="Last name *" className="sm:col-span-3">
                <Input
                  id="roster-player-last-name"
                  name="family-name"
                  autoComplete="on"
                  required
                  maxLength={127}
                  value={lastName}
                  onChange={(event) => {
                    setLastName(event.target.value);
                    setSelectedAccount(null);
                    setMatchSearch(null);
                  }}
                  className={inputClass}
                />
              </Field>
            </>
          )}
          <Field id="roster-player-jersey_number" label="Jersey #" className="sm:col-span-2">
            <Input
              id="roster-player-jersey_number"
              inputMode="numeric"
              value={formState.jersey_number}
              onChange={(event) => updateField("jersey_number", event.target.value)}
              className={inputClass}
              aria-invalid={Boolean(jerseyConflict)}
              aria-describedby="roster-jersey-help"
            />
            <p
              id="roster-jersey-help"
              role={jerseyConflict ? "alert" : undefined}
              className={`text-xs ${jerseyConflict ? "text-red-500" : "text-custom-text-300"}`}
            >
              {jerseyConflict
                ? `#${formState.jersey_number.trim()} is worn by ${jerseyConflict.player_name}.`
                : formState.status === "inactive"
                  ? "Inactive players do not reserve a jersey."
                  : formState.jersey_number.trim()
                    ? "Free on this roster"
                    : "Optional"}
            </p>
          </Field>
          <Field id="roster-player-position" label="Position" className="sm:col-span-2">
            <Input
              id="roster-player-position"
              value={formState.position}
              onChange={(event) => updateField("position", event.target.value)}
              list="roster-player-positions"
              className={inputClass}
            />
            <datalist id="roster-player-positions">
              {positionOptions.map((position) => (
                <option key={position} value={position} />
              ))}
            </datalist>
          </Field>
          <Field id="roster-player-class_year" label="Grad year / class" className="sm:col-span-2">
            <Input
              id="roster-player-class_year"
              value={formState.class_year}
              onChange={(event) => updateField("class_year", event.target.value)}
              list="roster-player-years"
              className={inputClass}
            />
            <datalist id="roster-player-years">
              {classYearOptions.map((year) => (
                <option key={year} value={year} />
              ))}
            </datalist>
          </Field>
          <Field id="roster-player-email" label="Email (optional)" className="sm:col-span-6">
            <Input
              id="roster-player-email"
              name="email"
              type="email"
              maxLength={254}
              value={editingPlayer?.user ? getRosterDisplayEmail(editingPlayer) : formState.email}
              readOnly={Boolean(editingPlayer?.user || editingPlayer?.account_link_held)}
              onChange={(event) => updateField("email", event.target.value)}
              placeholder="player@example.com"
              className={inputClass}
              aria-describedby="roster-player-email-help"
            />
            <p id="roster-player-email-help" className="text-xs text-custom-text-300">
              {editingPlayer?.account_link_held
                ? "This roster identity is held for review."
                : editingPlayer?.user
                  ? "This email belongs to the linked athlete account."
                  : "Optional. Unmatched players can join using a personal invitation or the team link."}
            </p>
          </Field>
          {!editingPlayer && (
            <div
              className="space-y-3 rounded-lg border border-custom-border-200 bg-custom-background-90 p-3 sm:col-span-6"
              aria-live="polite"
            >
              <div className="flex items-center gap-2 text-sm font-medium text-custom-text-200">
                <UserCheck className="size-4" />
                Existing account
              </div>
              {!canLookup ? (
                <p className="text-xs text-custom-text-300">
                  Only authorized roster managers can link an existing account.
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      type="button"
                      variant="neutral-primary"
                      size="sm"
                      disabled={!canSearch || searching}
                      onClick={() => {
                        setSelectedAccount(null);
                        if (searchActive) void searchAgain();
                        else setMatchSearch(searchKey);
                      }}
                    >
                      <Search className="size-4" />
                      {searching ? "Searching…" : "Find matching accounts"}
                    </Button>
                    {!canSearch && (
                      <p className="text-xs text-custom-text-300">Enter a full name and four-digit graduation year.</p>
                    )}
                  </div>
                  {matchError && (
                    <p role="alert" className="text-xs text-red-500">
                      Account lookup failed. Try again.
                    </p>
                  )}
                  {!searching &&
                    !matchError &&
                    matches &&
                    (matches.results.length ? (
                      <fieldset className="space-y-2">
                        <legend className="mb-2 text-xs text-custom-text-300">
                          {matches.has_more ? "Showing the first 10 matches. " : ""}Confirm the player&apos;s login
                          email before linking.
                        </legend>
                        {matches.results.map(({ id, email }) => (
                          <label
                            key={id}
                            className="flex cursor-pointer items-start gap-2 text-sm text-custom-text-200"
                          >
                            <input
                              type="radio"
                              name="roster-account-choice"
                              checked={selectedAccount === id}
                              onChange={() => setSelectedAccount(id)}
                              className="mt-1 accent-custom-primary-100"
                            />
                            <span className="min-w-0 break-all">{email}</span>
                          </label>
                        ))}
                        <label className="flex cursor-pointer items-center gap-2 text-sm text-custom-text-200">
                          <input
                            type="radio"
                            name="roster-account-choice"
                            checked={!selectedAccount}
                            onChange={() => setSelectedAccount(null)}
                            className="accent-custom-primary-100"
                          />
                          Keep unlinked
                        </label>
                      </fieldset>
                    ) : (
                      <p className="text-xs text-custom-text-300">
                        No linked roster accounts match this name and year.
                      </p>
                    ))}
                  {emailConflicts && (
                    <p role="alert" className="text-xs text-red-500">
                      Use the selected account&apos;s email or leave the roster email blank.
                    </p>
                  )}
                </>
              )}
            </div>
          )}
          <details className="sm:col-span-6" open={Boolean(editingPlayer)}>
            <summary className="cursor-pointer text-xs font-medium text-custom-text-300">
              More details · height, weight, status and notes
            </summary>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <Field id="roster-player-height" label="Height">
                <Input
                  id="roster-player-height"
                  value={formState.height}
                  onChange={(event) => updateField("height", event.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field id="roster-player-weight" label="Weight">
                <Input
                  id="roster-player-weight"
                  value={formState.weight}
                  onChange={(event) => updateField("weight", event.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field id="roster-player-status" label="Status">
                <CustomSelect
                  value={formState.status}
                  onChange={(value: TRosterPlayerStatus) => updateField("status", value)}
                  label={<span>{toDisplayStatus(formState.status)}</span>}
                  buttonClassName="w-full justify-between rounded-md border-custom-border-200 bg-custom-background-100 px-3 py-2 text-sm text-custom-text-200"
                >
                  {STATUS_SELECT_OPTIONS.map((option) => (
                    <CustomSelect.Option key={option.value} value={option.value}>
                      {option.label}
                    </CustomSelect.Option>
                  ))}
                </CustomSelect>
              </Field>
              <Field id="roster-player-notes" label="Notes" className="sm:col-span-3">
                <TextArea
                  id="roster-player-notes"
                  value={formState.notes}
                  onChange={(event) => updateField("notes", event.target.value)}
                  className="min-h-28 w-full resize-none border-custom-border-200 bg-custom-background-100"
                />
              </Field>
            </div>
          </details>
          {saveError && (
            <p role="alert" className="text-sm text-red-500 sm:col-span-6">
              Player could not be saved. Your details are kept; review the error and try again.
            </p>
          )}
        </fieldset>
        <div className="flex flex-wrap items-center gap-3 border-t border-custom-border-200 px-5 py-4">
          {!editingPlayer && (
            <div className="mr-auto flex items-center gap-2 text-sm text-custom-text-300">
              <ToggleSwitch
                value={addAnother}
                onChange={setAddAnother}
                disabled={isSubmitting}
                label="Add another"
                size="sm"
              />
              Add another
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button variant="neutral-primary" size="sm" type="button" onClick={close} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              type="submit"
              loading={isSubmitting}
              disabled={!canManage || !validName || Boolean(jerseyConflict) || matchBlocked}
            >
              {editingPlayer ? "Save changes" : confirmed ? "Add and link player" : "Add player"}
            </Button>
          </div>
        </div>
      </form>
    </ModalCore>
  );
});
