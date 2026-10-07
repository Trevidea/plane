import { useContext, useMemo, useState } from "react";
import useSWR from "swr";
import { ArrowRight, ListFilter, UsersRound, X } from "lucide-react";
import { Dialog } from "@headlessui/react";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { Tooltip } from "@plane/propel/tooltip";
import type { IRosterPlayer, TCoachingCardStageConfig, TIssue } from "@plane/types";
import { Button, EModalWidth, ModalCore } from "@plane/ui";
import { cn } from "@plane/utils";
import { getPositionGroups } from "@/components/issues/issue-detail/sg-event-detail-page/create-card-model";
import { CreateCardRosterPicker } from "@/components/issues/issue-detail/sg-event-detail-page/create-card-roster-picker";
import { IssueService } from "@/services/issue/issue.service";
import { RosterService } from "@/services/roster.service";
import { getCardStageActions } from "./coaching-card-stage-model";
import { CoachingCardStageRequestContext } from "./coaching-card-stage-request-context";

const issueService = new IssueService();
const rosterService = new RosterService();

const messageFromError = (error: unknown, fallback: string): string => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    for (const value of Object.values(error)) {
      if (typeof value === "string") return value;
      if (Array.isArray(value) && typeof value[0] === "string") return value[0];
    }
  }
  return fallback;
};

type ActionProps = {
  issue: TIssue;
  config?: TCoachingCardStageConfig;
  workspaceSlug: string;
  projectId: string;
  onChanged: () => void;
};

