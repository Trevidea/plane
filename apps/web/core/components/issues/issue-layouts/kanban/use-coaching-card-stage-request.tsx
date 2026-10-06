import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog } from "@headlessui/react";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TCoachingCardStageConfig, TIssue } from "@plane/types";
import { Button, EModalWidth, ModalCore } from "@plane/ui";
import { AssignmentDialog } from "./coaching-card-actions";
import { getCardTransitionIntent } from "./coaching-card-stage-model";
import type { CardStageRequest, RequestCardStageChange } from "./coaching-card-stage-request-context";

type PendingRequest = {
  kind: "assign" | "reopen";
  issue: TIssue;
  stage: TCoachingCardStageConfig["stages"][number];
  resolve: (result: CardStageRequest | null) => void;
};

export const useCoachingCardStageRequest = (
  config: TCoachingCardStageConfig | undefined,
  workspaceSlug: string,
  projectId: string,
  onAssigned: () => void,
  projectIdentifier?: string
) => {
  const [pending, setPending] = useState<PendingRequest | null>(null);
  const pendingRef = useRef<PendingRequest | null>(null);
  const [reason, setReason] = useState("");
  const settle = useCallback((result: CardStageRequest | null) => {
    pendingRef.current?.resolve(result);
    pendingRef.current = null;
    setPending(null);
    setReason("");
  }, []);

  useEffect(() => () => pendingRef.current?.resolve(null), []);

  const requestStageChange: RequestCardStageChange = useCallback(
    async (issue, stageId) => {
      if (pendingRef.current) return null;
      const intent = getCardTransitionIntent(config, issue.state_id, stageId);
      if (intent.kind === "unchanged") return null;
      if (intent.kind === "blocked") {
        setToast({ type: TOAST_TYPE.WARNING, title: intent.title, message: intent.message });
        return null;
      }
      if (intent.kind === "move") return { stageId: intent.stage.id };
      const kind = intent.kind;
      return new Promise<CardStageRequest | null>((resolve) => {
        const request: PendingRequest = { kind, issue, stage: intent.stage, resolve };
        pendingRef.current = request;
        setReason("");
        setPending(request);
      });
    },
    [config]
  );

  const dialogs =
    pending?.kind === "assign" ? (
      <AssignmentDialog
        issue={pending.issue}
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        advanceOnSave
        onChanged={onAssigned}
        onClose={() => settle(null)}
      />
    ) : pending?.kind === "reopen" ? (
      <ModalCore
        isOpen
        handleClose={() => settle(null)}
        width={EModalWidth.MD}
        className="border border-custom-border-300"
      >
        <form
          className="space-y-4 p-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (reason.trim()) settle({ stageId: pending.stage.id, reason: reason.trim() });
          }}
        >
          <Dialog.Title as="h2" className="break-words text-base font-semibold text-custom-text-100">
            Reopen {projectIdentifier ? `${projectIdentifier}-${pending.issue.sequence_id}` : pending.issue.name}
          </Dialog.Title>
          <p className="text-sm text-custom-text-300">
            Move back to <strong className="text-custom-text-100">{pending.stage.name}</strong>. A reason is required
            and is logged.
          </p>
          <label className="block text-xs font-medium text-custom-text-200">
            Reason
            <textarea
              autoFocus
              required
              maxLength={2000}
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. Regressed in Friday game film"
              className="mt-2 w-full rounded border border-custom-border-300 bg-custom-background-90 px-3 py-2 text-sm text-custom-text-100 focus:border-custom-primary-100 focus:outline-none"
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="neutral-primary" size="sm" type="button" onClick={() => settle(null)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" type="submit" disabled={!reason.trim()}>
              Reopen
            </Button>
          </div>
        </form>
      </ModalCore>
    ) : null;

  return { requestStageChange, dialogs };
};
