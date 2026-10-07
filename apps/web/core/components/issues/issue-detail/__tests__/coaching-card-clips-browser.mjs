import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const require = createRequire(path.join(web, "package.json"));
const { build } = require(process.env.ESBUILD_PACKAGE_PATH || "esbuild");
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE_PATH || "playwright");
const viewOnly = process.env.COACHING_CLIPS_VIEW_ONLY === "1";
const temp = await mkdtemp(path.join(tmpdir(), "coaching-clips-browser-"));
execFileSync("ffmpeg", [
  "-hide_banner",
  "-loglevel",
  "error",
  "-f",
  "lavfi",
  "-i",
  "testsrc2=size=320x180:rate=24",
  "-t",
  "8",
  "-c:v",
  "libx264",
  "-preset",
  "ultrafast",
  "-pix_fmt",
  "yuv420p",
  "-g",
  "24",
  "-hls_time",
  "1",
  "-hls_playlist_type",
  "vod",
  path.join(temp, "film.m3u8"),
]);
await writeFile(path.join(temp, "i18n.ts"), "export const useTranslation = () => ({ t: (value) => value });");
await writeFile(
  path.join(temp, "store.ts"),
  `export const useIssueDetail = () => ({ issue: { fetchIssue: async () => {} }, fetchActivities: async () => {} });`
);
await writeFile(
  path.join(temp, "media.ts"),
  `export const useMediaLibraryItem = () => ({ item: null, isLoading: false }); export const useMediaLibraryItems = () => ({ items: [], isLoading: false });`
);
await writeFile(
  path.join(temp, "services.ts"),
  `export class IssueService {
  async saveCoachingCardClip(_workspace, _project, _card, values, id) {
    const response = await fetch('/mutation', { method: 'POST', body: JSON.stringify({ operation: id ? 'edit' : 'add', values, id }) });
    if (!response.ok) throw new Error('Save failed'); return response.json();
  }
  async removeCoachingCardClip(_workspace, _project, _card, id) {
    const response = await fetch('/mutation', { method: 'POST', body: JSON.stringify({ operation: 'remove', id }) });
    if (!response.ok) throw new Error('Remove failed'); return response.json();
  }
}`
);
const realHls = path.join(web, "node_modules/hls.js/dist/hls.mjs");
await writeFile(
  path.join(temp, "hls.ts"),
  `import Hls from ${JSON.stringify(realHls)};
export default class CountedHls extends Hls {
 constructor(...args) { super(...args); window.hlsCount = (window.hlsCount || 0) + 1; window.hlsMax = Math.max(window.hlsMax || 0, window.hlsCount); }
 destroy() { window.hlsCount--; super.destroy(); }
}`
);
await writeFile(
  path.join(temp, "fixture.tsx"),
  `import { useEffect, useState } from 'react'; import { createRoot } from 'react-dom/client';
import { CoachingCardClips } from ${JSON.stringify(path.join(web, "core/components/issues/issue-detail/coaching-card-clips.tsx"))};
function Fixture() {
 const [issue, setIssue] = useState(null); const [open, setOpen] = useState(true);
 useEffect(() => { if (open) fetch('/data').then((r) => r.json()).then(setIssue); }, [open]);
 return <main style={{ width: 'min(740px, 100%)', margin: 'auto' }}>
 <button onClick={() => { setOpen(!open); setIssue(null); }}>{open ? 'Close card' : 'Reopen card'}</button>
 <button onClick={() => fetch('/fail', { method: 'POST' })}>Fail next save</button>
 {open && issue && <CoachingCardClips issue={issue} workspaceSlug='team' projectId='project' viewOnly={${viewOnly}} />}
 </main>;
} createRoot(document.getElementById('root')).render(<Fixture />);`
);
const bundle = await build({
  absWorkingDir: web,
  entryPoints: [path.join(temp, "fixture.tsx")],
  bundle: true,
  write: false,
  outdir: temp,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  alias: {
    "@": path.join(web, "core"),
    "@/helpers": path.join(web, "helpers"),
    "@/plane-web": path.join(web, "ce"),
    ce: path.join(web, "ce"),
    "@plane/i18n": path.join(temp, "i18n.ts"),
    "@/hooks/store/use-issue-detail": path.join(temp, "store.ts"),
    "@/services/issue/issue.service": path.join(temp, "services.ts"),
    "ce/features/media-library/hooks/use-media-library-item": path.join(temp, "media.ts"),
    "ce/features/media-library/hooks/use-media-library-items": path.join(temp, "media.ts"),
    "hls.js": path.join(temp, "hls.ts"),
  },
  nodePaths: [path.join(web, "node_modules"), path.resolve(web, "../../node_modules")],
  define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" },
  loader: { ".woff2": "dataurl", ".woff": "dataurl", ".svg": "dataurl", ".png": "dataurl" },
});
const utility = path.resolve(web, "../api/plane/utils/coaching_card_clips.py");
const mutate = (data, operation, values, id) =>
  JSON.parse(
    execFileSync(
      "python3",
      [
        "-c",
        `import importlib.util,json,sys
spec=importlib.util.spec_from_file_location('clips',sys.argv[1]); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
v=json.load(sys.stdin)
print(json.dumps(m.mutate_card_clips(v['data'],v['operation'],v['values'],{'id':'coach','name':'Coach Smith'},'2026-10-06T12:00:00Z',v.get('id'))))`,
        utility,
      ],
      { input: JSON.stringify({ data, operation, values, id }), encoding: "utf8" }
    )
  );
