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

test("board columns preserve the current settings order even when cached coaching stages disagree", () => {
  const columns = [
    { id: "identified", group: "backlog", sequence: 5000 },
    { id: "assigned", group: "backlog", sequence: 9000 },
    { id: "film", group: "unstarted", sequence: 1 },
    { id: "reviewed", group: "started", sequence: 5 },
    { id: "practice", group: "started", sequence: 10 },
    { id: "verified", group: "completed", sequence: 1 },
    { id: "cancelled", group: "cancelled", sequence: 1 },
  ];
  const staleConfig = {
    ...config,
    stages: columns
      .slice()
      .reverse()
      .map((column, order) => ({
        id: column.id,
        name: column.id,
        order,
        abbreviation: "",
        allowed_next_stage_ids: [],
      })),
  };
  assert.deepEqual(
    orderCardColumns(
      [columns[0], columns[3], columns[1], columns[4], columns[2], columns[5], columns[6]],
      staleConfig
    ).map((column) => column.id),
    ["identified", "assigned", "film", "reviewed", "practice", "verified", "cancelled"]
  );
});

test("next actions follow settings order instead of stale lifecycle order", () => {
  const states = [
    { id: "identified", name: "Identified", group: "backlog", sequence: 5 },
    { id: "assigned", name: "Assigned", group: "backlog", sequence: 10 },
    { id: "film", name: "Film Tagged", group: "unstarted", sequence: 1 },
    { id: "reviewed", name: "Player Reviewed", group: "started", sequence: 1 },
    { id: "practice", name: "Practice Check", group: "started", sequence: 5 },
  ];
  const stale = {
    ...config,
    stages: [states[0], states[3], states[1], states[4], states[2]].map((state, order, all) => ({
      id: state.id,
      name: state.name,
      order,
      abbreviation: "",
      allowed_next_stage_ids: all.filter((_, index) => Math.abs(index - order) === 1).map((state) => state.id),
    })),
  };
  const aligned = cardStages.alignCardStageConfig(stale, states);
  assert.equal(getCardStageActions(aligned, "identified").next?.name, "Assigned");
  assert.equal(getCardStageActions(aligned, "assigned").next?.name, "Film Tagged");
  assert.equal(getCardStageActions(aligned, "film").next?.name, "Player Reviewed");
  assert.equal(getCardTransitionIntent(aligned, "assigned", "film").kind, "move");
  assert.equal(getCardTransitionIntent(aligned, "assigned", "practice").kind, "blocked");
  assert.equal(getCardStageActions(aligned, "practice").next, null);
  assert.equal(
    cardStages.alignCardStageConfig(coachingConfig, [])!.stages[1].allowed_next_stage_ids.includes("s2"),
    false
  );
});

test("settings alignment retains automatic review restrictions", () => {
  const states = coachingConfig.stages.map((stage, sequence) => ({ ...stage, group: "backlog", sequence }));
  const aligned = cardStages.alignCardStageConfig(coachingConfig, states);
  assert.equal(getCardStageActions(aligned, "s1").next, null);
  const reordered = cardStages.alignCardStageConfig(
    {
      ...coachingConfig,
      stages: coachingConfig.stages.map((stage, index) => ({ ...stage, order: 4 - index })),
    },
    states
  );
  assert.equal(getCardStageActions(reordered, "s1").next, null);
  assert.equal(getCardStageActions(reordered, "s2").next?.id, "s3");
});
