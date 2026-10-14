import type { TCoachingCardStageConfig } from "@plane/types";

export const canEditCoachingCardRecipients = (
  config: TCoachingCardStageConfig | undefined,
  stageId: string | null | undefined
) => {
  const stage = config?.stages.find((entry) => entry.id === stageId);
  if (!stage || !config) return false;
  const hasEarlyStageRoles = config.stages.some(
    (entry) => entry.lifecycle_role === "identified" || entry.lifecycle_role === "assigned"
  );
  if (stage.lifecycle_role || hasEarlyStageRoles)
    return stage.lifecycle_role === "identified" || stage.lifecycle_role === "assigned";
  // Older programs have no role metadata; use their configured lifecycle order.
  return [...config.stages]
    .sort((a, b) => a.order - b.order)
    .slice(0, 2)
    .some((entry) => entry.id === stageId);
};
