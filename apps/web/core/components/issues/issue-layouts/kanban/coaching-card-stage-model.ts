import type { TCoachingCardStageConfig } from "@plane/types";

type CardStage = TCoachingCardStageConfig["stages"][number];

const LEGACY_STAGE_ROLES = new Map<string, NonNullable<CardStage["lifecycle_role"]>>([
  ["identified", "identified"],
  ["film tagged", "identified"],
  ["unassigned", "identified"],
  ["assigned", "assigned"],
  ["player reviewed", "reviewed"],
  ["in work", "reviewed"],
  ["practice check", "practice"],
  ["ready for coach review", "practice"],
  ["resolved", "verified"],
  ["verified on film", "verified"],
]);

export const getCardStageRole = (stage?: Pick<CardStage, "name" | "lifecycle_role">) =>
  stage?.lifecycle_role || LEGACY_STAGE_ROLES.get(stage?.name.toLowerCase() ?? "");

export const getCardReviewStages = (config: TCoachingCardStageConfig | undefined) => {
  const stages = [...(config?.stages ?? [])].sort((a, b) => a.order - b.order);
  const assigned = stages.find((stage) => stage.lifecycle_role === "assigned");
  const reviewed = stages.find((stage) => stage.lifecycle_role === "reviewed");
  if (assigned && reviewed) return { assigned, reviewed };
  if (
    !stages.some((stage) => stage.lifecycle_role) &&
    getCardStageRole(stages[1]) === "assigned" &&
    getCardStageRole(stages[2]) === "reviewed"
  )
    return { assigned: stages[1], reviewed: stages[2] };
  return undefined;
};

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
  if (stages[target].lifecycle_role === "closed") {
    if (stages[current].lifecycle_role === "verified" && canTransitionCard(config, currentStageId, targetStageId))
      return { kind: "move", stage: stages[target] };
    return { kind: "blocked", title: "Verification required", message: "Verify the card before closing it." };
  }
  if (stages[current].lifecycle_role === "closed") {
    const verified = stages.find((stage) => stage.lifecycle_role === "verified");
    if (verified && canTransitionCard(config, currentStageId, verified.id)) return { kind: "reopen", stage: verified };
  }
  if (target < current) {
    const previous = stages[current - 1];
    if (canTransitionCard(config, currentStageId, previous.id)) return { kind: "reopen", stage: previous };
  } else {
    const following = stages[current + 1];
    if (currentStageId === config?.initial_stage_id && getCardStageRole(following) === "assigned")
      return { kind: "assign", stage: following };
    const reviewStages = getCardReviewStages(config);
    if (reviewStages && currentStageId === reviewStages.assigned.id)
      return {
        kind: "blocked",
        title: `Cannot move to ${reviewStages.reviewed.name}`,
        message: `Player review is automatic. This card cannot be advanced manually from ${reviewStages.assigned.name}.`,
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
  const next =
    stages[currentIndex]?.lifecycle_role === "verified"
      ? stages.find((stage) => stage.lifecycle_role === "closed")
      : stages[currentIndex + 1];
  return { available, next: available.find((stage) => stage.id === next?.id) ?? null };
};

export const orderCardColumns = <T extends { id: string; group?: string; sequence?: number }>(
  columns: T[],
  config: TCoachingCardStageConfig
): T[] => {
  // Sequence values are local to a workflow group, just as in States settings.
  const groups = ["backlog", "unstarted", "started", "completed", "cancelled"];
  if (
    columns.every((column) => column.group && typeof column.sequence === "number" && Number.isFinite(column.sequence))
  ) {
    return [...columns].sort(
      (a, b) => groups.indexOf(a.group!) - groups.indexOf(b.group!) || a.sequence! - b.sequence!
    );
  }
  const byId = new Map(columns.map((column) => [column.id, column]));
  const stageIds = new Set(config.stages.map((stage) => stage.id));
  const configuredColumns = [...config.stages]
    .sort((a, b) => a.order - b.order)
    .flatMap((stage) => byId.get(stage.id) ?? []);
  return [...configuredColumns, ...columns.filter((column) => !stageIds.has(column.id))];
};

// Use the same project-state order for buttons, drag/drop and board columns.
export const alignCardStageConfig = (
  config: TCoachingCardStageConfig | undefined,
  states: Array<{ id: string; name: string; group: string; sequence: number }> | undefined
): TCoachingCardStageConfig | undefined => {
  if (!config || !states?.length) return config;
  const byId = new Map(states.map((state) => [state.id, state]));
  if (config.stages.some((stage) => !byId.has(stage.id))) return config;
  const ordered = orderCardColumns(
    config.stages.map((stage) => byId.get(stage.id)!),
    config
  );
  const previous = [...config.stages].sort((a, b) => a.order - b.order);
  const reordered = ordered.some((state, index) => state.id !== previous[index].id);
  const alignedStages = ordered.map((state, order) => ({
    ...config.stages.find((stage) => stage.id === state.id)!,
    name: state.name,
    order,
  }));
  const reviewStages = getCardReviewStages({ ...config, stages: alignedStages });
  const verified = config.stages.find((stage) => stage.lifecycle_role === "verified");
  const closed = config.stages.find((stage) => stage.lifecycle_role === "closed");
  return {
    ...config,
    initial_stage_id:
      config.stages.find((stage) => stage.lifecycle_role === "identified")?.id ??
      ordered[0]?.id ??
      config.initial_stage_id,
    stages: alignedStages.map((state, order) => ({
      ...state,
      // Rebuild adjacency when settings changed, matching the server lifecycle contract.
      allowed_next_stage_ids:
        state.id === closed?.id && verified
          ? [verified.id]
          : state.id === verified?.id && closed
            ? [
                ...new Set([
                  ...(config.stages.find((stage) => stage.id === state.id)?.allowed_next_stage_ids ?? []),
                  closed.id,
                ]),
              ]
            : reordered
              ? ordered
                  .filter(
                    (candidate, index) =>
                      Math.abs(index - order) === 1 &&
                      !(
                        reviewStages &&
                        state.id === reviewStages.assigned.id &&
                        candidate.id === reviewStages.reviewed.id
                      )
                  )
                  .map((state) => state.id)
              : previous[order].allowed_next_stage_ids,
    })),
  };
};
