import assert from "node:assert/strict";
import test from "node:test";
// Node's type-stripping test runner requires explicit TypeScript extensions.
// @ts-expect-error See comment above.
import * as playlistDraft from "../playlist-draft.ts";
import type { SgTagRow } from "../types";

const { getDraggedPlaylistTagIds, getPlaylistDraftRows, readPlaylistTagDragData, writePlaylistTagDragData } =
  playlistDraft;

const buildRow = (id: string, overrides: Partial<SgTagRow> = {}): SgTagRow => ({
  id,
  action: "Run",
  clipId: id,
  clipEndSeconds: 18,
  clipStartSeconds: 10,
  context: {},
  groupValue: "Quarter 1",
  matrixParticipant: null,
  matrixPeriod: null,
  player: "12",
  playlistFallbackTimestamp: null,
  playlistTimestamp: "00:10-00:18",
  primaryDetail: "",
  result: "",
  secondaryDetail: "",
  sourceTagId: id,
  sourceUrl: "",
  team: "home",
  thumbnailUrl: "",
  timecode: "00:10-00:18",
  ...overrides,
});

test("dragging a selected clip carries visible selected clips in display order", () => {
  const rows = [buildRow("first"), buildRow("second"), buildRow("third")];
  assert.deepEqual(getDraggedPlaylistTagIds("third", rows, ["third", "hidden", "first"]), ["first", "third"]);
  assert.deepEqual(getDraggedPlaylistTagIds("second", rows, ["third", "first"]), ["second"]);
});

test("tag drag data copies unique IDs and rejects unrelated or malformed drop data", () => {
  const data = new Map<string, string>();
  const transfer: Pick<DataTransfer, "effectAllowed" | "setData" | "getData"> = {
    effectAllowed: "uninitialized",
    getData: (type) => data.get(type) ?? "",
    setData: (type, value) => {
      data.set(type, value);
    },
  };
  writePlaylistTagDragData(transfer, ["one", "two", "one"]);
  assert.equal(transfer.effectAllowed, "copy");
  assert.deepEqual(readPlaylistTagDragData(transfer), ["one", "two"]);
  for (const invalid of ["", "https://example.com", "{}", '["one", 2]', '[""]', "null"]) {
    assert.deepEqual(readPlaylistTagDragData({ getData: () => invalid }), []);
  }
});

test("drafts preserve drop order across additions without duplicate clips", () => {
  const rows = [buildRow("early"), buildRow("middle"), buildRow("late")];
  const firstDrop = getPlaylistDraftRows(rows, ["late", "early"]);
  const nextDrop = getPlaylistDraftRows(rows, [...firstDrop.map((row) => row.id), "early", "middle"]);
  assert.deepEqual(
    nextDrop.map((row) => row.id),
    ["late", "early", "middle"]
  );
  assert.deepEqual(
    rows.map((row) => row.id),
    ["early", "middle", "late"]
  );
});

test("drafts resolve current event rows and skip missing or unplayable clips", () => {
  const updatedRow = buildRow("updated", { action: "Edited title" });
  const rows = [
    updatedRow,
    buildRow("fallback", { playlistTimestamp: null, playlistFallbackTimestamp: "00:20-00:28" }),
    buildRow("unplayable", { playlistTimestamp: " " }),
  ];
  assert.deepEqual(getPlaylistDraftRows(rows, ["deleted", "updated", "other-event", "unplayable", "fallback"]), [
    updatedRow,
    rows[1],
  ]);
  assert.deepEqual(getPlaylistDraftRows(rows, []), []);
});
