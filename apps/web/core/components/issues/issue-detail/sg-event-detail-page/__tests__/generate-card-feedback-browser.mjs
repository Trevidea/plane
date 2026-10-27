import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const web = path.resolve(base, "../../../../..");
const repo = path.resolve(web, "../..");
const require = createRequire(path.join(web, "package.json"));
const { build } = require(process.env.ESBUILD_PACKAGE_PATH || "esbuild");
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE_PATH || "playwright");
const tailwindRequire = createRequire(path.join(repo, "packages/tailwind-config/package.json"));
const postcss = tailwindRequire("postcss");
const tailwind = tailwindRequire("tailwindcss");
const temp = await mkdtemp(path.join(tmpdir(), "card-feedback-"));
execFileSync("ffmpeg", [
  "-v",
  "error",
  "-f",
  "lavfi",
  "-i",
  "color=c=navy:s=320x180:r=10",
  "-t",
  "8",
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  "-movflags",
  "+faststart",
  path.join(temp, "clip.mp4"),
]);
await writeFile(path.join(temp, "annotation.tsx"), "export const VideoAnnotationEditor = () => null;");
await writeFile(
  path.join(temp, "ui.tsx"),
  `
import { forwardRef } from 'react';
export { ModalCore } from ${JSON.stringify(path.join(repo, "packages/ui/src/modals/modal-core"))};
export { EModalWidth, EModalPosition } from ${JSON.stringify(path.join(repo, "packages/ui/src/modals/constants"))};
export const Button = forwardRef(({unstyled, children, ...props}, ref) => <button ref={ref} {...props}>{children}</button>);
export const ImageWithFallback = ({fallbackSrc, ...props}) => <img {...props}/>;
export const Tooltip = ({children}) => children;
export const CustomSelect = ({children}) => <div>{children}</div>; CustomSelect.Option = ({children}) => <span>{children}</span>;
export const CustomMenu = ({children}) => <div>{children}</div>; CustomMenu.MenuItem = ({children}) => <span>{children}</span>;
export const AlertModalCore = () => null;
export const Input = forwardRef((props, ref) => <input ref={ref} {...props}/>);
export const ComboDropDown = ({children}) => <div>{children}</div>;
export { DEFAULT_IMAGE, useImageFallback } from ${JSON.stringify(path.join(repo, "packages/ui/src/image/image"))};
`
);
await writeFile(
  path.join(temp, "fixture.tsx"),
  `
import { useMemo, useState } from 'react'; import { createRoot } from 'react-dom/client';
import { MatrixTable } from ${JSON.stringify(path.join(base, "matrix-view/components/matrix-table"))};
import { SgEventTagsPanel } from ${JSON.stringify(path.join(base, "tags-view/components/tags-panel"))};
import { CreateCardModal } from ${JSON.stringify(path.join(base, "create-card-modal"))};
import { useSgEventPlaybackState } from ${JSON.stringify(path.join(base, "hooks/use-sg-event-playback-state"))};
import { SgEventVideoPlayer } from ${JSON.stringify(path.join(base, "sg-event-video-player"))};
import { useSgEventClipQueue } from ${JSON.stringify(path.join(base, "hooks/use-sg-event-clip-queue"))};
import { SgEventPlayerResizeHandle } from ${JSON.stringify(path.join(base, "player-resize-handle"))};
import { PLAYER_FRAME_CLASS } from ${JSON.stringify(path.join(base, "constants"))};
const rows = ['a','b','c','d','e'].map((id, i) => ({ id, action:'Run', clipDurationSeconds:8, clipStartSeconds:100+i*20, clipEndSeconds:108+i*20, clipId:id, context:{}, groupValue:'Quarter 1', matrixParticipant:null, matrixPeriod:null, player:'12', playlistTimestamp:id, playlistFallbackTimestamp:null, primaryDetail:'1st & 10', result:'Complete', secondaryDetail:'', sourceTagId:id, sourceUrl:'', team:'home', thumbnailUrl:'/poster.svg', timecode:'01:40-01:48', streamName:'camera' }));
const column = {id:'run', label:'Run', order:0, visible:true};
const cell = {id:'cell', sourceRowIds:rows.map(r=>r.id), count:5};
const matrix = {orientation:'actions-by-entities', entities:[], columns:[column], rows:[{id:'home',label:'home',visible:true,total:5,average:5,cells:{run:cell}}], cells:{cell}};
const noop = () => {};
window.fetch = async () => new Response('#EXTM3U\\n#EXTINF:8,\\nsegment.ts');
function PlayerFixture() {
 const [item,setItem] = useState(null);const [seek,setSeek]=useState(null);
 const load = async (row,offset) => {setItem({id:'sg-tag-'+row.id,mediaType:'video',format:'mp4',videoSrc:'/clip.mp4?'+row.id,meta:{playlistFileName:row.id},thumbnail:''});setSeek(offset);};
 const queue = useSgEventClipQueue(load, setSeek);
 return <section aria-label="Player test" className="sg-matrix-workspace"><button onClick={()=>queue.playRows(rows)}>Start player queue</button><button onClick={()=>{queue.clear();void load({...rows[0],id:"single"},0);}}>Standalone player tag</button><div className="grid grid-cols-2"><SgEventVideoPlayer item={item} clipPlayback={queue.playback} seekToSeconds={seek} onPlaybackTimeChange={queue.updateTime} showAnnotations={false} showAnnotationButton={false}/><aside data-testid="staging-frame" className={PLAYER_FRAME_CLASS}>Staging area</aside></div><SgEventPlayerResizeHandle/><output data-testid="player-clip">{item?.id}</output></section>;
}
function Fixture() {
 const [selected, setSelected] = useState([]); const [plays, setPlays] = useState(0); const [modal, setModal] = useState(false);
 const service = useMemo(() => ({createPlaylist: async (entries) => { const id=entries[0].timestamp; await new Promise(r=>setTimeout(r, id==='a'?80:5)); return id+'.m3u8'; }}), []);
 const playback = useSgEventPlaybackState({ mediaItem:null, mediaLibraryService:service, primaryStreamName:'camera', resolvedWorkItemId:'event', videoItems:undefined, viewDevices:[] });
 const queue = playback.clipPlayback;
 return <><PlayerFixture/><section aria-label="Queue test"><button onClick={()=>playback.handlePlayTagRows(rows)}>Play five tags</button><button onClick={()=>playback.handlePlayTagRows([rows[4]])}>Play fifth only</button><button onClick={()=>playback.handlePlayTagRow(rows[2])}>Play single tag</button><button onClick={()=>playback.handlePlayTagRows(rows.map(row=>({...row,playlistTimestamp:null})))}>Play fallback tags</button><button onClick={()=>playback.handlePlaybackTimeChange(103,300)}>Stream tick 103</button><button onClick={()=>queue?.onSeek(21)}>Seek 21</button><button onClick={playback.handleSwitchToFullStream}>Full stream</button><button onClick={()=>queue?.onPrevious()}>Previous</button><button onClick={()=>queue?.onNext()}>Next</button><button onClick={()=>queue?.onSeek(19)}>Seek 19</button><button onClick={()=>queue?.onEnded(false)}>Clip ended</button><button onClick={()=>queue?.onReady?.()}>Media ready</button><output data-testid="active">{playback.playbackItem?.id}</output><output data-testid="time">{queue ? queue.currentSeconds+'/'+queue.durationSeconds : 'no queue'}</output><output data-testid="seek">{playback.pendingSeekSeconds}</output></section>
 <section aria-label="Matrix test"><MatrixTable data={matrix} onCellActivate={noop} selectedCellIds={new Set()}/></section>
 <output data-testid="selection">{selected.join(',')}</output><output data-testid="plays">{plays}</output>
 <SgEventTagsPanel activeFilterLabel="All" activePlaybackOverrideId={null} allVisibleSelected={false} availableGroups={[]} clipThumbnailUrl="" effectiveGroupValue="All tags" favoriteTagIds={[]} isMediaLoading={false} isSearchOpen={false} onPlayTagRow={async ()=>setPlays(p=>p+1)} onRemoveTag={noop} onRowFilterModeChange={noop} onSearchQueryChange={noop} onSelectAll={noop} onSelectedGroupValueChange={noop} onToggleFavorite={noop} onToggleSearch={noop} onToggleTagSelection={id=>setSelected(s=>s.includes(id)?s.filter(x=>x!==id):[...s,id])} onUpdateTag={noop} rowFilterMode="all" rows={[rows[0]]} searchQuery="" selectedTagIds={selected} sportTableConfig={{sport:'american-football', actionLabel:'Action',groupByLabel:'Quarter',primaryDetailLabel:'Down',secondaryDetailLabel:'',playerLabel:'Players',defaultGroupValue:'All tags'}}/>
 <button onClick={()=>setModal(true)}>Open card dialog</button>{modal && <CreateCardModal playlists={[]} rows={[]} rosterPlayers={[]} isRosterLoading={false} hasRosterError={false} onRetryRoster={noop} onClose={()=>setModal(false)} initialContext={{sport:'Football',level:'Varsity',program:'Men',season:'2026'}}/>}
 </>;
} createRoot(document.getElementById('root')).render(<Fixture/>);
`
);
const bundle = await build({
  absWorkingDir: web,
  entryPoints: [path.join(temp, "fixture.tsx")],
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  nodePaths: [path.join(web, "node_modules")],
  alias: {
    "@": path.join(web, "core"),
    "@/helpers": path.join(web, "helpers"),
    "@/components/annotation": path.join(temp, "annotation.tsx"),
    "@plane/ui": path.join(temp, "ui.tsx"),
    "@plane/propel/tooltip": path.join(temp, "ui.tsx"),
  },
  define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" },
});
const css = await postcss([
  tailwind({
    content: [path.join(base, "**/*.{ts,tsx}"), path.join(repo, "packages/ui/src/modals/*.tsx")],
    theme: { extend: { colors: { "custom-backdrop": "rgba(0,0,0,0.1)" } } },
    plugins: [],
  }),
]).process("@tailwind base; @tailwind utilities;", { from: undefined });
const clipBytes = await readFile(path.join(temp, "clip.mp4"));
const videoCss = await readFile(require.resolve("video.js/dist/video-js.css"), "utf8");
const server = createServer((req, res) => {
  if (req.url.startsWith("/clip.mp4")) {
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Accept-Ranges", "bytes");
    const range = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
    if (range) {
      const start = Number(range[1]);
      const end = range[2] ? Math.min(Number(range[2]), clipBytes.length - 1) : clipBytes.length - 1;
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${clipBytes.length}`,
        "Content-Length": end - start + 1,
      });
      res.end(clipBytes.subarray(start, end + 1));
    } else {
      res.setHeader("Content-Length", clipBytes.length);
      res.end(clipBytes);
    }
  } else if (req.url === "/app.js") {
    res.setHeader("Content-Type", "application/javascript");
    res.end(bundle.outputFiles[0].text);
  } else if (req.url === "/poster.svg") {
    res.setHeader("Content-Type", "image/svg+xml");
    res.end('<svg xmlns="http://www.w3.org/2000/svg" width="74" height="40"/>');
  } else
    res.end(
      "<html><head><style>" +
        videoCss +
        css.css +
        '</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>'
    );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
const failures = [];
try {
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:" + server.address().port);
  async function check(name, fn) {
    try {
      await fn();
      console.log("PASS " + name);
    } catch (error) {
      failures.push(name + ": " + error.message);
      console.error("FAIL " + name + ": " + error.stack);
      if (name.startsWith("real player"))
        console.error(
          JSON.stringify(
            await page.locator(".sg-event-player").evaluateAll((elements) =>
              elements.map((el) => ({
                html: el.className,
                video: [...el.querySelectorAll("video")].map((v) => ({
                  src: v.currentSrc,
                  time: v.currentTime,
                  duration: v.duration,
                  paused: v.paused,
                  ended: v.ended,
                  ready: v.readyState,
                })),
                text: el.innerText,
              }))
            ),
            null,
            2
          )
        );
    }
  }
  await check("all five clips navigate and wrap with a forty-second duration", async () => {
    await page.getByRole("button", { name: "Play five tags", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("[data-testid=active]")?.textContent === "sg-tag-a");
    assert.equal(await page.getByTestId("time").innerText(), "0/40");
    for (const [id, time] of [
      ["b", "8/40"],
      ["c", "16/40"],
      ["d", "24/40"],
      ["e", "32/40"],
      ["a", "0/40"],
    ]) {
      await page.getByRole("button", { name: "Next", exact: true }).click();
      await page.waitForFunction(
        (id) => document.querySelector("[data-testid=active]")?.textContent === "sg-tag-" + id,
        id
      );
      assert.equal(await page.getByTestId("time").innerText(), time);
    }
    await page.getByRole("button", { name: "Previous", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("[data-testid=active]")?.textContent === "sg-tag-e");
  });
  await check("cumulative seek opens the third clip at three seconds", async () => {
    await page.getByRole("button", { name: "Seek 19", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("[data-testid=active]")?.textContent === "sg-tag-c");
    assert.equal(await page.getByTestId("time").innerText(), "19/40");
    assert.equal(await page.getByTestId("seek").innerText(), "3");
    await page.getByRole("button", { name: "Media ready", exact: true }).click();
    await page.getByRole("button", { name: "Clip ended", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("[data-testid=active]")?.textContent === "sg-tag-d");
  });
  await check("a slow old request cannot replace the latest selection or full stream", async () => {
    await page.getByRole("button", { name: "Play five tags", exact: true }).click();
    await page.getByRole("button", { name: "Play fifth only", exact: true }).click();
    await page.waitForTimeout(150);
    assert.equal(await page.getByTestId("active").innerText(), "sg-tag-e");
    await page.getByRole("button", { name: "Play five tags", exact: true }).click();
    await page.getByRole("button", { name: "Full stream", exact: true }).click();
    await page.waitForTimeout(150);
    assert.equal(await page.getByTestId("active").innerText(), "");
    assert.equal(await page.getByTestId("time").innerText(), "no queue");
  });
  await check("single tag playback clears the selected-clip queue", async () => {
    await page.getByRole("button", { name: "Play single tag", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("[data-testid=active]")?.textContent === "sg-tag-c");
    assert.equal(await page.getByTestId("time").innerText(), "no queue");
  });
  await check("full-stream fallback uses clip-relative timing and absolute media seeks", async () => {
    await page.getByRole("button", { name: "Play fallback tags", exact: true }).click();
    await page.getByRole("button", { name: "Media ready", exact: true }).click();
    await page.getByRole("button", { name: "Stream tick 103", exact: true }).click();
    assert.equal(await page.getByTestId("time").innerText(), "3/40");
    await page.getByRole("button", { name: "Seek 19", exact: true }).click();
    assert.equal(await page.getByTestId("seek").innerText(), "143");
    await page.getByRole("button", { name: "Seek 21", exact: true }).click();
    assert.equal(await page.getByTestId("seek").innerText(), "145");
  });
  await check("pending media events cannot change the new selection's timeline", async () => {
    await page.getByRole("button", { name: "Play five tags", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("[data-testid=active]")?.textContent === "sg-tag-a");
    await page.getByRole("button", { name: "Stream tick 103", exact: true }).click();
    assert.equal(await page.getByTestId("time").innerText(), "0/40");
  });
  await check("real player uses one cumulative timeline and clip navigation", async () => {
    const player = page.getByRole("region", { name: "Player test" });
    await player.getByRole("button", { name: "Start player queue" }).click();
    await player.locator("video").evaluate(
      (video) =>
        new Promise((resolve) => {
          if (video.readyState >= 2) resolve();
          else video.addEventListener("loadeddata", resolve, { once: true });
        })
    );
    await player.locator("video").evaluate((video) => video.pause());
    const slider = player.getByRole("slider", { name: "Selected clips timeline" });
    assert.equal(await slider.isVisible(), true);
    assert.equal(await slider.getAttribute("max"), "40");
    assert.equal(await player.locator(".vjs-progress-control").isVisible(), false);
    assert.equal(await player.locator(".vjs-current-time").isVisible(), false);
    assert.equal(await player.locator(".vjs-load-progress").isVisible(), false);
    await player.locator(".video-js").hover();
    await player.getByRole("button", { name: "Next clip", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("[data-testid=player-clip]")?.textContent === "sg-tag-b");
    await player.locator(".video-js").hover();
    await player.getByRole("button", { name: "Previous clip", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("[data-testid=player-clip]")?.textContent === "sg-tag-a");
    await player.locator("video").evaluate(
      (video) =>
        new Promise((resolve) => {
          if (video.readyState >= 2) resolve();
          else video.addEventListener("loadeddata", resolve, { once: true });
        })
    );
    await page.waitForFunction(() => {
      const video = document.querySelector('[aria-label="Player test"] video');
      return video?.currentSrc.endsWith("/clip.mp4?a") && video.readyState >= 2 && video.currentTime < 1;
    });
    await player.locator("video").evaluate((video) => {
      video.currentTime = 7.9;
      void video.play();
    });
    await page.waitForFunction(() => document.querySelector("[data-testid=player-clip]")?.textContent === "sg-tag-b");
    await player.locator("video").evaluate((video) => video.pause());
  });
  await check("standalone tag playback pauses at its final frame", async () => {
    const player = page.getByRole("region", { name: "Player test" });
    await player.getByRole("button", { name: "Standalone player tag" }).click();
    await page.waitForFunction(() => {
      const v = document.querySelector('[aria-label="Player test"] video');
      return v?.currentSrc.endsWith("/clip.mp4?single") && v.readyState >= 2;
    });
    assert.equal(await player.locator("video").evaluate((v) => v.loop), false);
    await player.locator("video").evaluate((v) => {
      v.currentTime = 7.9;
      void v.play();
    });
    await page.waitForFunction(() => {
      const v = document.querySelector('[aria-label="Player test"] video');
      return v?.paused && v.currentTime >= 7.9;
    });
  });
  await check("keyboard and pointer resize player and staging area together", async () => {
    const player = page.getByRole("region", { name: "Player test" });
    const divider = player.getByRole("separator");
    await divider.focus();
    await page.keyboard.press("Home");
    assert.equal(Math.round((await player.locator(".sg-event-player").boundingBox()).height), 180);
    assert.equal(Math.round((await player.getByTestId("staging-frame").boundingBox()).height), 180);
    await page.keyboard.press("ArrowDown");
    assert.equal(Math.round((await player.locator(".sg-event-player").boundingBox()).height), 204);
    const box = await divider.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 60);
    await page.mouse.up();
    assert.equal(Math.round((await player.locator(".sg-event-player").boundingBox()).height), 264);
    assert.equal(Math.round((await player.getByTestId("staging-frame").boundingBox()).height), 264);
    await divider.focus();
    await page.keyboard.press("End");
    await page.setViewportSize({ width: 1280, height: 500 });
    await page.waitForFunction(
      () =>
        document.querySelector('[aria-label="Resize video and staging area"]')?.getAttribute("aria-valuenow") === "280"
    );
    assert.equal(Math.round((await player.locator(".sg-event-player").boundingBox()).height), 280);
    await page.setViewportSize({ width: 1280, height: 900 });
  });
  await check("matrix header occupies the same height as its data rows", async () => {
    const heights = await page
      .getByRole("region", { name: "Matrix test" })
      .locator("tr")
      .evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height));
    assert.ok(Math.abs(heights[0] - heights[1]) <= 1, JSON.stringify(heights));
  });
  await check("thumbnail click and keyboard toggle selection without playing the row", async () => {
    const thumbnail = page.locator('img[src="/poster.svg"]').first();
    await thumbnail.click();
    assert.equal(await page.getByTestId("selection").innerText(), "a");
    assert.equal(await page.getByTestId("plays").innerText(), "0");
    const button = page.getByRole("button", { name: "Select clip 1: Run", exact: true });
    await button.focus();
    await page.keyboard.press("Space");
    assert.equal(await page.getByTestId("selection").innerText(), "");
    assert.equal(await page.getByTestId("plays").innerText(), "0");
  });
  await check("Create Card has an opaque dimmed and blurred backdrop", async () => {
    await page.getByRole("button", { name: "Open card dialog", exact: true }).click();
    const backdrop = page.locator("[role=dialog] .fixed.inset-0").first();
    await page.waitForTimeout(350);
    const styles = await backdrop.evaluate((el) => ({
      background: getComputedStyle(el).backgroundColor,
      blur: getComputedStyle(el).backdropFilter,
    }));
    assert.match(styles.background, /0\.55\)/);
    assert.notEqual(styles.blur, "none");
    await page.getByRole("button", { name: "Close create card" }).click();
  });
  assert.deepEqual(errors, []);
  if (failures.length) throw new Error(failures.join("\n"));
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
