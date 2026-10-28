import assert from "node:assert/strict";
import test from "node:test";
import * as playback from "../hls-playback.ts";

test("external HLS playback uses the same-origin proxy and preserves signed query parameters", () => {
  assert.equal(
    playback.resolveHlsPlaybackSource(
      "https://sports.kanavio.com/hls/clip.m3u8?token=a%2Fb&quality=high",
      "http://localhost:3000"
    ),
    "/api/hls?url=https%3A%2F%2Fsports.kanavio.com%2Fhls%2Fclip.m3u8%3Ftoken%3Da%252Fb%26quality%3Dhigh"
  );
  assert.equal(
    playback.resolveHlsPlaybackSource("//sports.kanavio.com/hls/clip.m3u8", "http://localhost:3000"),
    "/api/hls?url=http%3A%2F%2Fsports.kanavio.com%2Fhls%2Fclip.m3u8"
  );
});

test("local, already proxied and blob playback sources are preserved", () => {
  for (const source of [
    "/hls/clip.m3u8",
    "/api/hls?url=https%3A%2F%2Fsports.kanavio.com%2Fhls%2Fclip.m3u8",
    "http://localhost:3000/hls/clip.m3u8",
    "blob:http://localhost:3000/video-id",
    "",
  ]) {
    assert.equal(playback.resolveHlsPlaybackSource(source, "http://localhost:3000"), source);
  }
});
