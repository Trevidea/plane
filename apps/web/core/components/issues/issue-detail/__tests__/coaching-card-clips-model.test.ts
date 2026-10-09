import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { TCoachingCardData } from "@plane/types";
// @ts-expect-error Node's type-stripping runner requires explicit extensions.
import * as clipModel from "../coaching-card-clips-model.ts";

const { buildCoachingCardClips, getClipPlaybackRange, resolveCoachingClipSource } = clipModel;

test("saved API thumbnails resolve against the API server instead of the web origin", () => {
  const path =
    "/api/workspaces/sport-work/projects/project/media-library/packages/package/artifacts/video-thumbnail/file/";
  assert.equal(clipModel.resolveCoachingClipThumbnail(path, "http://localhost:8000/"), `http://localhost:8000${path}`);
  assert.equal(clipModel.resolveCoachingClipThumbnail(path, ""), path);
  assert.equal(
    clipModel.resolveCoachingClipThumbnail("https://media.example/poster.jpg", "http://localhost:8000"),
    "https://media.example/poster.jpg"
  );
  assert.equal(clipModel.resolveCoachingClipThumbnail("poster.jpg", "http://localhost:8000"), "poster.jpg");
  assert.equal(clipModel.resolveCoachingClipThumbnail(null, "http://localhost:8000"), "");
});

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
            thumbnail: "/api/workspaces/sport-work/old-thumbnail/file/",
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
  const resolvedPoster = "http://localhost:1437/api/blobs/media/upload/thumbnails/poster.jpg";
  const resolvedClips = buildCoachingCardClips(data, "2026-10-01", {
    workspaceSlug: "sport work",
    projectId: "project",
    uploadedThumbnail: resolvedPoster,
  });
  assert.equal(resolvedClips[0].thumbnail, resolvedPoster);
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

test("timestamp entry accepts coaching timecodes and rejects invalid ranges", () => {
  assert.equal(clipModel.parseClipTime("01:14:20"), 4460);
  assert.equal(clipModel.parseClipTime("00:18.5"), 18.5);
  assert.equal(clipModel.parseClipTime("31"), 31);
  assert.equal(clipModel.parseClipTime("1:70"), null);
  assert.equal(clipModel.parseClipTime("-1"), null);
});

test("clip grouping and sorting retain unknown future types", () => {
  const clips = [
    { key: "a", title: "Game", clipType: "game_film", addedAt: "2026-10-01" },
    { key: "b", title: "Practice", clipType: "practice_check", addedAt: "2026-10-03" },
    { key: "c", title: "Future", clipType: "future_type", addedAt: "2026-10-02" },
  ] as clipModel.CoachingCardDetailClip[];
  assert.deepEqual(
    clipModel.filterAndSortClips(clips, "all", "newest").map((clip) => clip.key),
    ["b", "c", "a"]
  );
  assert.deepEqual(
    clipModel.filterAndSortClips(clips, "practice", "oldest").map((clip) => clip.key),
    ["b"]
  );
  assert.deepEqual(
    clipModel.filterAndSortClips(clips, "other", "oldest").map((clip) => clip.key),
    ["c"]
  );
  assert.deepEqual(
    clips.map((clip) => clip.key),
    ["a", "b", "c"]
  );
});

