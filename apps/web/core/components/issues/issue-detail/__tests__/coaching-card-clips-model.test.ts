import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { TCoachingCardData } from "@plane/types";
// @ts-expect-error Node's type-stripping runner requires explicit extensions.
import * as clipModel from "../coaching-card-clips-model.ts";

const { buildCoachingCardClips, getClipPlaybackRange, resolveCoachingClipSource } = clipModel;

const card = (overrides: Partial<TCoachingCardData> = {}): TCoachingCardData => ({
  schema_version: 2,
  kind: "coaching_card",
  request_id: "request",
  source_issue: { id: "event", name: "Game", sequence_id: 3, sg_event_id: 1098 },
  player: null,
  sport: "American Football",
  feedback: "Good game",
  playlists: [],
  summary: { playlist_count: 1, clip_count: 1, primary_thumbnail: null, primary_clip_title: "Pass complete" },
  ...overrides,
});

test("the saved primary m3u8 source appears in slot zero without a playlist entry", () => {
  const clips = buildCoachingCardClips(
    card({
      primary_clip: {
        playlist_id: "playlist",
        clip_id: "clip",
        media_id: "media",
        event_id: "event",
        source_url: "https://media.example/game.m3u8?token=abc",
        start_seconds: 200,
        end_seconds: 208,
      },
    }),
    "2026-09-28T12:00:00Z"
  );
  assert.equal(clips.length, 1);
  assert.equal(clips[0].slot, 0);
  assert.equal(clips[0].sourceUrl, "https://media.example/game.m3u8?token=abc");
  assert.equal(clips[0].durationSeconds, 8);
  assert.equal(clips[0].addedAt, "2026-09-28T12:00:00Z");
});

test("the primary clip is first and retains its exact source and playlist metadata", () => {
  const data = card({
    primary_clip: {
      playlist_id: "playlist",
      clip_id: "second",
      media_id: "media",
      event_id: "event",
      source_url: "/hls/primary.m3u8",
      start_seconds: 20,
      end_seconds: 24,
    },
    playlists: [
      {
        id: "playlist",
        name: "Quarter 1",
        clips: [
          {
            key: "first",
            id: "first",
            title: "Run",
            source_url: "/hls/run.m3u8",
            thumbnail: null,
            duration_seconds: 6,
            timecode: "",
            team: "Home",
            detail: "",
            result: "",
            secondary_detail: "",
            group: "Quarter 1",
          },
          {
            key: "second",
            id: "second",
            title: "Pass Complete",
            source_url: "",
            thumbnail: "frame.jpg",
            duration_seconds: 4,
            timecode: "00:20-00:24",
            team: "Home",
            detail: "",
            result: "Complete",
            secondary_detail: "",
            group: "Quarter 1",
          },
        ],
      },
    ],
  });
  const clips = buildCoachingCardClips(data, "2026-09-28T12:00:00Z");
  assert.deepEqual(
    clips.map((clip) => [clip.slot, clip.title, clip.sourceUrl]),
    [
      [0, "Pass Complete", "/hls/primary.m3u8"],
      [1, "Run", "/hls/run.m3u8"],
    ]
  );
  assert.equal(clips[0].playlistName, "Quarter 1");
  assert.deepEqual(
    data.playlists[0].clips.map((clip) => clip.id),
    ["first", "second"]
  );
});

test("m3u8 file paths use the configured archive base and absolute URLs remain unchanged", () => {
  assert.equal(
    resolveCoachingClipSource("clips/pass.m3u8", "https://archive.example/hls/"),
    "https://archive.example/hls/clips/pass.m3u8"
  );
  assert.equal(resolveCoachingClipSource("/hls/pass.m3u8", "/hls"), "/hls/pass.m3u8");
  assert.equal(
    resolveCoachingClipSource("https://media.example/pass.m3u8?sig=123", "/hls"),
    "https://media.example/pass.m3u8?sig=123"
  );
  assert.equal(resolveCoachingClipSource("", "/hls"), "");
});

test("playback is bounded to the saved clip range within a longer recording", () => {
  assert.deepEqual(getClipPlaybackRange({ startSeconds: 200, endSeconds: 208, durationSeconds: 8 }, 350), {
    start: 200,
    end: 208,
    duration: 8,
  });
  assert.deepEqual(getClipPlaybackRange({ startSeconds: 200, endSeconds: null, durationSeconds: 8 }, 350), {
    start: 200,
    end: 208,
    duration: 8,
  });
});

test("an already cut m3u8 clip plays from zero instead of seeking beyond its duration", () => {
  assert.deepEqual(getClipPlaybackRange({ startSeconds: 200, endSeconds: 208, durationSeconds: 8 }, 8), {
    start: 0,
    end: 8,
    duration: 8,
  });
});

test("missing clip sources do not fabricate a video URL", () => {
  assert.deepEqual(buildCoachingCardClips(card(), "2026-09-28T12:00:00Z"), []);
});

test("uploaded clips resolve their saved artifact when no source URL exists", () => {
  const data = card({
    source_issue: null,
    source_media: { package_id: "library", artifact_id: "video 1.mov", title: "Practice", annotations: [] },
    playlists: [
      {
        id: "uploaded-video:video 1.mov",
        name: "Practice",
        clips: [
          {
            key: "video",
            id: "video 1.mov",
            title: "Practice",
            thumbnail: null,
            duration_seconds: 30,
            timecode: "",
            team: "",
            detail: "",
            result: "",
            secondary_detail: "",
            group: "",
          },
        ],
      },
    ],
  });
  const clips = buildCoachingCardClips(data, "2026-10-01", {
    workspaceSlug: "sport work",
    projectId: "project",
    apiBaseUrl: "http://localhost:8000/",
  });
  assert.equal(
    clips[0].sourceUrl,
    "http://localhost:8000/api/workspaces/sport%20work/projects/project/media-library/packages/library/artifacts/video%201.mov/file/"
  );
  assert.equal(clips[0].durationSeconds, 30);
});

test("both peek layouts pass workspace and project IDs to the clip player", () => {
  const view = readFileSync(new URL("../../peek-overview/view.tsx", import.meta.url), "utf8");
  const players = view.match(/<CoachingCardClips\b[^>]*\/>/g) ?? [];
  assert.equal(players.length, 2);
  for (const player of players) {
    assert.match(player, /workspaceSlug=\{workspaceSlug\}/);
    assert.match(player, /projectId=\{projectId\}/);
  }
});

test("uploaded HLS clips use the resolved media source rather than the local file endpoint", () => {
  const data = card({
    source_media: { package_id: "library", artifact_id: "video", title: "Video", annotations: [] },
    playlists: [
      {
        id: "upload",
        name: "Video",
        clips: [
          {
            key: "video",
            id: "video",
            title: "Video",
            thumbnail: null,
            duration_seconds: 30,
            timecode: "",
            team: "",
            detail: "",
            result: "",
            secondary_detail: "",
            group: "",
          },
        ],
      },
    ],
  });
  const clips = buildCoachingCardClips(data, "2026-10-01", {
    workspaceSlug: "sport-work",
    projectId: "project",
    uploadedSourceUrl: "http://localhost:1437/media/master.m3u8",
  });
  assert.equal(clips[0].sourceUrl, "http://localhost:1437/media/master.m3u8");
});
