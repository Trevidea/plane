import type { SwimlaneView, TIssue } from "@plane/types";

export type { SwimlaneView } from "@plane/types";

type SwimlaneCard = Pick<TIssue, "id" | "state_id" | "assignee_ids" | "created_at"> & {
  start_date?: string | null;
  position_group?: string | null;
  priority?: string | null;
  coaching_card_data?: {
    player?: { id: string; name: string; jersey_number: string; position: string } | null;
    recipients?: Array<{ id: string; name: string; jersey_number: string; position: string }>;
    position_group?: string | null;
    card_type?: string;
    priority?: string;
  } | null;
};

type LaneCandidate = { id: string; value: string; label: string; secondaryLabel?: string };

export type SwimlaneGroup = {
  id: string;
  value: string;
  label: string;
  secondaryLabel?: string;
  cardCount: number;
  cardsByStage: Record<string, string[]>;
};

export const SWIMLANE_VIEWS: { value: SwimlaneView; label: string }[] = [
  { value: "stage", label: "By Stage" },
  { value: "coach", label: "By Coach" },
  { value: "player", label: "By Player" },
  { value: "card_type", label: "By Card Type" },
  { value: "priority", label: "By Priority" },
  { value: "aging", label: "By Aging" },
];

const CARD_TYPE_LANES = [
  ["Correction", "Correction"],
  ["Positive Reinforcement", "Reinforcement"],
  ["Opponent Scout", "Scout"],
  ["S&C Connection", "S&C"],
  ["Multi-Week Development", "Multi-Week Development"],
] as const;

const PRIORITY_LANES = [
  ["Game Plan Critical", "Game-Plan Critical"],
  ["Standard", "Standard"],
  ["Developmental", "Developmental"],
] as const;

const AGING_LANES = [
  ["fresh", "Fresh", "0–4 days"],
  ["attention", "Attention", "5–7 days"],
  ["stale", "Stale", "8–9 days"],
  ["overdue", "Overdue", "10+ days"],
] as const;

const ageLane = (issue: SwimlaneCard, now: Date): string => {
  const start = issue.start_date || issue.created_at;
  const startTime = new Date(start).getTime();
  const days = Number.isFinite(startTime) ? Math.max(0, Math.floor((now.getTime() - startTime) / 86_400_000)) : 0;
  if (days >= 10) return "overdue";
  if (days >= 8) return "stale";
  if (days >= 5) return "attention";
  return "fresh";
};

const cardLanes = (issue: SwimlaneCard, view: Exclude<SwimlaneView, "stage">, now: Date): LaneCandidate[] => {
  const card = issue.coaching_card_data;
  switch (view) {
    case "coach":
      return issue.assignee_ids.length
        ? issue.assignee_ids.map((id) => ({ id: `coach-${id}`, value: id, label: id }))
        : [{ id: "coach-unassigned", value: "", label: "Unassigned coach" }];
    case "player":
      if (card?.position_group || issue.position_group) {
        const position = card?.position_group || issue.position_group || "";
        return [{ id: `position-${position}`, value: position, label: position, secondaryLabel: "Position group" }];
      }
      if (card?.recipients?.length)
        return card.recipients.map((recipient) => ({
          id: `player-${recipient.id}`,
          value: recipient.id,
          label: recipient.name,
          secondaryLabel: [
            recipient.jersey_number && `#${recipient.jersey_number.replace(/^#/, "")}`,
            recipient.position,
          ]
            .filter(Boolean)
            .join(" · "),
        }));
      if (card?.player)
        return [
          {
            id: `player-${card.player.id}`,
            value: card.player.id,
            label: card.player.name,
            secondaryLabel: [
              card.player.jersey_number && `#${card.player.jersey_number.replace(/^#/, "")}`,
              card.player.position,
            ]
              .filter(Boolean)
              .join(" · "),
          },
        ];
      return [{ id: "player-unassigned", value: "", label: "Unassigned player" }];
    case "card_type": {
      const value = card?.card_type || "";
      const known = CARD_TYPE_LANES.find(([key]) => key === value);
      return [{ id: `type-${value || "unspecified"}`, value, label: known?.[1] || value || "Unspecified type" }];
    }
    case "priority": {
      const value = card?.priority || issue.priority || "";
      const known = PRIORITY_LANES.find(([key]) => key === value);
      return [
        { id: `priority-${value || "unspecified"}`, value, label: known?.[1] || value || "Unspecified priority" },
      ];
    }
    case "aging": {
      const value = ageLane(issue, now);
      const known = AGING_LANES.find(([key]) => key === value)!;
      return [{ id: value, value, label: known[1], secondaryLabel: known[2] }];
    }
  }
};

