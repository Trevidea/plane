import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const modelUrl = new URL("../coaching-card-menu-model.ts", import.meta.url);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === modelUrl.href && specifier === "./coaching-card-stage-model")
      return nextResolve(new URL("../coaching-card-stage-model.ts", import.meta.url).href, context);
    return nextResolve(specifier, context);
  },
});
const { getCoachingCardMenuStages, getCoachingCardPriorityChange, getCoachingCardAgeDays } = await import(
  modelUrl.href
);

const configuration = (names = ["Identified", "Assigned", "In Work", "Ready for Coach Review", "Resolved"]) => ({
  sport: "Football",
  initial_stage_id: "s0",
  stages: names.map((name, index) => ({
    id: `s${index}`,
    name,
    order: index,
    abbreviation: name[0],
    allowed_next_stage_ids: [index - 1, index + 1]
      .filter((other) => other >= 0 && other < names.length && !(index === 1 && other === 2))
      .map((other) => `s${other}`),
  })),
});

test("initial-stage menu offers assignment with no backward destination", () => {
  const model = getCoachingCardMenuStages(configuration(), "s0");
  assert.equal(model.primaryLabel, "Assign to Player");
  assert.equal(model.primaryHint, "coach");
  assert.equal(model.next.id, "s1");
  assert.equal(model.showPrimaryAction, true);
  assert.equal(model.previous, undefined);
});

test("Assigned exposes the automatic action without a manual transition", () => {
  const model = getCoachingCardMenuStages(configuration(), "s1");
  assert.equal(model.primaryLabel, "Move to In Work");
  assert.equal(model.primaryHint, "auto - on clip completion");
  assert.equal(model.next, null);
  assert.equal(model.showPrimaryAction, true);
  assert.equal(model.previous.id, "s0");
});

test("later stages use the current board names and exactly one previous stage", () => {
  const config = configuration();
  const work = getCoachingCardMenuStages(config, "s2");
  assert.equal(work.primaryLabel, "Mark Ready for Coach Review");
  assert.equal(work.primaryHint, "coach-gated");
  assert.equal(work.next.id, "s3");
  assert.equal(work.previous.id, "s1");
  assert.equal(getCoachingCardMenuStages(config, "s3").primaryLabel, "Mark Resolved");
  const resolved = getCoachingCardMenuStages(config, "s4");
  assert.equal(resolved.primaryLabel, "No next stage");
  assert.equal(resolved.next, null);
  assert.equal(resolved.showPrimaryAction, false);
  assert.equal(resolved.previous.id, "s3");
});

test("the three reference stage names retain their intended menu actions", () => {
  const config = configuration(["Film Tagged", "Assigned", "Player Reviewed", "Practice Check", "Verified on Film"]);
  assert.equal(getCoachingCardMenuStages(config, "s0").primaryLabel, "Assign to Player");
  assert.equal(getCoachingCardMenuStages(config, "s1").primaryLabel, "Move to Player Reviewed");
  assert.equal(getCoachingCardMenuStages(config, "s2").primaryLabel, "Mark Practice Check");
});

test("missing or unknown configuration cannot offer an executable transition", () => {
  for (const model of [
    getCoachingCardMenuStages(undefined, "s1"),
    getCoachingCardMenuStages(configuration(), "other"),
  ]) {
    assert.equal(model.primaryLabel, "Stage unavailable");
    assert.equal(model.next, null);
    assert.equal(model.showPrimaryAction, false);
    assert.equal(model.previous, undefined);
  }
});

test("menu preserves configured order, adjacency and transition restrictions", () => {
  const config = configuration();
  config.stages.reverse();
  const snapshot = structuredClone(config);
  const model = getCoachingCardMenuStages(config, "s2");
  assert.equal(model.previous.id, "s1");
  assert.equal(model.next.id, "s3");
  assert.deepEqual(config, snapshot);
  config.stages.find((stage) => stage.id === "s2").allowed_next_stage_ids = [];
  const restricted = getCoachingCardMenuStages(config, "s2");
  assert.equal(restricted.previous, undefined);
  assert.equal(restricted.next, null);
  assert.equal(restricted.showPrimaryAction, false);
});

test("priority changes use coaching priority, one level at a time", () => {
  assert.equal(getCoachingCardPriorityChange("Developmental", "raise"), "Standard");
  assert.equal(getCoachingCardPriorityChange("Standard", "raise"), "Game Plan Critical");
  assert.equal(getCoachingCardPriorityChange("Game Plan Critical", "lower"), "Standard");
  assert.equal(getCoachingCardPriorityChange("Standard", "lower"), "Developmental");
  assert.equal(getCoachingCardPriorityChange(undefined, "raise"), "Game Plan Critical");
});

test("priority limits and unrecognized legacy priorities do not wrap or guess", () => {
  assert.equal(getCoachingCardPriorityChange("Game Plan Critical", "raise"), undefined);
  assert.equal(getCoachingCardPriorityChange("Developmental", "lower"), undefined);
  assert.equal(getCoachingCardPriorityChange("urgent", "raise"), undefined);
});

test("menu age handles invalid, future and partial-day dates", () => {
  const now = Date.parse("2026-10-12T12:00:00Z");
  assert.equal(getCoachingCardAgeDays("2026-10-10T12:00:00Z", now), 2);
  assert.equal(getCoachingCardAgeDays("2026-10-12T11:59:00Z", now), 0);
  assert.equal(getCoachingCardAgeDays("2026-10-13T12:00:00Z", now), 0);
  assert.equal(getCoachingCardAgeDays("invalid", now), 0);
});
