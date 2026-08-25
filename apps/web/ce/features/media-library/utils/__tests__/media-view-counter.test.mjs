import assert from "node:assert/strict";
import test from "node:test";

import { buildMediaViewStorageKey, shouldRecordMediaPlaybackView } from "../media-view-counter.ts";

test("view counter records only successful playback starts", () => {
  assert.equal(
    shouldRecordMediaPlaybackView({
      eventType: "playing",
      isVideo: true,
      packageId: "package-1",
      artifactId: "clip-1",
    }),
    true
  );

  assert.equal(
    shouldRecordMediaPlaybackView({
      eventType: "error",
      isVideo: true,
      packageId: "package-1",
      artifactId: "clip-1",
    }),
    false
  );
});

test("view counter does not record repeated playback in the same session", () => {
  assert.equal(
    shouldRecordMediaPlaybackView({
      eventType: "playing",
      isVideo: true,
      packageId: "package-1",
      artifactId: "clip-1",
      alreadyRecorded: true,
    }),
    false
  );
});

test("view counter requires a video and media identity", () => {
  assert.equal(
    shouldRecordMediaPlaybackView({
      eventType: "playing",
      isVideo: false,
      packageId: "package-1",
      artifactId: "clip-1",
    }),
    false
  );
  assert.equal(
    shouldRecordMediaPlaybackView({
      eventType: "playing",
      isVideo: true,
      packageId: "",
      artifactId: "clip-1",
    }),
    false
  );
});

test("view counter storage key is stable per workspace, project, package, and item", () => {
  assert.equal(
    buildMediaViewStorageKey({
      workspaceSlug: "workspace-a",
      projectId: "project-a",
      packageId: "package-a",
      artifactId: "clip-a",
    }),
    "media-view:workspace-a:project-a:package-a:clip-a"
  );
});
