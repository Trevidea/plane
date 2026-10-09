import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node type stripping requires the extension.
import { cardPeekUrl, cardIdFromUrl, canActivateCard, cardStageProgress } from "../model.ts";

const id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
test("opening and closing preserve board filters, grouping and hash", () => {
  const board = "/team/projects/project/issues/?sport=Football&group_by=state#lane";
  assert.equal(cardPeekUrl(board, id), `${board.split("#")[0]}&card=${id}#lane`);
  assert.equal(cardPeekUrl(cardPeekUrl(board, id), null), board);
});
test("opening another card replaces the selection parameter", () => {
  const next = "11111111-2222-4333-8444-555555555555";
  const url = cardPeekUrl(cardPeekUrl("/board?filter=mine", id), next);
  assert.equal(cardIdFromUrl(url), next);
  assert.equal(new URL(url, "https://plane.test").searchParams.getAll("card").length, 1);
});
test("invalid or missing deep link selections are ignored", () => {
  assert.equal(cardIdFromUrl("/board?card=COR-142"), null);
  assert.equal(cardIdFromUrl("/board?card=%3Cscript%3E"), null);
  assert.equal(cardIdFromUrl("/board"), null);
  assert.equal(cardIdFromUrl(`/board?card=${id}`), id);
});
test("drag release and nested controls cannot open a card", () => {
  assert.equal(canActivateCard({ now: 100, suppressUntil: 400, interactive: false }), false);
  assert.equal(canActivateCard({ now: 500, suppressUntil: 400, interactive: true }), false);
  assert.equal(canActivateCard({ now: 500, suppressUntil: 400, interactive: false }), true);
});
test("progress follows the selected sport's ordered configuration without mutating it", () => {
  const stages = [
    { id: "done", name: "Verified", order: 2 },
    { id: "new", name: "Observed", order: 0 },
    { id: "work", name: "Working", order: 1 },
  ];
  assert.deepEqual(
    cardStageProgress(stages, "work").map(({ id, status }) => [id, status]),
    [
      ["new", "completed"],
      ["work", "current"],
      ["done", "future"],
    ]
  );
  assert.equal(stages[0].id, "done");
});
test("unknown stages are not presented as completed", () => {
  assert.deepEqual(cardStageProgress([], "unknown"), []);
  assert.equal(cardStageProgress([{ id: "one", name: "Observed", order: 0 }], "unknown")[0].status, "future");
});
