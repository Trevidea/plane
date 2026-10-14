import assert from "node:assert/strict";
import test from "node:test";
import { canEditCoachingCardRecipients } from "../coaching-card-recipient-policy.ts";

const roles = ["identified", "assigned", "reviewed", "practice", "verified", "closed"];
const config = {
  initial_stage_id: "s0",
  stages: roles.map((lifecycle_role, order) => ({ id: `s${order}`, name: `Custom ${order}`, lifecycle_role, order })),
};

test("only the initial and assigned lifecycle stages allow recipient editing", () => {
  assert.deepEqual(
    config.stages.map((stage) => canEditCoachingCardRecipients(config, stage.id)),
    [true, true, false, false, false, false]
  );
});

test("renaming or reordering states does not change role-based recipient permissions", () => {
  const renamed = {
    ...config,
    stages: config.stages.map((stage, index) => ({ ...stage, name: "Renamed", order: 6 - index })),
  };
  assert.equal(canEditCoachingCardRecipients(renamed, "s1"), true);
  assert.equal(canEditCoachingCardRecipients(renamed, "s4"), false);
  const legacy = { ...config, stages: [{ id: "legacy", name: "Legacy intake", order: -1 }, ...config.stages] };
  assert.equal(canEditCoachingCardRecipients(legacy, "legacy"), false);
});

test("legacy configurations use the first two configured positions, not array order or names", () => {
  const legacy = {
    ...config,
    stages: config.stages.map(({ lifecycle_role, ...stage }) => ({ ...stage, lifecycle_role: "" })).reverse(),
  };
  assert.deepEqual(
    legacy.stages.map((stage) => canEditCoachingCardRecipients(legacy, stage.id)),
    [false, false, false, false, true, true]
  );
});

test("missing configuration, unknown states and incomplete role mappings fail closed", () => {
  assert.equal(canEditCoachingCardRecipients(undefined, "s0"), false);
  assert.equal(canEditCoachingCardRecipients(config, "unknown"), false);
  assert.equal(canEditCoachingCardRecipients(config, null), false);
  assert.equal(canEditCoachingCardRecipients({ ...config, stages: [] }, "s0"), false);
  const partial = { ...config, stages: [{ id: "legacy", order: 0 }, config.stages[1]] };
  assert.equal(canEditCoachingCardRecipients(partial, "legacy"), false);
});
