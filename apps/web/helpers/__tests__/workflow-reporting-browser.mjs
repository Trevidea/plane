// Real reporting UI, Axios card writes, upload queue and existing job polling.
// Only loopback fixture responses are used; no customer data or production calls.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
const require = createRequire(import.meta.url);
const { build } = require(process.env.ESBUILD_MODULE || "esbuild");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../../", import.meta.url));
const project = "11111111-1111-4111-8111-111111111111";
const temp = await mkdtemp(path.join(os.tmpdir(), "plane-workflow-browser-"));
const budgets = {
  tag: [2000, 5000],
  "event-start": [5000, 15000],
  "event-stop": [5000, 15000],
  upload: [15000, 30000],
  playback: [8000, 20000],
  "coaching-card": [3000, 10000],
  "media-finalization": [60000, 180000],
};
const policy = {
  version: 2,
  revision: "2.0.0",
  policy_id: "a".repeat(64),
  notice_cooldown_ms: 60000,
  operations: Object.fromEntries(
    Object.entries(budgets).map(([kind, [warning, finding]]) => [
      kind,
      {
        warning_after_ms: warning,
        finding_after_ms: finding,
        tracking_expiry_ms: 3600000,
        request_timeout_ms: null,
        measurement: kind === "upload" ? "inactivity" : "elapsed",
      },
    ])
  ),
};
let browser, server;
try {
  const video = path.join(temp, "ready.mp4");
  const generated = spawnSync(
    process.env.FFMPEG_PATH || "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=320x180:rate=15",
      "-t",
      "3",
      "-c:v",
      "libx264",
      "-threads",
      "2",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      video,
    ],
    { encoding: "utf8", timeout: 30000 }
  );
  assert.equal(generated.status, 0, generated.stderr || String(generated.error));
  const media = await readFile(video);
  const bundle = await build({
    stdin: {
      resolveDir: root,
      loader: "tsx",
      contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';
      import {WorkflowReporting} from './core/components/profile/diagnostics/workflow-reporting';
      import {MediaLibraryProvider,useMediaLibrary} from './ce/features/media-library/store/media-library-context';
      import {IssueService} from './core/services/issue/issue.service';
      import {observeVideoReadiness} from './helpers/workflow-diagnostics';
      const issue=new IssueService();
      function Video(){const ref=React.useRef(null);React.useEffect(()=>{const diagnostic=observeVideoReadiness(ref.current,true);return()=>diagnostic.dispose();},[]);return <video aria-label="Playback fixture" ref={ref} autoPlay muted playsInline src="/ready.mp4" style={{width:320,maxWidth:'100%'}}/>;}
      function Controls(){const library=useMediaLibrary();const [playing,setPlaying]=React.useState(false);window.harness={jobs:()=>library.uploadJobs};return <main><h1>Workflow verification</h1><button onClick={()=>void issue.transitionCoachingCard('school','${project}','card','resolved').catch(()=>undefined)}>Move card</button><button onClick={()=>library.enqueueUploadBatch({workspaceSlug:'school',projectId:'${project}',files:[new File([new Uint8Array(32768)],'synthetic.mp4',{type:'video/mp4'})],meta:{source:'web'}})}>Upload video</button><button onClick={()=>library.trackTranscodeJob({workspaceSlug:'school',projectId:'${project}',packageId:'package',artifactId:'artifact',jobId:'job'})}>Track job</button><button onClick={()=>setPlaying(true)}>Play preview</button>{playing?<Video/>:null}</main>;}
      createRoot(document.getElementById('root')).render(<MediaLibraryProvider><WorkflowReporting/><Controls/></MediaLibraryProvider>);
    `,
    },
    bundle: true,
    write: false,
    platform: "browser",
    jsx: "automatic",
    tsconfig: path.join(root, "tsconfig.json"),
    define: { "process.env": "{}", "process.env.NODE_ENV": '"production"' },
    plugins: [
      {
        name: "fixtures",
        setup(builder) {
          builder.onResolve(
            {
              filter:
                /^next\/navigation$|^@plane\/(constants|types|utils|shared-state)$|^@plane\/propel\/toast$|^@\/local-db\/|media-library-filters$|\/media-items$/,
            },
            (args) => ({ path: args.path, namespace: "fixture" })
          );
          builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path: name }) => ({
            loader: "js",
            contents:
              name === "next/navigation"
                ? `export const useParams=()=>({workspaceSlug:'school',projectId:'${project}'});export const usePathname=()=>'/school/projects/${project}/media-library';`
                : name === "@plane/constants"
                  ? `export const API_BASE_URL='';`
                  : name === "@plane/types"
                    ? `export const EIssueServiceType={ISSUES:'issues'};`
                    : name === "@plane/utils"
                      ? `export const getIssuesShouldFallbackToServer=()=>false;`
                      : name.startsWith("@/local-db/")
                        ? `export const persistence={};export const updateIssue=()=>{};export const addIssuesBulk=()=>{};export const deleteIssueFromLocal=()=>{};`
                        : name === "@plane/shared-state"
                          ? `export class FilterInstance{configManager={setAreConfigsReady(){},registerAll(){}}}`
                          : name.includes("toast")
                            ? `export const setToast=()=>{};export const TOAST_TYPE={SUCCESS:'success',ERROR:'error'};`
                            : name.includes("media-items")
                              ? `export const getDocumentThumbnailPath=()=>'';`
                              : `export const mediaLibraryFiltersAdapter={};`,
          }));
        },
      },
    ],
  });
  let css = "";
  try {
    for (const file of await readdir(path.join(root, ".next/static/css"), { recursive: true }))
      if (file.endsWith(".css")) css += await readFile(path.join(root, ".next/static/css", file), "utf8");
  } catch {}
  server = createServer((request, response) => {
    if (request.url === "/bundle.js") {
      response.setHeader("Content-Type", "text/javascript");
      response.end(bundle.outputFiles[0].contents);
    } else if (request.url === "/ready.mp4") {
      response.setHeader("Content-Type", "video/mp4");
      response.end(media);
    } else {
      response.setHeader("Content-Type", "text/html");
      response.end(
        `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{margin:0;font:14px sans-serif}main{padding:20px}h1{font-size:20px}button{margin:4px}aside{position:fixed;right:16px;bottom:20px;width:360px;max-width:calc(100vw - 32px);box-sizing:border-box;background:white;border:1px solid #ddd;padding:16px}dialog{margin:auto;max-width:calc(100vw - 32px);box-sizing:border-box}video{display:block;margin-top:20px}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`
      );
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
    args: ["--no-sandbox"],
    env: { ...process.env, TMPDIR: process.env.CHROME_TMPDIR || os.tmpdir() },
  });
  const passed = [];
  for (const width of [1440, 390])
    for (const scenario of ["card", "upload", "finalization", "playback"]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      page.setDefaultTimeout(20000);
      const errors = [],
        business = [],
        measurements = [],
        reports = [],
        release = [];
      let completed = false;
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/api/**", async (route) => {
        const request = route.request(),
          url = new URL(request.url()),
          view = url.searchParams.get("view");
        if (url.pathname.endsWith("/diagnostics/operations/")) {
          if (view === "capabilities")
            return route.fulfill({
              json: { enabled: true, can_report: true, sharing_enabled: false, operation_policy: policy },
            });
          if (view === "measurement") {
            measurements.push(request.postDataJSON());
            return route.fulfill({ json: { accepted: true } });
          }
          reports.push(request.postDataJSON());
          return route.fulfill({
            status: 202,
            json: {
              incident: {
                id: "a".repeat(32),
                reference: "LOCAL-ONLY",
                analysis_status: "queued",
                submission_status: "not-submitted",
              },
            },
          });
        }
        business.push({ url: request.url(), headers: request.headers(), method: request.method() });
        if (url.pathname.includes("/coaching-cards/")) {
          await new Promise((resolve) => release.push(resolve));
          return route.fulfill({ json: { id: "card", state_id: "resolved", coaching_card_data: {} } });
        }
        if (url.pathname.endsWith("/media-library/")) return route.fulfill({ json: { id: "package" } });
        if (url.pathname.endsWith("/artifacts/")) {
          if (scenario === "upload") await new Promise((resolve) => release.push(resolve));
          return route.fulfill({
            json: {
              name: "artifact",
              title: "Video",
              format: "mp4",
              transcode_job: { job_id: "job", status: "QUEUED" },
            },
          });
        }
        if (url.pathname.includes("/transcode/jobs/"))
          return route.fulfill({
            json: {
              job_id: "job",
              status: completed || scenario === "upload" ? "COMPLETED" : "QUEUED",
              playable_url: completed || scenario === "upload" ? "/ready.mp4" : null,
            },
          });
        return route.fulfill({ status: 404, json: { error: "Unconfigured fixture path" } });
      });
      await page.route("**/ready.mp4", async (route) => {
        await new Promise((resolve) => release.push(resolve));
        return route.continue();
      });
      const capabilities = page.waitForResponse((response) => response.url().includes("view=capabilities"));
      await page.goto(origin);
      await capabilities;
      await page.waitForFunction(() => window.harness);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.clock.install();
      const action =
        scenario === "card" ? "coaching-card" : scenario === "finalization" ? "media-finalization" : scenario;
      const trigger = {
        card: "Move card",
        upload: "Upload video",
        finalization: "Track job",
        playback: "Play preview",
      }[scenario];
      const requestStarted = page.waitForRequest((request) =>
        scenario === "playback"
          ? request.url().endsWith("/ready.mp4")
          : scenario === "card"
            ? request.url().includes("/coaching-cards/")
            : scenario === "upload"
              ? request.url().endsWith("/artifacts/")
              : request.url().includes("/transcode/jobs/")
      );
      await page.getByRole("button", { name: trigger, exact: true }).click();
      await requestStarted;
      await page.clock.fastForward(budgets[action][0] + 500);
      await page.getByRole("complementary", { name: "Operation confirmation issue" }).waitFor();
      await page.getByRole("button", { name: "Report issue", exact: true }).click();
      await page.getByRole("button", { name: "Save report locally", exact: true }).click();
      await page.getByText("LOCAL-ONLY", { exact: true }).waitFor();
      assert.equal(reports.length, 1);
      assert.equal(reports[0].action, action);
      assert.equal(reports[0].share, false);
      await page.getByRole("button", { name: "Close", exact: true }).click();
      if (scenario === "finalization") {
        completed = true;
        await page.clock.fastForward(5001);
      } else release.splice(0).forEach((resolve) => resolve());
      await page.waitForFunction(() =>
        document.querySelector("aside")?.textContent.includes("confirmed after a delay")
      );
      const terminal = {
        upload: "upload.acknowledged",
        playback: "playback.ready",
        card: "coaching-card.acknowledged",
        finalization: "media-finalization.completed",
      }[scenario];
      await page.evaluate(() => Promise.resolve());
      for (let attempt = 0; attempt < 20 && !measurements.some((item) => item.event_name === terminal); attempt++)
        await new Promise((resolve) => setTimeout(resolve, 25));
      assert.equal(measurements.filter((item) => item.event_name === terminal).length, 1);
      const event = measurements.find((item) => item.event_name === terminal);
      assert.equal(event.operation_id, reports[0].operation_id);
      assert.ok(measurements.every((item) => !("file_name" in item) && !("body" in item)));
      if (scenario === "card") assert.equal(business.length, 1, "No automatic card write retry");
      if (scenario === "upload")
        assert.equal(
          business.filter((item) => item.url.endsWith("/artifacts/")).length,
          1,
          "No automatic upload retry"
        );
      if (scenario === "finalization") {
        const polls = business.filter((item) => item.url.includes("/transcode/jobs/"));
        assert.ok(polls.length <= 4);
        assert.ok(polls.every((item) => item.headers["x-kanavio-operation-id"] === event.operation_id));
      }
      if (scenario === "playback") {
        const pixels = await page.locator("video").evaluate((video) => {
          const canvas = document.createElement("canvas");
          canvas.width = 320;
          canvas.height = 180;
          const context = canvas.getContext("2d");
          context.drawImage(video, 0, 0, 320, 180);
          return context
            .getImageData(160, 90, 1, 1)
            .data.slice(0, 3)
            .some((value) => value > 10);
        });
        assert.equal(pixels, true);
      }
      assert.deepEqual(errors, []);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await page.screenshot({ path: path.join(temp, `${scenario}-${width}.png`) });
      passed.push(`${scenario} at ${width}px: report consent, late confirmation, single terminal`);
      await page.close();
    }
  console.log(JSON.stringify({ passed, screenshots: temp }, null, 2));
} finally {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
}