export const groupCardsBySwimlane = (
  stageIssueIds: Record<string, string[]>,
  issuesMap: Record<string, SwimlaneCard>,
  view: Exclude<SwimlaneView, "stage">,
  now = new Date(),
  availableLanes: LaneCandidate[] = []
): SwimlaneGroup[] => {
  const groups = new Map<string, SwimlaneGroup>();
  const stageIds = Object.keys(stageIssueIds);
  const addLane = (id: string, value: string, label: string, secondaryLabel?: string) => {
    if (!groups.has(id)) {
      groups.set(id, {
        id,
        value,
        label,
        secondaryLabel,
        cardCount: 0,
        cardsByStage: Object.fromEntries(stageIds.map((stageId) => [stageId, []])),
      });
    }
  };

  if (view === "card_type") CARD_TYPE_LANES.forEach(([value, label]) => addLane(`type-${value}`, value, label));
  if (view === "priority") PRIORITY_LANES.forEach(([value, label]) => addLane(`priority-${value}`, value, label));
  if (view === "aging") AGING_LANES.forEach(([value, label, secondary]) => addLane(value, value, label, secondary));
  availableLanes.forEach((lane) => addLane(lane.id, lane.value, lane.label, lane.secondaryLabel));

  for (const [stageId, issueIds] of Object.entries(stageIssueIds)) {
    for (const issueId of issueIds) {
      const issue = issuesMap[issueId];
      if (!issue) continue;
      for (const lane of cardLanes(issue, view, now)) {
        addLane(lane.id, lane.value, lane.label, lane.secondaryLabel);
        const group = groups.get(lane.id)!;
        group.cardsByStage[stageId].push(issueId);
        group.cardCount++;
      }
    }
  }

  const result = [...groups.values()];
  return view === "coach" || view === "player" ? result.sort((a, b) => a.label.localeCompare(b.label)) : result;
};

export const getSwimlaneLaneUpdate = (
  view: Exclude<SwimlaneView, "stage">,
  sourceLane: string,
  targetLane: string,
  assigneeIds: string[],
  recipientIds: string[] = []
):
  | { issuePatch: { assignee_ids: string[] }; cardPatch?: never }
  | {
      cardPatch: { player_ids?: string[]; position_group?: string; card_type?: string; priority?: string };
      issuePatch?: never;
    } => {
  if (view === "coach") {
    const previousCoach = sourceLane.startsWith("coach-") ? sourceLane.slice(6) : "";
    const nextCoach = targetLane.startsWith("coach-") ? targetLane.slice(6) : "";
    if (!nextCoach || nextCoach === "unassigned") throw new Error("Select an assigned coach lane.");
    const nextAssignees = assigneeIds.filter((id) => id !== previousCoach);
    if (!nextAssignees.includes(nextCoach)) nextAssignees.push(nextCoach);
    return { issuePatch: { assignee_ids: nextAssignees } };
  }
  if (view === "player") {
    if (targetLane.startsWith("player-") && targetLane !== "player-unassigned") {
      const nextId = targetLane.slice(7);
      const previousId = sourceLane.startsWith("player-") ? sourceLane.slice(7) : "";
      const retained = sourceLane.startsWith("position-") ? [] : recipientIds.filter((id) => id !== previousId);
      return { cardPatch: { player_ids: retained.includes(nextId) ? retained : [...retained, nextId] } };
    }
    if (targetLane.startsWith("position-")) {
      return { cardPatch: { position_group: targetLane.slice(9) } };
    }
    throw new Error("Select a player or position group lane.");
  }
  if (view === "card_type") {
    const cardType = targetLane.startsWith("type-") ? targetLane.slice(5) : "";
    if (!CARD_TYPE_LANES.some(([value]) => value === cardType)) throw new Error("Select a card type lane.");
    return { cardPatch: { card_type: cardType } };
  }
  if (view === "priority") {
    const priority = targetLane.startsWith("priority-") ? targetLane.slice(9) : "";
    if (!PRIORITY_LANES.some(([value]) => value === priority)) throw new Error("Select a priority lane.");
    return { cardPatch: { priority } };
  }
  throw new Error("Aging is calculated automatically.");
};
