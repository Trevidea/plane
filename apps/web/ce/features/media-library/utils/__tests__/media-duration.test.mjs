import assert from "node:assert/strict";
import test from "node:test";

import { formatMediaDurationLabel } from "../media-duration.ts";

test("formatMediaDurationLabel renders numeric seconds as HH:MM:SS", () => {
  assert.equal(formatMediaDurationLabel(10), "00:00:10");
  assert.equal(formatMediaDurationLabel("65.4"), "00:01:05");
  assert.equal(formatMediaDurationLabel(3661), "01:01:01");
});

test("formatMediaDurationLabel normalizes existing time labels", () => {
  assert.equal(formatMediaDurationLabel("3:09"), "00:03:09");
  assert.equal(formatMediaDurationLabel("1:02:03"), "01:02:03");
});

test("formatMediaDurationLabel omits empty placeholders", () => {
  assert.equal(formatMediaDurationLabel(""), "");
  assert.equal(formatMediaDurationLabel("-"), "");
  assert.equal(formatMediaDurationLabel(Number.POSITIVE_INFINITY), "");
  assert.equal(formatMediaDurationLabel(-1), "");
  assert.equal(formatMediaDurationLabel("-1"), "");
});
