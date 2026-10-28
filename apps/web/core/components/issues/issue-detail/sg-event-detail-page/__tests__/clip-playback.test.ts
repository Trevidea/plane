import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node test runner requires the TypeScript extension.
import { buildClipQueue, getClipQueuePosition, getAdjacentClipIndex } from "../clip-playback.ts";
import type { SgTagRow } from "../types";

const row = (id: string, extra: Partial<SgTagRow> = {}) =>
  ({
    id,
    clipDurationSeconds: 8,
    clipStartSeconds: 100,
    clipEndSeconds: 108,
    timecode: "01:40-01:48",
    ...extra,
  }) as SgTagRow;

test("five selected eight-second tags have a 40-second timeline in selection order", () => {
  const queue = buildClipQueue([row("a"), row("b"), row("c"), row("d"), row("e")]);
  assert.deepEqual(
    queue.map(({ row, startSeconds, durationSeconds }) => [row.id, startSeconds, durationSeconds]),
    [
      ["a", 0, 8],
      ["b", 8, 8],
      ["c", 16, 8],
      ["d", 24, 8],
      ["e", 32, 8],
    ]
  );
  assert.equal(queue.at(-1)!.startSeconds + queue.at(-1)!.durationSeconds, 40);
});

test("only duplicate row IDs are removed, including clips sharing source timestamps", () => {
  assert.deepEqual(
    buildClipQueue([row("a"), row("a"), row("b")]).map(({ row }) => row.id),
    ["a", "b"]
  );
});

test("previous and next visit all five clips and wrap at both ends", () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((i) => getAdjacentClipIndex(i, 1, 5)),
    [1, 2, 3, 4, 0]
  );
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((i) => getAdjacentClipIndex(i, -1, 5)),
    [4, 0, 1, 2, 3]
  );
  assert.equal(getAdjacentClipIndex(0, 1, 0), null);
});

test("cumulative seeking resolves clip boundaries and clamps outside the queue", () => {
  const queue = buildClipQueue([row("a"), row("b"), row("c"), row("d"), row("e")]);
  for (const [seconds, index, offset] of [
    [-1, 0, 0],
    [8, 1, 0],
    [19, 2, 3],
    [33, 4, 1],
    [90, 4, 8],
  ]) {
    assert.deepEqual(getClipQueuePosition(queue, seconds), { index, offsetSeconds: offset });
  }
  assert.equal(getClipQueuePosition([], 10), null);
});

test("duration uses valid metadata, ranges, and timecodes without propagating invalid values", () => {
  const queue = buildClipQueue([
    row("metadata", { clipDurationSeconds: 6 }),
    row("range", { clipDurationSeconds: null, clipStartSeconds: 20, clipEndSeconds: 25 }),
    row("clock", { clipDurationSeconds: NaN, clipStartSeconds: null, clipEndSeconds: null, timecode: "01:00–01:04" }),
    row("unknown", { clipDurationSeconds: -1, clipStartSeconds: null, clipEndSeconds: null, timecode: "--" }),
  ]);
  assert.deepEqual(
    queue.map(({ durationSeconds }) => durationSeconds),
    [6, 5, 4, 0]
  );
  assert.equal(getClipQueuePosition(queue, NaN)?.index, 0);
});
