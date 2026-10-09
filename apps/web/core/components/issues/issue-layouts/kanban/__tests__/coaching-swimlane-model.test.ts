import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's type stripping requires an extension.
import { getSwimlaneLaneUpdate, groupCardsBySwimlane } from "../coaching-swimlane-model.ts";

const cards = {
  a: {
    id: "a",
    state_id: "identified",
    assignee_ids: ["john", "mike"],
    created_by: "john",
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
    created_by: "mike",
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

test("coach lanes group by the creator rather than assignees, without duplicating cards", () => {
  const groups = groupCardsBySwimlane(stages, cards, "coach", now);
  assert.deepEqual(groups.find((group) => group.id === "coach-john")?.cardsByStage, {
    identified: ["a"],
    assigned: [],
  });
  assert.deepEqual(groups.find((group) => group.id === "coach-mike")?.cardsByStage, {
    identified: [],
    assigned: ["b"],
  });
  assert.deepEqual(groups.find((group) => group.id === "coach-unassigned")?.cardsByStage.identified, ["c"]);
  assert.equal(
    groups.reduce((count, group) => count + group.cardCount, 0),
    3
  );
});

test("unassigned cards appear under their creator, with legacy author metadata as a fallback", () => {
  const creatorCards = {
    a: { ...cards.a, assignee_ids: [] },
    c: {
      ...cards.c,
      coaching_card_data: { ...cards.c.coaching_card_data, metadata: { author: { id: "alex", name: "Alex Coach" } } },
    },
  };
  const groups = groupCardsBySwimlane({ identified: ["a", "c"] }, creatorCards, "coach", now);
  assert.deepEqual(groups.find((group) => group.id === "coach-john")?.cardsByStage.identified, ["a"]);
  assert.equal(groups.find((group) => group.id === "coach-alex")?.label, "Alex Coach");
  assert.equal(
    groups.some((group) => group.id === "coach-unassigned"),
    false
  );
});

test("the issue creator takes precedence over older metadata and uses the member's display name", () => {
  const issue = {
    ...cards.b,
    coaching_card_data: { ...cards.b.coaching_card_data, metadata: { author: { id: "john", name: "John Coach" } } },
  };
  const groups = groupCardsBySwimlane({ assigned: ["b"] }, { b: issue }, "coach", now, [
    { id: "coach-mike", value: "mike", label: "Mike Coach" },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].label, "Mike Coach");
  assert.deepEqual(groups[0].cardsByStage.assigned, ["b"]);
});

test("does not group cards absent from the filtered stage results", () => {
  const groups = groupCardsBySwimlane({ identified: ["a"] }, cards, "player", now);
  assert.deepEqual(groups.map((group) => group.id).sort(), ["player-p1"]);
  assert.equal(groups[0].cardCount, 1);
});

test("keeps player cards and position-group cards in separate lanes", () => {
  const groups = groupCardsBySwimlane(stages, cards, "player", now);
  assert.equal(groups.find((group) => group.id === "player-p1")?.secondaryLabel, "#10 · ILB");
  assert.deepEqual(groups.find((group) => group.id === "position-Wide Receiver")?.cardsByStage.assigned, ["b"]);
});

test("one broadcast card appears in every recipient lane without creating another card", () => {
  const broadcast = {
    ...cards.a,
    coaching_card_data: {
      ...cards.a.coaching_card_data,
      player: null,
      recipients: [
        { id: "p1", name: "Cody Simon", jersey_number: "10", position: "ILB" },
        { id: "p2", name: "Bryson Green", jersey_number: "5", position: "WR" },
      ],
    },
  };
  const groups = groupCardsBySwimlane({ identified: ["a"] }, { a: broadcast }, "player", now);
  assert.deepEqual(groups.map((group) => group.id).sort(), ["player-p1", "player-p2"]);
  assert.deepEqual(
    groups.map((group) => group.cardsByStage.identified),
    [["a"], ["a"]]
  );
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

test("moving across creator lanes cannot reassign a coach or change the author", () => {
  assert.throws(() => getSwimlaneLaneUpdate("coach", "coach-john", "coach-alex", ["john", "mike"]), /created/);
});

test("player and type lane moves use coaching card update fields", () => {
  assert.deepEqual(getSwimlaneLaneUpdate("player", "player-p1", "player-p3", [], ["p1", "p2"]), {
    cardPatch: { player_ids: ["p2", "p3"] },
  });
  assert.deepEqual(getSwimlaneLaneUpdate("player", "player-p1", "player-p2", [], ["p1", "p2"]), {
    cardPatch: { player_ids: ["p2"] },
  });
  assert.deepEqual(getSwimlaneLaneUpdate("player", "position-Forward", "player-p3", [], ["p1", "p2"]), {
    cardPatch: { player_ids: ["p3"] },
  });
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
