import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's type stripping requires an extension.
import { canTransitionCard, orderCardColumns } from "../coaching-card-stage-model.ts";

const config = {
  sport: "Basketball",
  initial_stage_id: "new",
  stages: [
    {
      id: "new",
      name: "New",
      order: 0,
      abbreviation: "N",
      allowed_next_stage_ids: ["review", "done"],
    },
    {
      id: "review",
      name: "Review",
      order: 1,
      abbreviation: "R",
      allowed_next_stage_ids: ["new", "done"],
    },
    { id: "done", name: "Done", order: 2, abbreviation: "D", allowed_next_stage_ids: ["new", "review"] },
  ],
};

test("coaches can move to any other configured stage", () => {
  assert.equal(canTransitionCard(config, "new", "review"), true);
  assert.equal(canTransitionCard(config, "new", "done"), true);
  assert.equal(canTransitionCard(config, "review", "new"), true);
  assert.equal(canTransitionCard(config, "done", "new"), true);
  assert.equal(canTransitionCard(config, "new", "new"), false);
});

test("board columns follow configuration order", () => {
  assert.deepEqual(
    orderCardColumns([{ id: "done" }, { id: "none" }, { id: "new" }, { id: "review" }], config).map(
      (column) => column.id
    ),
    ["new", "review", "done", "none"]
  );
});
