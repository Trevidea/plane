import assert from "node:assert/strict";
import test from "node:test";

import {
  createCustomPlaylistClockState,
  mapCustomPlaylistTimelineTimeToMedia,
  updateCustomPlaylistClock,
} from "../custom-playlist-timeline.ts";

test("custom playlist clock starts at local zero when media retains a source timestamp", () => {
  const result = updateCustomPlaylistClock({
    durationSeconds: 20,
    isPlaying: false,
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
    mediaSeconds: 45,
    playbackRate: 1,
    state: first.state,
    wallTimeMs: 1_500,
  });

  assert.equal(first.timelineSeconds, 4);
  assert.equal(afterJump.timelineSeconds, 4.25);
});

test("custom playlist clock ignores automatic HLS timestamp jumps", () => {
  const result = updateCustomPlaylistClock({
    durationSeconds: 31,
    isPlaying: true,
    mediaSeconds: 45,
    playbackRate: 1,
    state: {
      initialized: true,
      mediaSeconds: 7.5,
      timelineSeconds: 7.5,
      wallTimeMs: 1_000,
    },
    wallTimeMs: 1_250,
  });

  assert.equal(result.timelineSeconds, 7.75);
});

test("custom playlist clock finishes at the exact tag duration", () => {
  const result = updateCustomPlaylistClock({
    durationSeconds: 31,
    hasEnded: true,
    isPlaying: false,
    mediaSeconds: 67,
    playbackRate: 1,
    state: {
      initialized: true,
      mediaSeconds: 60,
      timelineSeconds: 29,
      wallTimeMs: 1_000,
    },
    wallTimeMs: 1_250,
  });

  assert.equal(result.timelineSeconds, 31);
});

test("custom playlist clock resets when completed playback starts again", () => {
  const result = updateCustomPlaylistClock({
    durationSeconds: 31,
    isPlaying: true,
    mediaSeconds: 0,
    playbackRate: 1,
    state: {
      initialized: true,
      mediaSeconds: 67,
      timelineSeconds: 31,
      wallTimeMs: 1_000,
    },
    wallTimeMs: 1_250,
  });

  assert.equal(result.timelineSeconds, 0);
});

test("custom playlist timeline seeks map to the generated media range", () => {
  assert.equal(mapCustomPlaylistTimelineTimeToMedia(0, 31, 67, 42), 42);
  assert.equal(mapCustomPlaylistTimelineTimeToMedia(31, 31, 67, 42), 109);
  assert.equal(mapCustomPlaylistTimelineTimeToMedia(40, 31, 67, 42), 109);
});

test("custom playlist timeline skips source gaps when seeking", () => {
  const ranges = [
    [192, 200],
    [211, 219],
    [230, 238],
    [251, 259],
  ];

  assert.equal(mapCustomPlaylistTimelineTimeToMedia(0, 32, 67, 0, ranges), 0);
  assert.equal(mapCustomPlaylistTimelineTimeToMedia(8, 32, 67, 0, ranges), 19);
  assert.equal(mapCustomPlaylistTimelineTimeToMedia(9, 32, 67, 0, ranges), 20);
  assert.equal(mapCustomPlaylistTimelineTimeToMedia(17, 32, 67, 0, ranges), 39);
  assert.equal(mapCustomPlaylistTimelineTimeToMedia(32, 32, 67, 0, ranges), 67);
});
