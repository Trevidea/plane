import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { GET } from "../route.ts";

const originalAllowedHosts = process.env.HLS_PROXY_ALLOWED_HOSTS;
beforeEach(() => {
  process.env.HLS_PROXY_ALLOWED_HOSTS = "sports.kanavio.com,drake.in,localhost,192.168.1.55,127.0.0.1";
});
afterEach(() => {
  if (originalAllowedHosts === undefined) delete process.env.HLS_PROXY_ALLOWED_HOSTS;
  else process.env.HLS_PROXY_ALLOWED_HOSTS = originalAllowedHosts;
});

test("Kanavio playback proxies playlists, initialization fragments and segments", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => {
    if (url.href === "https://sports.kanavio.com/hls/clip.m3u8") {
      return new Response('#EXTM3U\n#EXT-X-MAP:URI="stream/init.m4s"\n#EXTINF:2,\nstream/segment.m4s\n', {
        headers: { "content-type": "application/vnd.apple.mpegurl" },
      });
    }
    if (url.href === "https://sports.kanavio.com/hls/stream/init.m4s") return new Response("init");
    if (url.href === "https://sports.kanavio.com/hls/stream/segment.m4s") {
      return new Response("segment", { status: 206, headers: { "content-range": "bytes 0-6/7" } });
    }
    throw new Error(`Unexpected upstream: ${url}`);
  });
  const manifest = await GET(
    new Request("http://localhost:3000/api/hls?url=https%3A%2F%2Fsports.kanavio.com%2Fhls%2Fclip.m3u8")
  );
  assert.equal(manifest.status, 200);
  assert.equal(manifest.headers.get("cache-control"), "no-store");
  const text = await manifest.text();
  const initPath = text.match(/URI="([^"]+)"/)[1];
  const segmentPath = text.trim().split("\n").at(-1);
  assert.ok(initPath.startsWith("/api/hls?url="));
  assert.ok(segmentPath.startsWith("/api/hls?url="));
  const init = await GET(new Request(new URL(initPath, "http://localhost:3000")));
  assert.equal(await init.text(), "init");
  const segment = await GET(
    new Request(new URL(segmentPath, "http://localhost:3000"), { headers: { range: "bytes=0-6" } })
  );
  assert.equal(segment.status, 206);
  assert.equal(segment.headers.get("content-range"), "bytes 0-6/7");
  assert.equal(await segment.text(), "segment");
});

test("unlisted media hosts remain blocked", async () => {
  const response = await GET(
    new Request("http://localhost:3000/api/hls?url=https%3A%2F%2Funlisted.example%2Fclip.m3u8")
  );
  assert.equal(response.status, 403);
});
