import { useContext, useRef, useState } from "react";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TCoachingCardStageConfig, TIssue } from "@plane/types";
import { IssueService } from "@/services/issue/issue.service";
import { CoachingCardStageRequestContext } from "./coaching-card-stage-request-context";

const issueService = new IssueService();

export const coachingCardErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    for (const value of Object.values(error)) {
      if (typeof value === "string") return value;
      if (Array.isArray(value) && typeof value[0] === "string") return value[0];
    }
  }
  return fallback;
};

export const useCoachingCardStageAction = ({
  issue,
  config,
  workspaceSlug,
  projectId,
  onChanged,
}: {
  issue: TIssue;
  config?: TCoachingCardStageConfig;
  workspaceSlug: string;
  projectId: string;
  onChanged: () => void;
}) => {
  const requestStageChange = useContext(CoachingCardStageRequestContext);
  const pending = useRef(false);
  const [isMoving, setIsMoving] = useState(false);

  const moveToStage = async (stageId: string) => {
    if (pending.current || !requestStageChange) return;
    pending.current = true;
    setIsMoving(true);
    try {
      const request = await requestStageChange(issue, stageId);
      if (!request) return;
      await issueService.transitionCoachingCard(workspaceSlug, projectId, issue.id, request.stageId, request.reason);
      onChanged();
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: `Moved to ${config?.stages.find((stage) => stage.id === request.stageId)?.name ?? "next stage"}`,
        message: "The coaching board is up to date.",
      });
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Stage change failed",
        message: coachingCardErrorMessage(error, "Please try again."),
      });
    } finally {
      pending.current = false;
      setIsMoving(false);
    }
  };

  return { moveToStage, isMoving, canRequestStageChange: Boolean(requestStageChange) };
};
