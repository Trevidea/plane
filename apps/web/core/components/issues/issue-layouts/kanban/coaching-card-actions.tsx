import { useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
import { ArrowRight, UsersRound, X } from "lucide-react";
import { Dialog } from "@headlessui/react";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { Tooltip } from "@plane/propel/tooltip";
import type { IRosterPlayer, TCoachingCardStageConfig, TIssue } from "@plane/types";
import { Button, EModalWidth, ModalCore } from "@plane/ui";
import { getPositionGroups } from "@/components/issues/issue-detail/sg-event-detail-page/create-card-model";
import { CreateCardPositionGroupPicker } from "@/components/issues/issue-detail/sg-event-detail-page/create-card-position-group-picker";
import { CreateCardRosterPicker } from "@/components/issues/issue-detail/sg-event-detail-page/create-card-roster-picker";
import { IssueService } from "@/services/issue/issue.service";
import { RosterService } from "@/services/roster.service";
import { canEditCoachingCardRecipients } from "./coaching-card-recipient-policy";
import { getCardStageActions, getCardStageRole } from "./coaching-card-stage-model";
import { coachingCardErrorMessage, useCoachingCardStageAction } from "./use-coaching-card-stage-action";

const issueService = new IssueService();
const rosterService = new RosterService();

type ActionProps = {
  issue: TIssue;
  config?: TCoachingCardStageConfig;
  workspaceSlug: string;
  projectId: string;
  onChanged: () => void;
};

export const AssignmentDialog = observer(function AssignmentDialog({
  issue,
  config,
  workspaceSlug,
  projectId,
  onChanged,
  onClose,
  advanceOnSave = false,
}: ActionProps & { onClose: () => void; advanceOnSave?: boolean }) {
  const card = issue.coaching_card_data;
  const initialStage = config?.stages.find((stage) => stage.id === config.initial_stage_id);
  const canEditRecipients = !issue.archived_at && canEditCoachingCardRecipients(config, issue.state_id);
  useEffect(() => {
    if (!canEditRecipients) onClose();
  }, [canEditRecipients, onClose]);
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
    canEditRecipients ? ["coaching-card-roster", workspaceSlug, projectId] : null,
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
    canEditRecipients &&
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
      const updatedCard = await issueService.updateCoachingCard(
        workspaceSlug,
        projectId,
        issue.id,
        mode === "group" ? { position_group: group } : { player_ids: selectedIds }
      );
      const updatedStage = config?.stages.find((stage) => stage.id === updatedCard.state_id);
      const message =
        updatedStage && updatedCard.state_id !== issue.state_id
          ? `Card moved to ${updatedStage.name}.`
          : "The coaching board is up to date.";
      onClose();
      onChanged();
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Recipients updated",
        message,
      });
    } catch (saveError) {
      setSubmitError(coachingCardErrorMessage(saveError, "Could not update recipients. Please try again."));
    } finally {
      setIsSaving(false);
    }
  };

  if (!canEditRecipients) return null;

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
          <CreateCardPositionGroupPicker
            groups={groups}
            selectedGroup={group}
            onChange={setGroup}
            isLoading={isLoading}
            hasError={Boolean(error)}
            onRetry={() => void mutate()}
            disabled={isSaving}
          />
        )}
        {mode === "players" && selectedIds.length === 0 && originalIds.length > 0 && (
          <p className="text-xs text-custom-text-300">
            {issue.state_id !== config?.initial_stage_id
              ? `Removing all recipients will move this card back to ${initialStage?.name ?? "Identified"}.`
              : "Saving without recipients will keep this card unassigned."}
          </p>
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
});

export const CoachingCardActions = observer(({ issue, config, workspaceSlug, projectId, onChanged }: ActionProps) => {
  const [dialog, setDialog] = useState<"recipients" | null>(null);
  const { moveToStage, isMoving, canRequestStageChange } = useCoachingCardStageAction({
    issue,
    config,
    workspaceSlug,
    projectId,
    onChanged,
  });
  const card = issue.coaching_card_data;
  const recipientCount = card?.recipient_ids?.length ?? card?.recipients?.length ?? (card?.player ? 1 : 0);
  const { available, next } = getCardStageActions(config, issue.state_id);
  const stageOptions = available.filter((stage) => recipientCount > 0 || getCardStageRole(stage) !== "assigned");
  const nextStage = stageOptions.find((stage) => stage.id === next?.id);
  const needsAssignment =
    issue.state_id === config?.initial_stage_id && getCardStageRole(next ?? undefined) === "assigned";
  const awaitsReview =
    getCardStageRole(config?.stages.find((stage) => stage.id === issue.state_id)) === "assigned" && !nextStage;

  const canEditRecipients = !issue.archived_at && canEditCoachingCardRecipients(config, issue.state_id);

  return (
    <>
      {canEditRecipients && (
        <Tooltip tooltipContent="Edit recipients">
          <Button
            unstyled
            type="button"
            onClick={() => setDialog("recipients")}
            aria-label="Edit recipients"
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-custom-border-200 bg-custom-background-80 text-custom-text-200 hover:text-custom-text-100 focus-visible:ring-2 focus-visible:ring-custom-primary-100"
          >
            <UsersRound className="h-3 w-3" aria-hidden="true" />
          </Button>
        </Tooltip>
      )}
      {nextStage && issue.state_id !== config?.initial_stage_id && !needsAssignment && (
        <Tooltip tooltipContent={`Move to ${nextStage.name}`}>
          <Button
            unstyled
            type="button"
            onClick={() => void moveToStage(nextStage.id)}
            disabled={isMoving || !canRequestStageChange}
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
    </>
  );
});
