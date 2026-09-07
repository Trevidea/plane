import assert from "node:assert/strict";
import test from "node:test";

import { createCustomPlaylistClockState, updateCustomPlaylistClock } from "../custom-playlist-timeline.ts";

test("custom playlist clock starts at local zero when media retains a source timestamp", () => {
  const result = updateCustomPlaylistClock({
    durationSeconds: 20,
    isPlaying: false,
    isSeeking: false,
    mediaSeconds: 120,
    playbackRate: 1,
    state: createCustomPlaylistClockState(),
    wallTimeMs: 1_000,
  });

  assert.equal(result.timelineSeconds, 0);
});

test("custom playlist clock advances continuously across a tag timestamp jump", () => {
  const first = updateCustomPlaylistClock({
    durationSeconds: 20,
    isPlaying: true,
    isSeeking: false,
    mediaSeconds: 4,
    playbackRate: 1,
    state: {
      initialized: true,
      mediaSeconds: 4,
      timelineSeconds: 4,
      wallTimeMs: 1_000,
    },
    wallTimeMs: 1_250,
  });
  const afterJump = updateCustomPlaylistClock({
    durationSeconds: 20,
    isPlaying: true,
    isSeeking: false,
    mediaSeconds: 45,
    playbackRate: 1,
    state: first.state,
    wallTimeMs: 1_500,
  });

  assert.equal(first.timelineSeconds, 4);
  assert.equal(afterJump.timelineSeconds, 4.25);
});

test("custom playlist clock accepts explicit seeks and clamps to tag duration", () => {
  const result = updateCustomPlaylistClock({
    durationSeconds: 12,
    isPlaying: false,
    isSeeking: true,
    mediaSeconds: 15,
    playbackRate: 1,
    state: {
      initialized: true,
      mediaSeconds: 4,
      timelineSeconds: 4,
      wallTimeMs: 1_000,
    },
    wallTimeMs: 1_250,
  });

  assert.equal(result.timelineSeconds, 12);
});
