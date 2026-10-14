import type { TCoachingCardStageConfig } from "@plane/types";
import { getCardReviewStages, getCardStageActions, getCardStageRole } from "./coaching-card-stage-model";

export const getCoachingCardMenuStages = (
  config: TCoachingCardStageConfig | undefined,
  currentStageId: string | null
) => {
  const stages = [...(config?.stages ?? [])].sort((a, b) => a.order - b.order);
  const index = stages.findIndex((stage) => stage.id === currentStageId);
  const current = stages[index];
  const following = index >= 0 ? stages[index + 1] : undefined;
  const preceding =
    current?.lifecycle_role === "closed"
      ? stages.find((stage) => stage.lifecycle_role === "verified")
      : index > 0
        ? stages[index - 1]
        : undefined;
  const { available, next } = getCardStageActions(config, currentStageId);
  const previous = available.find((stage) => stage.id === preceding?.id);
  const assignment = currentStageId === config?.initial_stage_id && getCardStageRole(next ?? undefined) === "assigned";
  const reviewStages = getCardReviewStages(config);
  const automatic = Boolean(current && current.id === reviewStages?.assigned.id && !next);
  const automaticTarget = reviewStages?.reviewed ?? following;

  return {
    current,
    next,
    previous,
    showPrimaryAction: Boolean(next || automatic),
    primaryLabel: assignment
      ? "Assign to Player"
      : automatic
        ? `Move to ${automaticTarget!.name}`
        : next
          ? `Mark ${next.name}`
          : current
            ? "No next stage"
            : "Stage unavailable",
    primaryHint: automatic ? "auto - on clip completion" : next ? (assignment ? "coach" : "coach-gated") : "",
  };
};

const PRIORITIES = ["Developmental", "Standard", "Game Plan Critical"] as const;

export const getCoachingCardPriorityChange = (priority: string | undefined, direction: "raise" | "lower") => {
  const index = PRIORITIES.findIndex((value) => value === (priority || "Standard"));
  return index < 0 ? undefined : PRIORITIES[index + (direction === "raise" ? 1 : -1)];
};

export const getCoachingCardAgeDays = (createdAt: string, now = Date.now()) => {
  const created = new Date(createdAt).getTime();
  return Number.isFinite(created) ? Math.max(0, Math.floor((now - created) / 86_400_000)) : 0;
};