test("durable clip metadata and association identity normalize from the API", () => {
  const data = card({
    playlists: [
      {
        id: "practice",
        name: "Practice",
        clips: [
          {
            id: "film",
            key: "film",
            association_id: "saved-association",
            title: "Footwork",
            source_url: "/practice.m3u8",
            clip_type: "practice_check",
            source_name: "Tuesday practice",
            created_by: { id: "coach", name: "Coach Smith" },
            created_at: "2026-10-06",
            note: "Watch the first step",
            tags: ["Footwork"],
            period: "Rep 2",
            game_clock: "08:42",
            playback_mode: "clip",
            start_seconds: 18,
            end_seconds: 31,
            duration_seconds: 13,
            thumbnail: null,
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
  const [clip] = buildCoachingCardClips(data, "2026-01-01");
  assert.equal(clip.key, "saved-association");
  assert.equal(clip.clipType, "practice_check");
  assert.equal(clip.sourceName, "Tuesday practice");
  assert.equal(clip.createdBy, "Coach Smith");
  assert.equal(clip.addedAt, "2026-10-06");
  assert.equal(clip.playbackMode, "clip");
  assert.equal(clip.note, "Watch the first step");
});

test("explicit clipped playlists use local coordinates even when the original start fits the duration", () => {
  assert.deepEqual(
    getClipPlaybackRange({ startSeconds: 6, endSeconds: 14, durationSeconds: 8, playbackMode: "clip" }, 8),
    { start: 0, end: 8, duration: 8 }
  );
});

test("a subrange of a generated clip keeps the original playlist coordinate anchor", () => {
  assert.deepEqual(
    getClipPlaybackRange(
      { startSeconds: 20, endSeconds: 25, durationSeconds: 5, playbackMode: "clip", sourceStartSeconds: 18 },
      13
    ),
    { start: 2, end: 7, duration: 5 }
  );
});

test("HLS detection recognizes proxied manifests with encoded query strings", () => {
  assert.equal(
    clipModel.isCoachingClipHls("/api/hls?url=https%3A%2F%2Ffilm.example%2Fmaster.m3u8%3Ftoken%3Dabc"),
    true
  );
  assert.equal(clipModel.isCoachingClipHls("https://film.example/video.mp4"), false);
});

test("replacement payload explicitly clears obsolete uploaded and stream identities", () => {
  const payload = clipModel.clipMutationPayload(
    {
      key: "saved",
      slot: 0,
      playlistName: "Film",
      thumbnail: null,
      addedAt: "2026-10-06",
      title: "Replacement",
      sourceUrl: "/new.m3u8",
      startSeconds: 0,
      endSeconds: null,
      durationSeconds: null,
      playbackMode: "source",
      tags: [],
    } as clipModel.CoachingCardDetailClip,
    "request"
  );
  assert.equal(payload.source_media, null);
  assert.equal(payload.stream_id, "");
  assert.equal(payload.start_segment, null);
  assert.equal(payload.source_start_seconds, null);
});

test("an explicit full-source range beyond available media never falls back to unrelated footage", () => {
  assert.throws(
    () => getClipPlaybackRange({ startSeconds: 200, endSeconds: 208, durationSeconds: 8, playbackMode: "source" }, 100),
    /range/i
  );
});

test("primary association does not overwrite a second association of the same upstream clip", () => {
  const base = {
    id: "film",
    key: "film",
    title: "Film",
    thumbnail: null,
    duration_seconds: 8,
    timecode: "",
    team: "",
    detail: "",
    result: "",
    secondary_detail: "",
    group: "",
  };
  const clips = buildCoachingCardClips(
    card({
      playlists: [
        {
          id: "game",
          name: "Game",
          clips: [
            { ...base, association_id: "a", source_url: "/a.m3u8" },
            { ...base, association_id: "b", source_url: "/b.m3u8" },
          ],
        },
      ],
      primary_clip: {
        association_id: "a",
        playlist_id: "game",
        clip_id: "film",
        media_id: "",
        event_id: "",
        source_url: "/primary.m3u8",
        start_seconds: 0,
        end_seconds: 8,
      },
    }),
    "2026-10-06"
  );
  assert.equal(clips.find((clip) => clip.key === "b")?.sourceUrl, "/b.m3u8");
});

test("legacy clips in one combined playlist use distinct offsets instead of both restarting at zero", () => {
  const data = card({
    playlists: [
      {
        id: "combined",
        name: "Game",
        clips: [
          {
            id: "pass",
            key: "pass",
            title: "Pass",
            source_url: "/combined.m3u8",
            start_seconds: 200,
            end_seconds: 208,
            duration_seconds: 8,
          },
          {
            id: "run",
            key: "run",
            title: "Run",
            source_url: "/combined.m3u8",
            start_seconds: 325,
            end_seconds: 333,
            duration_seconds: 8,
          },
        ],
      },
    ],
  } as Partial<TCoachingCardData>);
  const clips = buildCoachingCardClips(data, "2026-10-01");
  assert.deepEqual(getClipPlaybackRange(clips[0], 16), { start: 0, end: 8, duration: 8 });
  assert.deepEqual(getClipPlaybackRange(clips[1], 16), { start: 8, end: 16, duration: 8 });
  // A full recording still uses the actual saved source timestamps.
  assert.deepEqual(getClipPlaybackRange(clips[1], 400), { start: 325, end: 333, duration: 8 });
});