let data = {
  kind: "coaching_card",
  schema_version: 3,
  playlists: [
    {
      id: "game",
      name: "Game",
      clips: [
        {
          id: "original",
          key: "original",
          title: "Original Film",
          source_url: "/film.m3u8",
          start_seconds: 1,
          end_seconds: 7,
          duration_seconds: 6,
          clip_type: "original",
        },
        {
          id: "practice",
          key: "practice",
          title: "Practice Film",
          source_url: "/film.m3u8",
          start_seconds: 2,
          end_seconds: 6,
          duration_seconds: 4,
          clip_type: "practice_check",
        },
      ],
    },
  ],
  primary_clip: {
    playlist_id: "game",
    clip_id: "original",
    source_url: "/film.m3u8",
    start_seconds: 1,
    end_seconds: 7,
  },
  summary: { clip_count: 2 },
};
if (viewOnly) {
  data.playlists[0].clips[0].period = "Quarter 1";
  data.playlists[0].clips[0].game_clock = "03:20-03:26";
  data.playlists[0].clips[1].source_url = "/practice.m3u8";
  data.playlists[0].clips.push(
    ...Array.from({ length: 8 }, (_, index) => ({
      id: `extra-${index}`,
      title: index === 0 ? "Verified Film" : `Reference ${index}`,
      source_url: "/film.m3u8",
      start_seconds: 1,
      end_seconds: 7,
      duration_seconds: 6,
      clip_type: index === 0 ? "verified_on_film" : "reference",
    }))
  );
}
let fail = false;
const issue = () => ({ id: "card", category: "Coaching Card", created_at: "2026-10-01", coaching_card_data: data });
const themeRequire = createRequire(path.resolve(web, "../../packages/tailwind-config/package.json"));
const postcss = themeRequire("postcss");
const tailwindcss = themeRequire("tailwindcss");
const sharedConfig = themeRequire("./tailwind.config.js");
const themeCss = (await readFile(path.join(web, "styles/globals.css"), "utf8")).replace(/^@import.*$/gm, "");
const { css } = await postcss([
  tailwindcss({
    ...sharedConfig,
    content: [
      path.join(web, "core/components/issues/issue-detail/coaching-card-*.tsx"),
      path.join(web, "../../packages/ui/src/**/*.tsx"),
      path.join(web, "../../packages/propel/src/**/*.tsx"),
    ],
  }),
]).process(themeCss, { from: undefined });
const server = createServer(async (req, res) => {
  if (req.url === "/fixture.js")
    return res
      .writeHead(200, { "Content-Type": "text/javascript" })
      .end(bundle.outputFiles.find((file) => file.path.endsWith(".js")).text);
  if (req.url === "/data")
    return res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(issue()));
  if (req.url === "/fail") {
    fail = true;
    return res.writeHead(200).end();
  }
  if (req.url === "/mutation") {
    let body = "";
    for await (const chunk of req) body += chunk;
    if (fail) {
      fail = false;
      return res.writeHead(500).end();
    }
    const { operation, values = {}, id } = JSON.parse(body);
    data = mutate(data, operation, values, id);
    return res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(issue()));
  }
  if (req.url === "/practice.m3u8") {
    return res
      .writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl" })
      .end(await readFile(path.join(temp, "film.m3u8")));
  }
  if (/^\/film(?:\d+\.ts|\.m3u8)$/.test(req.url)) {
    const bytes = await readFile(path.join(temp, req.url.slice(1)));
    return res
      .writeHead(200, { "Content-Type": req.url.endsWith("m3u8") ? "application/vnd.apple.mpegurl" : "video/mp2t" })
      .end(bytes);
  }
  if (req.url?.includes("unavailable")) return res.writeHead(404).end();
  res
    .writeHead(200, { "Content-Type": "text/html" })
    .end(
      `<html><head><style>${css} body { font: 13px system-ui; background: rgb(var(--color-background-100)); color: rgb(var(--color-text-100)); padding: 20px; } video { width: 100%; aspect-ratio: 16/9; } [data-coaching-player] { position: relative; } button { cursor:pointer; }</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`
    );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
  });
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => document.querySelector("video")?.readyState >= 2);
  assert.equal(await page.locator("video").count(), 1);
  if (viewOnly) {
    for (const label of [
      "Clip details",
      "Created by",
      "Created",
      "Add clip",
      "Set start",
      "Set end",
      "Oldest first",
      "Newest first",
      "Edit details",
      "Remove from card",
    ]) {
      assert.equal(await page.getByText(label, { exact: true }).count(), 0, `${label} must be absent in view mode`);
    }
    assert.equal(await page.getByRole("button", { name: "Clip actions" }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "Back 0.1 seconds" }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "Forward 0.1 seconds" }).count(), 0);
    const cards = page.getByRole("button", { name: /^Play clip:/ });
    assert.equal(await cards.count(), 10);
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    assert.equal(await cards.nth(0).locator("img").getAttribute("data-image-fallback"), "true");
    assert.notEqual(
      await cards
        .nth(0)
        .locator("img")
        .evaluate((image) => getComputedStyle(image).filter),
      "none"
    );
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
    assert.equal(
      await cards
        .nth(0)
        .locator("img")
        .evaluate((image) => getComputedStyle(image).filter),
      "none"
    );
    assert.equal(await cards.nth(0).getByText("Q1 · 03:20 → 03:26", { exact: true }).count(), 1);
    assert.equal(await cards.nth(2).getByText("Verified Film", { exact: true }).count(), 1);
    const firstBounds = await cards.nth(0).boundingBox();
    const secondBounds = await cards.nth(1).boundingBox();
    assert.equal(firstBounds.y, secondBounds.y, "Cards share one horizontal row");
    assert.ok(firstBounds.width >= 220 && firstBounds.width <= 260);
    const thumbnail = await cards.nth(0).locator("img").boundingBox();
    assert.ok(Math.abs(thumbnail.width / thumbnail.height - 16 / 9) < 0.02);
    assert.equal(await cards.nth(0).getAttribute("aria-pressed"), "true");
    await page.evaluate(() => {
      window.originalVideo = document.querySelector("video");
    });
    await page.getByRole("button", { name: "Play clip: Practice Film", exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector("video")?.currentTime >= 2 && !document.querySelector("video").paused
    );
    assert.equal(await cards.nth(1).getAttribute("aria-pressed"), "true");
    assert.equal(
      await page.evaluate(() => window.originalVideo === document.querySelector("video")),
      true,
      "Selection reuses the video element"
    );
    assert.equal(await page.evaluate(() => window.hlsCount), 1);
    assert.equal(await page.evaluate(() => window.hlsMax), 1);
    await page.getByRole("button", { name: "Pause clip", exact: true }).click();
    await cards.nth(0).focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => !document.querySelector("video").paused);
    assert.equal(await cards.nth(0).getAttribute("aria-pressed"), "true");
    // Finish each clip through the real player and verify playlist wraparound.
    for (let index = 0; index < 10; index++) {
      await page.waitForFunction(
        () => !document.querySelector("video").paused && document.querySelector("video").readyState >= 2
      );
      await page.evaluate(() => {
        const video = document.querySelector("video");
        video.currentTime = 6.95;
      });
      const nextIndex = (index + 1) % 10;
      await page.waitForFunction((nextIndex) => {
        const cards = document.querySelectorAll('button[aria-label^="Play clip:"]');
        return cards[nextIndex]?.getAttribute("aria-pressed") === "true" && !document.querySelector("video").paused;
      }, nextIndex);
      assert.equal(await page.evaluate(() => window.originalVideo === document.querySelector("video")), true);
      assert.equal(await page.evaluate(() => window.hlsCount), 1);
    }
    await page.getByRole("button", { name: "Pause clip", exact: true }).click();
    await page.setViewportSize({ width: 390, height: 900 });
    assert.equal((await cards.nth(0).boundingBox()).y, (await cards.nth(1).boundingBox()).y);
    const viewport = page.locator("[data-radix-scroll-area-viewport]");
    assert.ok(await viewport.evaluate((element) => element.scrollWidth > element.clientWidth));
    await viewport.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
    });
    assert.ok(await viewport.evaluate((element) => element.scrollLeft > 0));
    await page.screenshot({ path: path.join(temp, "filmstrip-mobile.png") });
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.screenshot({ path: path.join(temp, "filmstrip-desktop.png") });
    await page.getByRole("button", { name: "Close card", exact: true }).click();
    await page.waitForFunction(() => window.hlsCount === 0);
    // Legacy cards retain recording timestamps while both entries point to
    // one combined playlist. The second entry must start at its own offset.
    data.primary_clip = null;
    data.playlists[0].clips = [200, 325].map((start, index) => ({
      id: `combined-${index}`,
      title: `Combined ${index}`,
      source_url: "/film.m3u8",
      start_seconds: start,
      end_seconds: start + 3,
      duration_seconds: 3,
    }));
    await page.getByRole("button", { name: "Reopen card", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("video")?.readyState >= 2);
    await page.getByRole("button", { name: "Play clip: Combined 1", exact: true }).click();
    await page.waitForFunction(() => {
      const video = document.querySelector("video");
      return !video.paused && video.currentTime >= 3 && video.currentTime < 6;
    });
    await page.evaluate(() => {
      document.querySelector("video").currentTime = 5.95;
    });
    await page.waitForFunction(() => {
      const selected = document.querySelector('button[aria-label="Play clip: Combined 0"]');
      const video = document.querySelector("video");
      return selected?.getAttribute("aria-pressed") === "true" && !video.paused && video.currentTime < 3;
    });
    await page.getByRole("button", { name: "Close card", exact: true }).click();
    await page.waitForFunction(() => window.hlsCount === 0);
    // Saved uploaded-video annotations render on the same player at their time.
    data.source_media = {
      package_id: "package",
      artifact_id: "upload",
      title: "Upload",
      annotations: [
        {
          id: "saved-drawing",
          type: "rectangle",
          startTime: 1,
          endTime: 2,
          x: 100,
          y: 100,
          width: 250,
          height: 200,
          style: { stroke: "#ff0000", color: "#ff0000", strokeWidth: 5, opacity: 1 },
        },
      ],
    };
    data.playlists[0].clips = [
      {
        id: "annotated",
        title: "Annotated",
        source_url: "/film.m3u8",
        start_seconds: 0,
        end_seconds: 6,
        duration_seconds: 6,
      },
    ];
    await page.getByRole("button", { name: "Reopen card", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("video")?.readyState >= 2);
    await page.evaluate(() => {
      document.querySelector("video").currentTime = 1.5;
    });
    await page.waitForFunction(() => {
      const canvas = document.querySelector("canvas");
      if (!canvas || !canvas.width || !canvas.height) return false;
      const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      return pixels.some((value, index) => index % 4 === 3 && value > 0);
    });
    await page.evaluate(() => {
      document.querySelector("video").currentTime = 2.5;
    });
    await page.waitForFunction(() => {
      const canvas = document.querySelector("canvas");
      const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      return pixels.every((value, index) => index % 4 !== 3 || value === 0);
    });
    await page.getByRole("button", { name: "Close card", exact: true }).click();
    await page.waitForFunction(() => window.hlsCount === 0);
    assert.deepEqual(errors, []);
    console.log(
      `PASS: horizontal view-only filmstrip, reused player, playlist advance and wraparound, timed saved annotations, keyboard selection, responsive scrolling. Screenshots: ${temp}`
    );
  } else {
    await page.getByRole("button", { name: "Play clip: Practice Film", exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector("video")?.currentTime >= 2 && !document.querySelector("video").paused
    );
    await page.getByRole("button", { name: "Pause clip", exact: true }).click();
    await page.getByRole("button", { name: "1x", exact: true }).click();
    await page.getByRole("option", { name: "0.25x", exact: true }).click();
    assert.equal(await page.locator("video").evaluate((v) => v.playbackRate), 0.25);
    await page.getByRole("button", { name: "Enter clip fullscreen", exact: true }).click();
    await page.waitForFunction(() => Boolean(document.fullscreenElement));
    await page.getByRole("button", { name: "0.25x", exact: true }).click();
    await page.getByRole("option", { name: "0.5x", exact: true }).click();
    assert.equal(await page.locator("video").evaluate((v) => v.playbackRate), 0.5);
    await page.getByRole("button", { name: "Exit clip fullscreen", exact: true }).click();
    await page.waitForFunction(() => !document.fullscreenElement);
    await page.getByRole("button", { name: "Back 5 seconds", exact: true }).click();
    await page.waitForFunction(() => Math.abs(document.querySelector("video").currentTime - 2) < 0.1);
    await page.getByRole("button", { name: "Forward 0.1 seconds", exact: true }).click();
    await page.waitForFunction(() => Math.abs(document.querySelector("video").currentTime - 2.1) < 0.05);
    await page.getByRole("button", { name: "Back 0.1 seconds", exact: true }).click();
    await page.getByRole("button", { name: "Forward 5 seconds", exact: true }).click();
    await page.waitForFunction(() => Math.abs(document.querySelector("video").currentTime - 6) < 0.1);
    await page.getByRole("slider", { name: "Clip volume" }).fill("0.5");
    assert.equal(await page.locator("video").evaluate((v) => v.volume), 0.5);
    await page.getByRole("button", { name: "Mute clip", exact: true }).click();
    assert.equal(await page.locator("video").evaluate((v) => v.muted), true);
    await page.getByRole("slider", { name: "Seek clip" }).fill("1");
    await page.waitForFunction(() => Math.abs(document.querySelector("video").currentTime - 3) < 0.2);
    await page.getByRole("button", { name: "Set start", exact: true }).click();
    await page.getByRole("slider", { name: "Seek clip" }).fill("2.5");
    await page.getByRole("button", { name: "Set end", exact: true }).click();
    await page.getByRole("button", { name: "Add this range" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByText("Clip title", { exact: true }).locator("..").locator("input").fill("Corrected footwork");
    await dialog
      .getByText("Coach note", { exact: true })
      .locator("..")
      .locator("textarea")
      .fill("Watch the first step");
    await page.request.post(`http://127.0.0.1:${server.address().port}/fail`);
    await dialog.getByRole("button", { name: "Add clip", exact: true }).click();
    await dialog.getByRole("alert").waitFor();
    assert.equal(
      await dialog.getByText("Clip title", { exact: true }).locator("..").locator("input").inputValue(),
      "Corrected footwork"
    );
    await dialog.getByRole("button", { name: "Add clip", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Play clip: Corrected footwork", exact: true }).waitFor();
    await page.getByRole("button", { name: "Close card" }).click();
    await page.waitForFunction(() => window.hlsCount === 0);
    await page.getByRole("button", { name: "Reopen card" }).click();
    await page.getByRole("button", { name: "Play clip: Corrected footwork", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("video")?.readyState >= 2);
    const row = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("button", { name: "Play clip: Corrected footwork", exact: true }) });
    await row.getByRole("button", { name: "Clip actions" }).click();
    await page.getByRole("menuitem", { name: "Remove from card", exact: true }).click();
    await page.getByRole("dialog").getByText("Remove clip?", { exact: true }).waitFor();
    assert.equal(await page.locator('button[aria-label="Play clip: Corrected footwork"]').count(), 1);
    await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
    await row.getByRole("button", { name: "Clip actions" }).click();
    await page.getByRole("menuitem", { name: "Remove from card", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Remove clip", exact: true }).click();
    await page.getByRole("button", { name: "Play clip: Corrected footwork", exact: true }).waitFor({ state: "hidden" });
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page.waitForFunction(() => document.querySelector("video")?.readyState >= 2);
    assert.equal(data.summary.clip_count, 2);
    assert.equal(await page.evaluate(() => window.hlsMax), 1);
    await page.waitForFunction(() => !document.querySelector('[data-headlessui-portal] [role="dialog"]'));
    await page.getByRole("button", { name: "Play selected clip", exact: true }).waitFor();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ path: path.join(temp, "clips-mobile.png"), fullPage: true });
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.screenshot({ path: path.join(temp, "clips-desktop.png"), fullPage: true });
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    await page.screenshot({ path: path.join(temp, "clips-dark.png"), fullPage: true });
    console.log(
      "Dark control styling:",
      await page.getByRole("button", { name: "Play clip", exact: true }).evaluate((button) => ({
        classes: button.className,
        background: getComputedStyle(button).backgroundColor,
        iconWidth: button.querySelector("svg").getBoundingClientRect().width,
      }))
    );

    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.getByRole("button", { name: "Add clip", exact: true }).click();
    const failureDialog = page.getByRole("dialog");
    await failureDialog
      .getByText("Video URL", { exact: true })
      .locator("..")
      .locator("input")
      .fill(`http://127.0.0.1:${server.address().port}/unavailable.m3u8`);
    await failureDialog
      .getByText("Clip title", { exact: true })
      .locator("..")
      .locator("input")
      .fill("Unavailable film");
    await failureDialog.getByRole("button", { name: "Add clip", exact: true }).click();
    await failureDialog.waitFor({ state: "hidden" });
    await page.getByText("Unable to load this clip.", { exact: true }).waitFor({ timeout: 20000 });
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await page.getByText("Unable to load this clip.", { exact: true }).waitFor({ timeout: 20000 });
    assert.equal(await page.evaluate(() => window.hlsMax), 1);
    for (const playlist of [...data.playlists])
      for (const clip of [...playlist.clips]) {
        await page.request.post(`http://127.0.0.1:${server.address().port}/mutation`, {
          data: { operation: "remove", id: clip.association_id },
        });
      }
    await page.getByRole("button", { name: "Close card" }).click();
    await page.getByRole("button", { name: "Reopen card" }).click();
    await page.getByText("No clips added yet.", { exact: true }).waitFor();
    assert.equal(await page.locator("video").count(), 0);
    assert.deepEqual(errors, []);
    console.log(
      "PASS: real HLS playback, one instance, controls, range capture, failure retention, durable reopen, confirmed removal, fullscreen, precision seek, error/retry and empty state."
    );
    console.log(`Screenshots: ${temp}`);
  }
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
