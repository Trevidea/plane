import type { TGroupedIssues, TSubGroupedIssues } from "@plane/types";

const PROGRAM_STATE_GROUPS = ["backlog", "unstarted", "started", "completed", "cancelled"];

type ProgramState = { id: string; group: string; sequence: number; default?: boolean; lifecycle_role?: string };
const PROGRAM_LIFECYCLE_ROLES = ["identified", "assigned", "reviewed", "practice", "verified", "closed"];
export type TProgramStateGroups = Record<string, string[]>;

export const getProgramStateColumns = <T extends { id: string }>(
  columns: T[],
  stateGroups: TProgramStateGroups
): T[] => {
  const byId = new Map(columns.map((column) => [column.id, column]));
  return Object.keys(stateGroups).flatMap((id) => byId.get(id) ?? []);
};

const orderedStates = <T extends ProgramState>(states: T[]) =>
  [...states].sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id));

export const getProgramLifecycleStates = <T extends ProgramState>(states: T[]): T[] => {
  if (states.some((state) => state.lifecycle_role))
    return PROGRAM_LIFECYCLE_ROLES.flatMap(
      (role) => orderedStates(states).find((state) => state.lifecycle_role === role) ?? []
    );
  return PROGRAM_STATE_GROUPS.flatMap((group) => {
    const members = orderedStates(states.filter((state) => state.group === group));
    const representative = members.find((state) => state.default) ?? members[0];
    return representative ? [representative] : [];
  });
};

export const getProgramStateGroups = (states: ProgramState[]): TProgramStateGroups => {
  const representatives = getProgramLifecycleStates(states);
  const selectedIds = new Set(representatives.map((state) => state.id));
  return Object.fromEntries(
    representatives.map((state) => [
      state.id,
      orderedStates(
        states.filter(
          (member) =>
            member.id === state.id ||
            (!selectedIds.has(member.id) &&
              member.group === state.group &&
              representatives.find((item) => item.group === state.group)?.id === state.id)
        )
      ).map((member) => member.id),
    ])
  );
};

// Fold only the board's display groups. Persisted state IDs and lifecycle policy
// remain untouched, including cards assigned to additional legacy states.
export const mergeProgramStateIssues = (
  groupedIssues: TGroupedIssues | TSubGroupedIssues,
  stateGroups: TProgramStateGroups,
  sortIssueIds: (ids: string[]) => string[] = (ids) => ids
): TGroupedIssues | TSubGroupedIssues => {
  const subGrouped = Object.values(groupedIssues).some((value) => !Array.isArray(value));
  const merge = (ids: string[]) => sortIssueIds([...new Set(ids)]);
  return Object.fromEntries(
    Object.entries(stateGroups).map(([columnId, sourceIds]) => {
      if (!subGrouped) return [columnId, merge(sourceIds.flatMap((id) => (groupedIssues as TGroupedIssues)[id] ?? []))];

      const subGroups: Record<string, string[]> = {};
      for (const id of sourceIds) {
        for (const [subGroupId, ids] of Object.entries((groupedIssues as TSubGroupedIssues)[id] ?? {})) {
          subGroups[subGroupId] = [...(subGroups[subGroupId] ?? []), ...ids];
        }
      }
      return [columnId, Object.fromEntries(Object.entries(subGroups).map(([id, ids]) => [id, merge(ids)]))];
    })
  );
};
