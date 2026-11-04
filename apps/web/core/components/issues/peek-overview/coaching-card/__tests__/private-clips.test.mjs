import assert from "node:assert/strict";
import { test } from "node:test";
import {
  privateMessage,
  privateReply,
  privateClipOptions,
  privateClip,
} from "../private-thread-model.ts";
const audience = {
  visibility: "private",
  issue: "card",
  coach_id: "coach",
  recipient_id: "player",
};
const clip = {
  id: "clip",
  kind: "upload",
  name: "practice.mp4",
  size: 100,
  duration: 2,
  start_seconds: 0,
  end_seconds: 2,
};
test("coach can send a clip without text using the shared contract", () => {
  assert.deepEqual(privateReply("", { kind: "upload", id: "clip" }, "send-1"), {
    visibility: "private",
    comment_html: "",
    attachment: { kind: "upload", id: "clip" },
    client_id: "send-1",
  });
});
test("coach messages validate attachment metadata before rendering", () => {
  const value = {
    ...audience,
    id: "message",
    actor: "player",
    access: "PRIVATE",
    comment_stripped: "",
    created_at: "2026-11-04T00:00:00Z",
    attachment: clip,
  };
  assert.equal(privateMessage(value, "card", "coach", "player").attachment.name, "practice.mp4");
  assert.throws(() =>
    privateMessage(
      { ...value, attachment: { ...clip, id: "../secret" } },
      "card",
      "coach",
      "player",
    ),
  );
  assert.equal(privateClip({ ...clip, size: 1073741824 }).size, 1073741824);
  assert.throws(() => privateClip({ ...clip, size: 1073741825 }));
});
test("coach clip catalogs must match the selected private recipient", () => {
  const value = {
    ...audience,
    max_bytes: 1073741824,
    clips: [{ kind: "card_clip", clip_index: 0, revision: "a".repeat(64), name: "Kickoff" }],
  };
  assert.equal(privateClipOptions(value, "card", "coach", "player").length, 1);
  assert.throws(() => privateClipOptions(value, "card", "coach", "other"));
});
test("conversation clock handles full recordings and short legacy exports", async () => {
  const { privateClipBounds } = await import("../private-thread-model.ts");
  assert.deepEqual(
    privateClipBounds(
      { start_seconds: 120, end_seconds: 125, playback_mode: "source", source_start_seconds: 100 },
      180,
    ),
    { start: 120, end: 125 },
  );
  assert.deepEqual(
    privateClipBounds(
      {
        start_seconds: 120,
        end_seconds: 125,
        source_url: "export.m3u8",
        playlist_start_seconds: 4,
        playlist_duration_seconds: 9,
        duration_seconds: 5,
      },
      9,
    ),
    { start: 4, end: 9 },
  );
});

test("document and image attachment metadata rejects unsafe MIME types", () => {
  for (const [media_type, content_type] of [["image", "image/png"], ["document", "application/pdf"]])
    assert.equal(privateClip({...clip, duration: 0, end_seconds: null, media_type, content_type}).media_type, media_type);
  assert.throws(() => privateClip({...clip, media_type: "image", content_type: "text/html"}));
  assert.throws(() => privateClip({...clip, media_type: "document", content_type: "video/mp4"}));
});
