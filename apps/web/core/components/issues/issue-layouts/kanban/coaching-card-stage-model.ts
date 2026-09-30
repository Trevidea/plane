import type { TCoachingCardStageConfig } from "@plane/types";

export const canTransitionCard = (
  config: TCoachingCardStageConfig | undefined,
  currentStageId: string | null | undefined,
  targetStageId: string | null | undefined
) =>
  Boolean(
    config?.stages.find((stage) => stage.id === currentStageId)?.allowed_next_stage_ids.includes(targetStageId || "")
  );

export const orderCardColumns = <T extends { id: string }>(columns: T[], config: TCoachingCardStageConfig): T[] => {
  const byId = new Map(columns.map((column) => [column.id, column]));
  const stageIds = new Set(config.stages.map((stage) => stage.id));
  const configuredColumns = [...config.stages]
    .sort((a, b) => a.order - b.order)
    .flatMap((stage) => byId.get(stage.id) ?? []);
  return [...configuredColumns, ...columns.filter((column) => !stageIds.has(column.id))];
};
