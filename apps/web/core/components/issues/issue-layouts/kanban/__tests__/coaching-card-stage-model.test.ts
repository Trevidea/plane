import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's type stripping requires an extension.
import * as cardStages from "../coaching-card-stage-model.ts";

const { canTransitionCard, getCardStageActions, getCardTransitionIntent, orderCardColumns } = cardStages;

const config = {
  sport: "Basketball",
  initial_stage_id: "new",
  stages: [
    {
      id: "new",
      name: "New",
      order: 0,
      abbreviation: "N",
      allowed_next_stage_ids: ["review"],
    },
    {
      id: "review",
      name: "Review",
      order: 1,
      abbreviation: "R",
      allowed_next_stage_ids: ["new", "done"],
    },
    { id: "done", name: "Done", order: 2, abbreviation: "D", allowed_next_stage_ids: ["review"] },
  ],
};

test("coaches can only move to adjacent permitted stages", () => {
  assert.equal(canTransitionCard(config, "new", "review"), true);
  assert.equal(canTransitionCard(config, "new", "done"), false);
  assert.equal(canTransitionCard(config, "review", "new"), true);
  assert.equal(canTransitionCard(config, "done", "new"), false);
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

test("card actions offer the next stage and other permitted stages in board order", () => {
  assert.deepEqual(
    getCardStageActions(config, "new").available.map((stage) => stage.name),
    ["Review"]
  );
  assert.equal(getCardStageActions(config, "new").next?.name, "Review");
  assert.equal(getCardStageActions(config, "done").next, null);
  assert.deepEqual(getCardStageActions(undefined, "new"), { available: [], next: null });
});

const coachingConfig = {
  sport: "Football",
  initial_stage_id: "s0",
  stages: ["Identified", "Assigned", "In Work", "Ready for Coach Review", "Resolved"].map((name, index) => ({
    id: `s${index}`,
    name,
    order: index,
    abbreviation: name[0],
    allowed_next_stage_ids: [index - 1, index + 1]
      .filter((other) => other >= 0 && other < 5 && !(index === 1 && other === 2))
      .map((other) => `s${other}`),
  })),
};

test("forward drop from the initial stage requests assignment regardless of destination", () => {
  for (const target of ["s1", "s3", "s4"]) {
    assert.deepEqual(getCardTransitionIntent(coachingConfig, "s0", target), {
      kind: "assign",
      stage: coachingConfig.stages[1],
    });
  }
});

test("Assigned never offers manual advancement or a simulated watch action", () => {
  for (const target of ["s2", "s3", "s4"]) {
    const intent = getCardTransitionIntent(coachingConfig, "s1", target);
    assert.equal(intent.kind, "blocked");
    if (intent.kind === "blocked") assert.match(intent.message, /automatic/);
  }
  assert.equal(getCardStageActions(coachingConfig, "s1").next, null);
  assert.deepEqual(
    getCardStageActions(coachingConfig, "s1").available.map((stage) => stage.id),
    ["s0"]
  );
});

test("backward drop always reopens exactly the previous stage", () => {
  for (const target of ["s0", "s1", "s2", "s3"]) {
    assert.deepEqual(getCardTransitionIntent(coachingConfig, "s4", target), {
      kind: "reopen",
      stage: coachingConfig.stages[3],
    });
  }
});

test("cached permissive configuration never exposes manual Assigned advancement", () => {
  const staleConfig = {
    ...coachingConfig,
    stages: coachingConfig.stages.map((stage) => ({
      ...stage,
      allowed_next_stage_ids: coachingConfig.stages.filter((other) => other.id !== stage.id).map((other) => other.id),
    })),
  };
  assert.equal(getCardStageActions(staleConfig, "s1").next, null);
  assert.deepEqual(
    getCardStageActions(staleConfig, "s1").available.map((stage) => stage.id),
    ["s0"]
  );
});

test("later stages permit one step forward but reject jumps", () => {
  assert.equal(getCardTransitionIntent(coachingConfig, "s2", "s3").kind, "move");
  const intent = getCardTransitionIntent(coachingConfig, "s2", "s4");
  assert.equal(intent.kind, "blocked");
  if (intent.kind === "blocked") assert.match(intent.message, /Ready for Coach Review comes first/);
  assert.equal(getCardTransitionIntent(coachingConfig, "s2", "s2").kind, "unchanged");
  assert.equal(getCardTransitionIntent(undefined, "s2", "s3").kind, "blocked");
});