export const AssignmentDialog = ({
  issue,
  workspaceSlug,
  projectId,
  onChanged,
  onClose,
  advanceOnSave = false,
}: ActionProps & { onClose: () => void; advanceOnSave?: boolean }) => {
  const card = issue.coaching_card_data;
  const originalIds =
    card?.recipient_ids ?? card?.recipients?.map((recipient) => recipient.id) ?? (card?.player ? [card.player.id] : []);
  const originalGroup = card?.position_group ?? "";
  const [mode, setMode] = useState<"players" | "group">(originalGroup ? "group" : "players");
  const [selectedIds, setSelectedIds] = useState<string[]>(originalIds);
  const [group, setGroup] = useState(originalGroup);
  const [isSaving, setIsSaving] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const {
    data: roster,
    error,
    isLoading,
    mutate,
  } = useSWR<IRosterPlayer[]>(
    ["coaching-card-roster", workspaceSlug, projectId],
    () => rosterService.getRoster(workspaceSlug, projectId),
    { revalidateOnFocus: false }
  );
  const players = useMemo(() => roster ?? [], [roster]);
  const selectedPlayers = useMemo(
    () => players.filter((player) => selectedIds.includes(player.id)),
    [players, selectedIds]
  );
  const groups = useMemo(() => getPositionGroups(players), [players]);
  const hasChanged =
    mode === "group"
      ? group !== originalGroup
      : Boolean(originalGroup) ||
        selectedIds.length !== originalIds.length ||
        selectedIds.some((id) => !originalIds.includes(id));
  const canSave =
    !isLoading &&
    !error &&
    !isSaving &&
    (hasChanged || advanceOnSave) &&
    (mode === "group" ? Boolean(group) : selectedIds.length > 0 || (!advanceOnSave && originalIds.length > 0));

  const handleSave = async () => {
    if (!canSave) return;
    setIsSaving(true);
    setSubmitError("");
    try {
      await issueService.updateCoachingCard(
        workspaceSlug,
        projectId,
        issue.id,
        mode === "group" ? { position_group: group } : { player_ids: selectedIds }
      );
      onClose();
      onChanged();
      setToast({ type: TOAST_TYPE.SUCCESS, title: "Recipients updated", message: "The coaching board is up to date." });
    } catch (saveError) {
      setSubmitError(messageFromError(saveError, "Could not update recipients. Please try again."));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ModalCore
      isOpen
      handleClose={() => !isSaving && onClose()}
      width={EModalWidth.LG}
      className="border border-custom-border-300"
    >
      <form
        className="space-y-5 p-5"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSave();
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <Dialog.Title as="h2" className="text-base font-semibold text-custom-text-100">
            {advanceOnSave ? "Assign players" : originalIds.length ? "Edit recipients" : "Assign players"}
          </Dialog.Title>
          <Button
            unstyled
            type="button"
            aria-label="Close recipients"
            onClick={onClose}
            disabled={isSaving}
            className="flex h-8 w-8 items-center justify-center rounded border border-custom-border-300 text-custom-text-300 focus-visible:ring-2 focus-visible:ring-custom-primary-100"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-xs font-medium text-custom-text-200">Assign to</legend>
          <div className="flex gap-4 text-sm text-custom-text-100">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="coaching-card-assignment"
                checked={mode === "players"}
                onChange={() => setMode("players")}
                disabled={isSaving}
              />
              Players
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="coaching-card-assignment"
                checked={mode === "group"}
                onChange={() => setMode("group")}
                disabled={isSaving}
              />
              Position group
            </label>
          </div>
        </fieldset>
        {mode === "players" ? (
          <CreateCardRosterPicker
            players={players}
            selectedPlayers={selectedPlayers}
            onChange={setSelectedIds}
            isLoading={isLoading}
            hasError={Boolean(error)}
            onRetry={() => void mutate()}
          />
        ) : (
          <label className="block text-xs font-medium text-custom-text-200">
            Position group
            <select
              value={group}
              onChange={(event) => setGroup(event.target.value)}
              disabled={isLoading || Boolean(error) || isSaving}
              className="mt-2 h-10 w-full rounded border border-custom-border-300 bg-custom-background-90 px-3 text-sm text-custom-text-100"
            >
              <option value="">Select a group</option>
              {groups.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            {groups.length === 0 && !isLoading && !error && (
              <span className="mt-2 block text-xs font-normal text-custom-text-300">
                No position groups are available in this roster.
              </span>
            )}
            {error && (
              <Button
                unstyled
                type="button"
                onClick={() => void mutate()}
                className="mt-2 block text-custom-primary-100"
              >
                Retry roster
              </Button>
            )}
          </label>
        )}
        {mode === "players" && selectedIds.length === 0 && originalIds.length > 0 && (
          <p className="text-xs text-custom-text-300">Saving without recipients will leave this card unassigned.</p>
        )}
        {submitError && (
          <p role="alert" className="text-xs text-red-500">
            {submitError}
          </p>
        )}
        <div className="flex justify-end gap-2 border-t border-custom-border-200 pt-4">
          <Button
            unstyled
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="rounded border border-custom-border-300 px-3 py-2 text-xs text-custom-text-200"
          >
            Cancel
          </Button>
          <Button
            unstyled
            type="submit"
            disabled={!canSave}
            className="rounded bg-custom-primary-100 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            {isSaving ? "Saving..." : advanceOnSave ? "Assign and send" : "Save recipients"}
          </Button>
        </div>
      </form>
    </ModalCore>
  );
};

export const CoachingCardActions = ({ issue, config, workspaceSlug, projectId, onChanged }: ActionProps) => {
  const requestStageChange = useContext(CoachingCardStageRequestContext);
  const [dialog, setDialog] = useState<"recipients" | "stages" | null>(null);
  const [isMoving, setIsMoving] = useState(false);
  const card = issue.coaching_card_data;
  const recipientCount = card?.recipient_ids?.length ?? card?.recipients?.length ?? (card?.player ? 1 : 0);
  const { available, next } = getCardStageActions(config, issue.state_id);
  const stageOptions = available.filter((stage) => recipientCount > 0 || stage.name.toLowerCase() !== "assigned");
  const nextStage = stageOptions.find((stage) => stage.id === next?.id);
  const needsAssignment = issue.state_id === config?.initial_stage_id && next?.name.toLowerCase() === "assigned";
  const awaitsReview =
    config?.stages.find((stage) => stage.id === issue.state_id)?.name.toLowerCase() === "assigned" && !nextStage;
  const currentName = config?.stages.find((stage) => stage.id === issue.state_id)?.name ?? "Current stage";

  const moveToStage = async (stageId: string, stageName: string) => {
    if (isMoving) return;
    setDialog(null);
    const request = requestStageChange ? await requestStageChange(issue, stageId) : null;
    if (!request) return;
    setIsMoving(true);
    try {
      await issueService.transitionCoachingCard(workspaceSlug, projectId, issue.id, request.stageId, request.reason);
      setDialog(null);
      onChanged();
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: `Moved to ${config?.stages.find((stage) => stage.id === request.stageId)?.name ?? stageName}`,
        message: "The coaching board is up to date.",
      });
    } catch (moveError) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Stage change failed",
        message: messageFromError(moveError, "Please try again."),
      });
    } finally {
      setIsMoving(false);
    }
  };

  return (
    <>
      <Tooltip
        tooltipContent={
          recipientCount && !needsAssignment
            ? "Edit recipients"
            : needsAssignment
              ? `Next: ${next?.name} — assign players`
              : "Assign to Player"
        }
      >
        <Button
          unstyled
          type="button"
          onClick={() => setDialog("recipients")}
          aria-label={
            recipientCount && !needsAssignment
              ? "Edit recipients"
              : needsAssignment
                ? `Next: ${next?.name} — assign players`
                : "Assign to Player"
          }
          className={cn(
            "inline-flex h-6 shrink-0 items-center justify-center gap-1.5 rounded-md text-[11px] font-medium focus-visible:ring-2 focus-visible:ring-custom-primary-100",
            recipientCount && !needsAssignment
              ? "w-6 border border-custom-border-200 bg-custom-background-80 text-custom-text-200 hover:text-custom-text-100"
              : "bg-custom-primary-100 px-2.5 text-white hover:opacity-90"
          )}
        >
          <span className="shrink-0">
            {needsAssignment ? (
              <ArrowRight className="h-3 w-3" aria-hidden="true" />
            ) : (
              <UsersRound className="h-3 w-3" aria-hidden="true" />
            )}
          </span>
          {(!recipientCount || needsAssignment) && (needsAssignment ? `Next: ${next?.name}` : "Assign to Player")}
        </Button>
      </Tooltip>
      {nextStage && !needsAssignment && (
        <Tooltip tooltipContent={`Move to ${nextStage.name}`}>
          <Button
            unstyled
            type="button"
            onClick={() => void moveToStage(nextStage.id, nextStage.name)}
            disabled={isMoving}
            title={`Move to ${nextStage.name}`}
            aria-label={`Move to ${nextStage.name}`}
            className="inline-flex h-6 min-w-0 max-w-full items-center gap-1 rounded-md bg-custom-primary-100 px-2.5 text-[11px] font-medium text-white hover:opacity-90 focus-visible:ring-2 focus-visible:ring-custom-primary-100 disabled:opacity-50"
          >
            <ArrowRight className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="truncate">Next: {nextStage.name}</span>
          </Button>
        </Tooltip>
      )}
      {awaitsReview && (
        <Tooltip tooltipContent="This stage advances automatically after player review.">
          <span className="truncate text-[11px] text-custom-text-300">Awaiting player review</span>
        </Tooltip>
      )}
      {stageOptions.length > 0 && (
        <Tooltip tooltipContent="Choose stage">
          <Button
            unstyled
            type="button"
            onClick={() => setDialog("stages")}
            disabled={isMoving}
            aria-label="Choose coaching card stage"
            title="Choose stage"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-custom-border-200 bg-custom-background-80 text-custom-text-200 hover:text-custom-text-100 focus-visible:ring-2 focus-visible:ring-custom-primary-100 disabled:opacity-50"
          >
            <ListFilter className="h-3 w-3" aria-hidden="true" />
          </Button>
        </Tooltip>
      )}
      {dialog === "recipients" && (
        <AssignmentDialog
          issue={issue}
          config={config}
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          onChanged={onChanged}
          onClose={() => setDialog(null)}
          advanceOnSave={needsAssignment}
        />
      )}
      {dialog === "stages" && (
        <ModalCore
          isOpen
          handleClose={() => !isMoving && setDialog(null)}
          width={EModalWidth.MD}
          className="border border-custom-border-300"
        >
          <div className="space-y-4 p-5">
            <div className="flex items-center justify-between gap-3">
              <Dialog.Title as="h2" className="text-base font-semibold text-custom-text-100">
                Move card
              </Dialog.Title>
              <Button
                unstyled
                type="button"
                aria-label="Close stage selection"
                onClick={() => setDialog(null)}
                disabled={isMoving}
                className="flex h-8 w-8 items-center justify-center rounded border border-custom-border-300 text-custom-text-300"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-custom-text-300">Current stage: {currentName}</p>
            <div className="space-y-1.5">
              {stageOptions.map((stage) => (
                <Button
                  key={stage.id}
                  unstyled
                  type="button"
                  onClick={() => void moveToStage(stage.id, stage.name)}
                  disabled={isMoving}
                  className="flex min-h-10 w-full items-center justify-between rounded border border-custom-border-300 px-3 text-left text-sm text-custom-text-100 hover:bg-custom-background-90 focus-visible:ring-2 focus-visible:ring-custom-primary-100 disabled:opacity-50"
                >
                  {stage.name}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              ))}
            </div>
          </div>
        </ModalCore>
      )}
    </>
  );
};
