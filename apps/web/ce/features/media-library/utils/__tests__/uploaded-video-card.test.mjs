import assert from "node:assert/strict";
import test from "node:test";
import { buildUploadedVideoCardPlaylist, canCreateUploadedVideoCard } from "../uploaded-video-card.ts";

const ready = {
  isVideo: true,
  isEvent: false,
  packageId: "library",
  artifactId: "video-1",
  annotations: [{ id: "arrow-1", type: "arrow", startTime: 0, endTime: 2 }],
  hasUnsavedChanges: false,
  isSaving: false,
  isRecording: false,
};

test("uploaded videos can create cards with or without annotations", () => {
  assert.equal(canCreateUploadedVideoCard(ready), true);
  for (const annotations of [[], undefined, null]) {
    assert.equal(canCreateUploadedVideoCard({ ...ready, annotations }), true);
  }
  for (const change of [
    { annotations: [null] },
    { annotations: [{ id: "bad" }] },
    { isVideo: false },
    { isEvent: true },
    { packageId: undefined },
    { artifactId: "" },
    { hasUnsavedChanges: true },
    { isSaving: true },
    { isRecording: true },
  ])
    assert.equal(canCreateUploadedVideoCard({ ...ready, ...change }), false, JSON.stringify(change));
});

test("the form includes the whole uploaded video, preserving its title and thumbnail", () => {
  const playlist = buildUploadedVideoCardPlaylist(
    { id: "video-1", title: "Practice", thumbnail: "/frame.jpg", videoSrc: "/video.mp4" },
    42
  );
  assert.equal(playlist.id, "uploaded-video:video-1");
  assert.equal(playlist.clips.length, 1);
  assert.deepEqual(playlist.clips[0], {
    id: "video-1",
    title: "Practice",
    thumbnail: "/frame.jpg",
    durationSeconds: 42,
  });
});

test("missing thumbnail and unknown duration do not prevent creating a card", () => {
  const playlist = buildUploadedVideoCardPlaylist({ id: "video-2", title: "", thumbnail: "" }, NaN);
  assert.equal(playlist.clips[0].title, "Uploaded video");
  assert.equal(playlist.clips[0].thumbnail, null);
  assert.equal(playlist.clips[0].durationSeconds, null);
});
