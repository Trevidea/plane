import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's type stripping requires an extension.
import { getSwimlaneLaneUpdate, groupCardsBySwimlane } from "../coaching-swimlane-model.ts";

const cards = {
  a: {
    id: "a",
    state_id: "identified",
    assignee_ids: ["john", "mike"],
    created_at: "2026-09-20T12:00:00Z",
    coaching_card_data: {
      player: { id: "p1", name: "Cody Simon", jersey_number: "10", position: "ILB" },
      card_type: "Correction",
      priority: "Game Plan Critical",
    },
  },
  b: {
    id: "b",
    state_id: "assigned",
    assignee_ids: ["john"],
    created_at: "2026-09-23T12:00:00Z",
    coaching_card_data: {
      player: null,
      position_group: "Wide Receiver",
      card_type: "Positive Reinforcement",
      priority: "Standard",
    },
  },
  c: {
    id: "c",
    state_id: "identified",
    assignee_ids: [],
    created_at: "2026-09-25T12:00:00Z",
    coaching_card_data: {
      player: { id: "p2", name: "Bryson Green", jersey_number: "5", position: "WR" },
      card_type: "Opponent Scout",
      priority: "Developmental",
    },
  },
};
const stages = { identified: ["a", "c"], assigned: ["b"] };
const now = new Date("2026-09-29T12:00:00Z");

test("includes a card in each assigned coach lane", () => {
  const groups = groupCardsBySwimlane(stages, cards, "coach", now);
  assert.deepEqual(groups.find((group) => group.id === "coach-john")?.cardsByStage, {
    identified: ["a"],
    assigned: ["b"],
  });
  assert.equal(groups.find((group) => group.id === "coach-mike")?.cardCount, 1);
  assert.deepEqual(groups.find((group) => group.id === "coach-unassigned")?.cardsByStage.identified, ["c"]);
});

test("does not group cards absent from the filtered stage results", () => {
  const groups = groupCardsBySwimlane({ identified: ["a"] }, cards, "player", now);
  assert.deepEqual(
    groups.map((group) => group.id),
    ["player-p1"]
  );
  assert.equal(groups[0].cardCount, 1);
});

test("keeps player cards and position-group cards in separate lanes", () => {
  const groups = groupCardsBySwimlane(stages, cards, "player", now);
  assert.equal(groups.find((group) => group.id === "player-p1")?.secondaryLabel, "#10 · ILB");
  assert.deepEqual(groups.find((group) => group.id === "position-Wide Receiver")?.cardsByStage.assigned, ["b"]);
});

test("shows an available player lane even when filtered cards leave it empty", () => {
  const groups = groupCardsBySwimlane(stages, cards, "player", now, [
    { id: "player-p3", value: "p3", label: "Marcus Lane", secondaryLabel: "#7 · RB" },
  ]);
  assert.deepEqual(groups.find((group) => group.id === "player-p3")?.cardsByStage, {
    identified: [],
    assigned: [],
  });
});

test("maps stored card types and priorities to their requested lanes", () => {
  const byType = groupCardsBySwimlane(stages, cards, "card_type", now);
  const byPriority = groupCardsBySwimlane(stages, cards, "priority", now);
  assert.deepEqual(byType.find((group) => group.label === "Reinforcement")?.cardsByStage.assigned, ["b"]);
  assert.deepEqual(byType.find((group) => group.label === "Scout")?.cardsByStage.identified, ["c"]);
  assert.deepEqual(byPriority.find((group) => group.label === "Game-Plan Critical")?.cardsByStage.identified, ["a"]);
});

test("aging is recalculated from start date or creation date with no overlap at day ten", () => {
  const agingCards = {
    ...cards,
    a: { ...cards.a, start_date: "2026-09-19" },
    b: { ...cards.b, start_date: null },
  };
  const groups = groupCardsBySwimlane(stages, agingCards, "aging", now);
  assert.deepEqual(groups.find((group) => group.id === "overdue")?.cardsByStage.identified, ["a"]);
  assert.deepEqual(groups.find((group) => group.id === "attention")?.cardsByStage.assigned, ["b"]);
  assert.deepEqual(groups.find((group) => group.id === "fresh")?.cardsByStage.identified, ["c"]);
});

test("moving between coach lanes keeps other assignees", () => {
  assert.deepEqual(getSwimlaneLaneUpdate("coach", "coach-john", "coach-alex", ["john", "mike"]), {
    issuePatch: { assignee_ids: ["mike", "alex"] },
  });
});

test("player and type lane moves use coaching card update fields", () => {
  assert.deepEqual(getSwimlaneLaneUpdate("player", "player-p1", "position-Wide Receiver", []), {
    cardPatch: { position_group: "Wide Receiver" },
  });
  assert.deepEqual(getSwimlaneLaneUpdate("card_type", "type-Correction", "type-Opponent Scout", []), {
    cardPatch: { card_type: "Opponent Scout" },
  });
});

test("aging and unassigned player lanes reject manual reassignment", () => {
  assert.throws(() => getSwimlaneLaneUpdate("aging", "fresh", "stale", []));
  assert.throws(() => getSwimlaneLaneUpdate("player", "player-p1", "player-unassigned", []));
});
