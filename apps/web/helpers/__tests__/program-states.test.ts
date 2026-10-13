import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's type stripping requires an extension.
import * as programStates from "../program-states.ts";

const { getProgramLifecycleStates, getProgramStateGroups, getProgramStateColumns, mergeProgramStateIssues } =
  programStates;
const states = [
  { id: "film", name: "Film Tagged", group: "backlog", sequence: 0 },
  { id: "unassigned", name: "Unassigned", group: "backlog", sequence: 1, default: true },
  { id: "assigned", name: "Assigned", group: "unstarted", sequence: 1 },
  { id: "practice", name: "Practice Check", group: "started", sequence: 10 },
  { id: "reviewed", name: "Player Reviewed", group: "started", sequence: 5 },
  { id: "verified", name: "Verified on Film", group: "completed", sequence: 1 },
  { id: "cancelled", name: "Cancelled", group: "cancelled", sequence: 1 },
];

test("settings and board select exactly five states by default and sequence, independent of names", () => {
  const snapshot = structuredClone(states);
  assert.deepEqual(
    getProgramLifecycleStates(states).map((state) => state.id),
    ["unassigned", "assigned", "reviewed", "verified", "cancelled"]
  );
  assert.deepEqual(
    getProgramLifecycleStates(states.map((state) => ({ ...state, name: `Renamed ${state.id}` })).reverse()).map(
      (state) => state.id
    ),
    ["unassigned", "assigned", "reviewed", "verified", "cancelled"]
  );
  assert.deepEqual(states, snapshot);
  assert.deepEqual(
    getProgramStateColumns([...states].reverse(), getProgramStateGroups(states)).map((state) => state.name),
    ["Unassigned", "Assigned", "Player Reviewed", "Verified on Film", "Cancelled"]
  );
});

test("extra-state cards remain visible in their representative column without changing state records", () => {
  const grouped = {
    film: ["clip"],
    unassigned: ["new"],
    assigned: [],
    practice: ["drill"],
    reviewed: ["watch"],
    verified: [],
    cancelled: ["closed"],
  };
  const snapshot = structuredClone(grouped);
  const result = mergeProgramStateIssues(grouped, getProgramStateGroups(states));
  assert.deepEqual(result, {
    unassigned: ["clip", "new"],
    assigned: [],
    reviewed: ["watch", "drill"],
    verified: [],
    cancelled: ["closed"],
  });
  assert.deepEqual(Object.values(result).flat().sort(), ["clip", "closed", "drill", "new", "watch"]);
  assert.deepEqual(grouped, snapshot);
});

test("subgroup cards and merged sorting are preserved with no duplicate cards", () => {
  const result = mergeProgramStateIssues(
    {
      film: { coachA: ["z", "same"], coachB: ["b"] },
      unassigned: { coachA: ["a", "same"] },
      reviewed: { coachA: ["r"] },
      practice: { coachB: ["p"] },
    },
    getProgramStateGroups(states),
    (ids) => [...ids].sort()
  );
  assert.deepEqual(result.unassigned, { coachA: ["a", "same", "z"], coachB: ["b"] });
  assert.deepEqual(result.reviewed, { coachA: ["r"], coachB: ["p"] });
});

test("sequence ties use stable IDs and an unconfigured program has no invented state IDs", () => {
  assert.deepEqual(getProgramLifecycleStates([]), []);
  assert.deepEqual(getProgramStateGroups([]), {});
  assert.equal(
    getProgramLifecycleStates([
      { ...states[0], id: "z", sequence: 1 },
      { ...states[0], id: "a", sequence: 1 },
    ])[0].id,
    "a"
  );
});

test("six stored roles expose practice, verification and closure separately after arbitrary renaming", () => {
  const configured = states.map((state) => ({
    ...state,
    name: `Coach label ${state.id}`,
    lifecycle_role:
      (
        {
          unassigned: "identified",
          assigned: "assigned",
          reviewed: "reviewed",
          practice: "practice",
          verified: "verified",
          cancelled: "closed",
        } as Record<string, string>
      )[state.id] ?? "",
  }));
  assert.deepEqual(
    getProgramLifecycleStates(configured.reverse()).map((state) => state.id),
    ["unassigned", "assigned", "reviewed", "practice", "verified", "cancelled"]
  );
  const groups = getProgramStateGroups(configured);
  assert.deepEqual(groups.reviewed, ["reviewed"]);
  assert.deepEqual(groups.practice, ["practice"]);
  assert.deepEqual(
    mergeProgramStateIssues(
      { reviewed: ["watch"], practice: ["drill"], verified: ["approve"], cancelled: ["close"] },
      groups
    ),
    {
      unassigned: [],
      assigned: [],
      reviewed: ["watch"],
      practice: ["drill"],
      verified: ["approve"],
      cancelled: ["close"],
    }
  );
});
