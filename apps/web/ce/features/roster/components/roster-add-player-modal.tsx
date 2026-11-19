"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import { Info, UserCheck, X } from "lucide-react";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { Button } from "@plane/propel/button";
import type { IWorkspaceMember, TRosterPlayerStatus } from "@plane/types";
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
import { WorkspaceService } from "@/services/workspace.service";
import { STATUS_SELECT_OPTIONS } from "../constants/roster.constants";
import type { TRosterFormState } from "../store/roster-context";
import { getRosterFormState, useRoster } from "../store/roster-context";
import { findRosterAccountSuggestions, findRosterJerseyConflict } from "../utils/roster-account-suggestions";
import { getRosterDisplayEmail, toDisplayStatus } from "../utils/roster.utils";

const workspaceService = new WorkspaceService();
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
    allPlayers,
    positionOptions,
    classYearOptions,
  } = useRoster();
  const { allowPermissions } = useUserPermissions();
  const modalOpen = isOpen ?? isAddPlayerModalOpen;
  const editingPlayerId = editingPlayer?.id;
  const handleClose = onClose ?? closePlayerModal;
  const [formState, setFormState] = useState<TRosterFormState>(() => getRosterFormState(editingPlayer));
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [addAnother, setAddAnother] = useState(false);
  const [members, setMembers] = useState<IWorkspaceMember[]>([]);
  const [lookup, setLookup] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [lookupCancelled, setLookupCancelled] = useState(false);
  const [retry, setRetry] = useState(0);
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [unlinked, setUnlinked] = useState(false);
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
    setUnlinked(false);
    setSaveError(false);
    setLookupCancelled(false);
  }, [modalOpen, editingPlayer]);

  useEffect(() => {
    if (!modalOpen || editingPlayerId || !canLookup || lookupCancelled) {
      setMembers([]);
      setLookup("idle");
      return;
    }
    let current = true;
    setMembers([]);
    setLookup("loading");
    workspaceService
      .fetchWorkspaceMembers(workspaceSlug)
      .then((result) => {
        if (!current) return;
        setMembers(result);
        setLookup("ready");
      })
      .catch(() => {
        if (current) setLookup("error");
      });
    return () => {
      current = false;
    };
  }, [modalOpen, editingPlayerId, canLookup, workspaceSlug, retry, lookupCancelled]);

  const updateField = <K extends keyof TRosterFormState>(key: K, value: TRosterFormState[K]) => {
    setFormState((state) => ({ ...state, [key]: value }));
    setSaveError(false);
    if (key === "email") {
      setSelectedAccount(null);
      setUnlinked(false);
    }
  };
  const fullName = editingPlayer ? formState.player_name : `${firstName.trim()} ${lastName.trim()}`.trim();
  const jerseyConflict =
    formState.status === "inactive"
      ? undefined
      : findRosterJerseyConflict(allPlayers, formState.jersey_number, editingPlayer?.id);
  const suggestions = findRosterAccountSuggestions(members, allPlayers, fullName, formState.email);
  const emailMatch = suggestions.find((candidate) => candidate.reason === "email");
  const needsAccountChoice = !editingPlayer && Boolean(emailMatch && emailMatch.user.id !== selectedAccount);
  const validName = editingPlayer ? Boolean(fullName.trim()) : Boolean(firstName.trim() && lastName.trim());
  const submit = async () => {
    if (isSubmitting || !canManage || !validName || jerseyConflict || needsAccountChoice) return;
    setSaveError(false);
    const saved = await submitPlayer(
      { ...formState, player_name: fullName },
      { keepOpen: !editingPlayer && addAnother }
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
      setUnlinked(false);
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
                    setUnlinked(false);
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
                    setUnlinked(false);
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
              readOnly={Boolean(editingPlayer?.user)}
              onChange={(event) => updateField("email", event.target.value)}
              placeholder="player@example.com"
              className={inputClass}
              aria-describedby="roster-player-email-help"
            />
            <p id="roster-player-email-help" className="text-xs text-custom-text-300">
              {editingPlayer?.user
                ? "This email belongs to the linked athlete account."
                : "An existing account can use this email to join through the team link. Admin or coach approval is required for this program. Leave blank to add without an account."}
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
                  Account suggestions require permission to view workspace members. You can add the player now and share
                  the team join code later.
                </p>
              ) : lookup === "loading" ? (
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-custom-text-300">Checking workspace accounts…</p>
                  <button
                    type="button"
                    className="text-xs text-custom-primary-100"
                    onClick={() => setLookupCancelled(true)}
                  >
                    Cancel lookup
                  </button>
                </div>
              ) : lookup === "error" || lookupCancelled ? (
                <div className="space-y-2">
                  <p className="text-xs text-custom-text-300">
                    {lookupCancelled
                      ? "Account lookup cancelled."
                      : "Could not check workspace accounts. Your player details are kept."}
                  </p>
                  <button
                    type="button"
                    className="text-xs text-custom-primary-100"
                    onClick={() => {
                      setLookupCancelled(false);
                      setRetry((value) => value + 1);
                    }}
                  >
                    Retry account lookup
                  </button>
                </div>
              ) : lookup === "ready" && suggestions.length ? (
                <>
                  <p className="text-xs text-custom-text-300">
                    Choose an account only if it belongs to this player. Graduation year is not available on these
                    accounts and has not been checked.
                  </p>
                  {suggestions.map(({ user, reason }) => (
                    <label
                      key={user.id}
                      className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 ${selectedAccount === user.id ? "border-custom-primary-100 bg-custom-primary-100/5" : "border-custom-border-200"}`}
                    >
                      <input
                        type="radio"
                        name="roster-account-choice"
                        checked={selectedAccount === user.id}
                        onChange={() => {
                          setSelectedAccount(user.id);
                          setUnlinked(false);
                          setFormState((state) => ({ ...state, email: user.email ?? "" }));
                        }}
                        className="mt-1 accent-custom-primary-100"
                      />
                      <span className="min-w-0 space-y-1">
                        <span className="block text-sm font-medium text-custom-text-100">
                          {user.first_name} {user.last_name}
                        </span>
                        <span className="block break-all text-xs text-custom-text-300">{user.email}</span>
                        <span className="block text-xs text-custom-text-300">
                          {reason === "email" ? "Same email" : "Same name"} · Current workspace account
                        </span>
                      </span>
                    </label>
                  ))}
                  <label
                    className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 ${unlinked ? "border-custom-primary-100" : "border-custom-border-200"}`}
                  >
                    <input
                      type="radio"
                      name="roster-account-choice"
                      checked={unlinked}
                      onChange={() => {
                        setSelectedAccount(null);
                        setUnlinked(true);
                        setFormState((state) => ({ ...state, email: "" }));
                      }}
                      className="mt-1 accent-custom-primary-100"
                    />
                    <span>
                      <span className="block text-sm font-medium text-custom-text-100">
                        Different person, add without an account
                      </span>
                      <span className="block text-xs text-custom-text-300">
                        Clears the suggested email. They can join later with the team link.
                      </span>
                    </span>
                  </label>
                  {selectedAccount && (
                    <p className="text-xs text-custom-text-300">
                      Saving identifies the suggested account. The player must join through the team link and receive
                      approval.
                    </p>
                  )}
                  {needsAccountChoice && (
                    <p role="alert" className="text-xs text-amber-600">
                      This email matches an account. Select it above or choose to add without an account.
                    </p>
                  )}
                </>
              ) : (
                <p className="flex items-start gap-2 text-xs text-custom-text-300">
                  <Info className="size-4 shrink-0" />
                  {validName || formState.email
                    ? "No account suggestions match this full name or email. The player can join later with the team code."
                    : "Enter the player's full name or email to check current workspace accounts."}
                </p>
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
              disabled={!canManage || !validName || Boolean(jerseyConflict) || needsAccountChoice}
            >
              {editingPlayer ? "Save changes" : "Add player"}
            </Button>
          </div>
        </div>
      </form>
    </ModalCore>
  );
});
