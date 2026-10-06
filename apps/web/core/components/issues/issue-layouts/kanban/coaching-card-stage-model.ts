import type { TCoachingCardStageConfig } from "@plane/types";

type CardStage = TCoachingCardStageConfig["stages"][number];

export type CardTransitionIntent =
  | { kind: "move" | "reopen" | "assign"; stage: CardStage }
  | { kind: "blocked"; title: string; message: string }
  | { kind: "unchanged" };

export const getCardTransitionIntent = (
  config: TCoachingCardStageConfig | undefined,
  currentStageId: string | null | undefined,
  targetStageId: string
): CardTransitionIntent => {
  const stages = [...(config?.stages ?? [])].sort((a, b) => a.order - b.order);
  const current = stages.findIndex((stage) => stage.id === currentStageId);
  const target = stages.findIndex((stage) => stage.id === targetStageId);
  if (current < 0 || target < 0)
    return { kind: "blocked", title: "Stage unavailable", message: "Select a stage on this coaching board." };
  if (current === target) return { kind: "unchanged" };
  if (target < current) {
    const previous = stages[current - 1];
    if (canTransitionCard(config, currentStageId, previous.id)) return { kind: "reopen", stage: previous };
  } else {
    if (current === 0 && stages[1]?.name.toLowerCase() === "assigned") return { kind: "assign", stage: stages[1] };
    if (
      current === 1 &&
      stages[1]?.name.toLowerCase() === "assigned" &&
      ["player reviewed", "in work"].includes(stages[2]?.name.toLowerCase())
    )
      return {
        kind: "blocked",
        title: `Cannot move to ${stages[2].name}`,
        message: "Player review is automatic. This card cannot be advanced manually from Assigned.",
      };
    if (target === current + 1 && canTransitionCard(config, currentStageId, targetStageId))
      return { kind: "move", stage: stages[target] };
    return { kind: "blocked", title: "One stage at a time", message: `${stages[current + 1].name} comes first.` };
  }
  return { kind: "blocked", title: "Stage unavailable", message: "Select a stage on this coaching board." };
};

export const canTransitionCard = (
  config: TCoachingCardStageConfig | undefined,
  currentStageId: string | null | undefined,
  targetStageId: string | null | undefined
) =>
  Boolean(
    config?.stages.find((stage) => stage.id === currentStageId)?.allowed_next_stage_ids.includes(targetStageId || "")
  );

export const getCardStageActions = (config: TCoachingCardStageConfig | undefined, currentStageId: string | null) => {
  const stages = [...(config?.stages ?? [])].sort((a, b) => a.order - b.order);
  const currentIndex = stages.findIndex((stage) => stage.id === currentStageId);
  const available = stages.filter((stage) => {
    const intent = getCardTransitionIntent(config, currentStageId, stage.id);
    return (
      (intent.kind === "move" || intent.kind === "reopen" || intent.kind === "assign") &&
      intent.stage.id === stage.id &&
      canTransitionCard(config, currentStageId, stage.id)
    );
  });
  const next = stages[currentIndex + 1];
  return { available, next: available.find((stage) => stage.id === next?.id) ?? null };
};

export const orderCardColumns = <T extends { id: string }>(columns: T[], config: TCoachingCardStageConfig): T[] => {
  const byId = new Map(columns.map((column) => [column.id, column]));
  const stageIds = new Set(config.stages.map((stage) => stage.id));
  const configuredColumns = [...config.stages]
    .sort((a, b) => a.order - b.order)
    .flatMap((stage) => byId.get(stage.id) ?? []);
  return [...configuredColumns, ...columns.filter((column) => !stageIds.has(column.id))];
};
