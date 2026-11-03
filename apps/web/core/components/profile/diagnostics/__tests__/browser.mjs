// Render the real account layout, diagnostics page, charts and HTTP client against synthetic, local-only responses.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(directory, "../../../../..");
const root = path.resolve(web, "../..");
const require = createRequire(path.join(web, "package.json"));
const packages = await readdir(path.join(root, "node_modules/.pnpm"));
const dependency = (name) =>
  path.join(
    root,
    "node_modules/.pnpm",
    packages.find((entry) => entry.startsWith(name + "@")),
    "node_modules",
    name
  );
const { build } = require(dependency("esbuild"));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const temporary = await mkdtemp(path.join(tmpdir(), "kanavio-account-diagnostics-"));
const mocks = path.join(temporary, "mocks.tsx");
await writeFile(
  mocks,
  `
import { useEffect } from "react";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";
export { GROUPED_PROFILE_SETTINGS, PROFILE_SETTINGS_CATEGORIES } from ${JSON.stringify(path.join(root, "packages/constants/src/settings.ts"))};
export const API_BASE_URL = "";
export const cn = (...values) => twMerge(clsx(values));
export const getFileURL = value => value;
export const getUserRole = () => "Admin";
const user = { id: "fixture-user", display_name: "Demo coach", email: "demo@example.test" };
export const useUser = () => ({ data: user });
export const useUserSettings = () => ({ toggleSidebar: () => {} });
export const useWorkspace = () => ({ getWorkspaceBySlug: () => ({ name: "Demo School" }), currentWorkspace: null });
export const useProject = () => ({ joinedProjectIds: [] });
export const useParams = () => ({ workspaceSlug: "school" });
export const usePathname = () => "/school/settings/account/diagnostics/";
export const getProfileActivePath = () => "Diagnostics";
export const useTranslation = () => ({ t: (key) => ({ "your profile": "Your Profile", developer: "Developer",
  "profile.actions.profile": "Profile", "profile.actions.preferences": "Preferences", "profile.actions.notifications": "Notifications",
  "profile.actions.security": "Security", "profile.actions.activity": "Activity", "profile.actions.diagnostics": "Diagnostics",
  "profile.actions.api-tokens": "Personal Access Tokens" })[key] || key });
export default function Link({ href, prefetch, children, ...props }) { return <a href={href} {...props}>{children}</a>; }
export const joinUrlPath = (...values) => "/" + values.map(v => v.replace(/^\\/+|\\/+$/g, "")).join("/");
export const ImageWithFallback = props => <img {...props} />;
export const WorkspaceLogo = () => null;
export const SubscriptionPill = () => null;
export const PageHead = ({ title }) => { useEffect(() => { document.title = title; }, [title]); return null; };
export const SettingsMobileNav = ({ hamburgerContent: Content, activePath }) => <details className="border-b border-custom-border-200 p-3 md:hidden"><summary>{activePath}</summary><Content isMobile /></details>;
`
);
const fixture = path.join(temporary, "fixture.tsx");
await writeFile(
  fixture,
  `
import { createRoot } from "react-dom/client";
import Layout from ${JSON.stringify(path.join(web, "app/(all)/[workspaceSlug]/(settings)/settings/account/layout.tsx"))};
import SettingsTabs from ${JSON.stringify(path.join(web, "core/components/settings/tabs.tsx"))};
import { AccountDiagnosticsPage } from ${JSON.stringify(path.join(web, "core/components/profile/diagnostics/page.tsx"))};
createRoot(document.getElementById("root")).render(<div className="flex h-screen min-w-0 flex-col bg-custom-background-100 p-4 text-custom-text-100 md:p-6">
  <header className="mb-4 space-y-3 border-b border-custom-border-200 pb-4"><h2 className="text-xl font-semibold">Settings</h2><SettingsTabs /></header>
  <div className="min-h-0 flex-1"><Layout><AccountDiagnosticsPage workspaceSlug="school" /></Layout></div>
</div>);
`
);
const aliases = [
  "next/navigation",
  "@plane/constants",
  "@plane/utils",
  "@plane/i18n",
  "@plane/ui",
  "@/hooks/store/user",
  "@/hooks/store/use-workspace",
  "@/hooks/store/use-project",
  "@/components/core/page-title",
  "@/components/settings/helper",
  "@/components/settings/mobile",
  "@/components/workspace/logo",
  "@/plane-web/components/common/subscription/subscription-pill",
];
const bundle = await build({
  entryPoints: [fixture],
  bundle: true,
  write: false,
  format: "iife",
  jsx: "automatic",
  alias: { ...Object.fromEntries(aliases.map((name) => [name, mocks])), "next/link": mocks },
  tsconfig: path.join(web, "tsconfig.json"),
  nodePaths: [path.join(web, "node_modules"), path.join(root, "node_modules")],
  define: { "process.env.NODE_ENV": '"production"' },
});
const config = path.join(temporary, "tailwind.cjs");
await writeFile(
  config,
  `module.exports = { ...require(${JSON.stringify(path.join(root, "packages/tailwind-config/tailwind.config.js"))}), content: [${JSON.stringify(web + "/core/components/profile/diagnostics/**/*.{tsx,ts}")}, ${JSON.stringify(web + "/core/components/settings/**/*.tsx")}, ${JSON.stringify(web + "/app/**/*.tsx")}, ${JSON.stringify(fixture)}] };`
);
const cssFile = path.join(temporary, "fixture.css");
const css = spawnSync(
  process.execPath,
  [
    path.join(dependency("tailwindcss"), "lib/cli.js"),
    "-c",
    config,
    "-i",
    path.join(root, "packages/tailwind-config/global.css"),
    "-o",
    cssFile,
  ],
  { encoding: "utf8" }
);
assert.equal(css.status, 0, css.stderr);
const stylesheet = await readFile(cssFile);

function overview() {
  const now = Date.now();
  const sample = {
    observed_at: new Date(now - 1000).toISOString(),
    memory_total_bytes: 16 * 1024 ** 3,
    memory_available_bytes: 9 * 1024 ** 3,
    storage_total_bytes: 250 * 1024 ** 3,
    storage_available_bytes: 150 * 1024 ** 3,
    missing: [],
    activity: { status: "observed", live_streams: 0, media_jobs: 0 },
  };
  return {
    version: 1,
    observed_at: new Date(now).toISOString(),
    current: {
      status: "observed",
      samples: [sample],
      interval: {
        seconds: 30,
        cpu_busy_ratio: 0.27,
        network_rx_bytes_per_second: 14000,
        network_tx_bytes_per_second: 5000,
        network_errors_delta: 0,
        network_dropped_delta: 0,
      },
    },
    automation: {
      enabled: true,
      status: "idle",
      daily_at: "02:00",
      timezone: "Asia/Kolkata",
      pending_runs: 0,
      overdue: false,
      last_completed_at: new Date(now - 3600000).toISOString(),
    },
    sharing_enabled: false,
    runs: Array.from({ length: 5 }, (_, i) => ({
      id: "run-" + i,
      kind: "scheduled",
      status: "completed",
      reason_code: "",
      created_at: new Date(now - (i + 1) * 3600000).toISOString(),
      updated_at: new Date(now - i * 3600000).toISOString(),
      window: { from: new Date(now - (i + 1) * 3600000).toISOString(), to: new Date(now - i * 3600000).toISOString() },
      report_available: true,
      customer_summary: {
        headline: "Analysis completed with partial evidence",
        status: "partial",
        actions: [
          { check_id: "coverage", title: "Some operations have no browser confirmation timing.", severity: "info" },
        ],
      },
      statistics: {
        coverage: "partial",
        summary: {
          operations: [36, 42, 31, 48, 25][i],
          error_events: [2, 0, 1, 3, 0][i],
          latency_ms: {
            p50: [340, 410, 320, 560, 460][i],
            p95: i === 2 ? null : [1200, 1700, 0, 2300, 1900][i],
            p99: null,
          },
        },
      },
    })),
    incidents: [
      {
        id: "incident-1",
        reference: "LOCAL-104",
        action: "tagging",
        received_at: new Date(now - 600000).toISOString(),
        analysis_status: "completed",
        analysis_reason: "",
        submission_status: "not-submitted",
        submission_reason: null,
        support_reference: null,
        evidence_preservation: "retained",
      },
      {
        id: "incident-2",
        reference: "LOCAL-105",
        action: "media-finalization",
        received_at: new Date(now - 600000).toISOString(),
        analysis_status: "completed",
        analysis_reason: "",
        submission_status: "received",
        submission_reason: null,
        support_reference: "KAN-DEMO-105",
        evidence_preservation: "retained",
        support_update: {
          checked_at: now / 1000,
          update: {
            status: "advice-ready",
            message: "Review the configured worker limit with your installation operator.",
            updated_at: new Date(now).toISOString(),
          },
        },
      },
    ],
  };
}
let scenario = "healthy";
let delay = 0;
const calls = [];
const server = createServer(async (req, res) => {
  if (req.url === "/fixture.js")
    return res.writeHead(200, { "content-type": "text/javascript" }).end(bundle.outputFiles[0].text);
  if (req.url === "/fixture.css") return res.writeHead(200, { "content-type": "text/css" }).end(stylesheet);
  if (req.url === "/api/workspaces/school/diagnostics/") {
    calls.push({ method: req.method, scenario });
    const value = overview();
    let status = 200;
    if (scenario === "stale") value.current.samples[0].observed_at = "2020-01-01T00:00:00Z";
    if (scenario === "partial") value.current.interval.cpu_busy_ratio = null;
    if (scenario === "warning") {
      value.current.interval.cpu_busy_ratio = 0.96;
      value.current.interval.network_errors_delta = 2;
    }
    if (scenario === "empty") {
      value.current.samples = [];
      value.runs = [];
      value.incidents = [];
    }
    if (scenario === "forbidden") status = 403;
    if (scenario === "unavailable") status = 503;
    const body =
      scenario === "disabled"
        ? { version: 1, enabled: false }
        : status !== 200
          ? {
              error:
                status === 403
                  ? "Workspace administrator access is required."
                  : "Diagnostics is temporarily unavailable.",
            }
          : value;
    return setTimeout(
      () =>
        res
          .writeHead(status, { "content-type": "application/json", "cache-control": "no-store" })
          .end(JSON.stringify(body)),
      delay
    );
  }
  res
    .writeHead(200, { "content-type": "text/html" })
    .end(
      '<!doctype html><html data-theme="dark"><head><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'
    );
});
await new Promise((resolve) =>
  server.listen(process.argv.includes("--preview") ? Number(process.env.PREVIEW_PORT || 3100) : 0, "127.0.0.1", resolve)
);
const origin = `http://127.0.0.1:${server.address().port}`;
if (process.argv.includes("--preview")) {
  console.log(
    JSON.stringify({
      url: origin + "/school/settings/account/diagnostics/",
      data: "synthetic-local-only",
      mode: "read-only component preview",
    })
  );
  const close = () => server.close(() => process.exit(0));
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
  await new Promise(() => {});
}
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) =>
    route
      .request()
      .url()
      .startsWith(origin + "/")
      ? route.continue()
      : route.abort()
  );
  const load = async (name) => {
    scenario = name;
    await page.goto(origin + "/school/settings/account/diagnostics/");
    await page.waitForSelector("h1");
  };
  await load("healthy");
  await page.getByText("Resources within observed thresholds", { exact: true }).waitFor();
  assert.equal(await page.locator('a[href="/school/settings/account/diagnostics"]:visible').count(), 1);
  assert.ok((await page.locator("svg.recharts-surface").count()) >= 5);
  await page.screenshot({ path: path.join(temporary, "desktop.png"), fullPage: true });
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
  await page.screenshot({ path: path.join(temporary, "desktop-light.png"), fullPage: true });
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  await page.getByRole("tab", { name: "Analysis history" }).click();
  await page
    .getByRole("button", { name: /^View analysis/ })
    .first()
    .click();
  await page.getByText("Analysis completed with partial evidence", { exact: true }).waitFor();
  await page.screenshot({ path: path.join(temporary, "history.png"), fullPage: true });
  await page.getByRole("tab", { name: "Reported issues" }).click();
  await page.getByRole("cell", { name: "Stored locally", exact: false }).waitFor();
  await page.getByRole("combobox", { name: "Filter reported issues" }).selectOption("received");
  await page
    .getByText("Review the configured worker limit with your installation operator.", { exact: true })
    .waitFor();
  assert.equal(await page.getByText("LOCAL-104", { exact: true }).count(), 0);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: path.join(temporary, `support-update-${width}.png`), fullPage: true });
  }
  await page.getByRole("combobox", { name: "Filter reported issues" }).selectOption("local");
  await page.getByText("LOCAL-104", { exact: true }).waitFor();
  assert.equal(await page.getByText("KAN-DEMO-105", { exact: true }).count(), 0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("tab", { name: "Overview" }).click();
  delay = 700;
  await page.getByRole("button", { name: "Refresh diagnostics" }).click();
  assert.equal(await page.getByText("CPU utilization", { exact: true }).count(), 1);
  await page.waitForFunction(() => !document.querySelector('[aria-label="Refresh diagnostics"]').disabled);
  delay = 0;
  for (const width of [390, 320, 844]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({ path: path.join(temporary, `viewport-${width}.png`), fullPage: true });
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `Horizontal page overflow at ${width}`
    );
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  scenario = "unavailable";
  await page.getByRole("button", { name: "Refresh diagnostics" }).click();
  await page.getByText("Unable to refresh diagnostics", { exact: true }).waitFor();
  assert.equal(await page.getByText("CPU utilization", { exact: true }).count(), 1);
  scenario = "forbidden";
  await page.getByRole("button", { name: "Refresh diagnostics" }).click();
  await page.getByText("Diagnostics access unavailable", { exact: true }).waitFor();
  assert.equal(await page.locator("svg.recharts-surface").count(), 0);
  for (const [name, text] of [
    ["partial", "Current health is not fully measured"],
    ["stale", "Current health is not fully measured"],
    ["warning", "Attention required"],
    ["disabled", "Diagnostics is not enabled"],
    ["forbidden", "Diagnostics access unavailable"],
    ["unavailable", "Unable to refresh diagnostics"],
    ["empty", "No complete confirmation measurements"],
  ]) {
    await load(name);
    await page.getByText(text, { exact: true }).waitFor();
    if (["disabled", "forbidden", "unavailable"].includes(name))
      assert.equal(await page.locator("svg.recharts-surface").count(), 0);
    if (name === "stale")
      assert.equal(
        await page.locator('[data-resource="CPU utilization"]').getByText("Not measured", { exact: true }).count(),
        2
      );
    if (name === "warning") await page.screenshot({ path: path.join(temporary, "warning.png"), fullPage: true });
  }
  assert.equal(errors.length, 0, errors.join("\n"));
  assert.ok(calls.length >= 9 && calls.every((call) => call.method === "GET"));
  console.log(
    JSON.stringify({
      screenshots: temporary,
      cases: [
        "navigation",
        "charts",
        "history",
        "issue-filter",
        "refresh-without-flash",
        "failed-refresh-retains-data",
        "revoked-access-hides-data",
        "mobile",
        "partial",
        "stale",
        "warning",
        "disabled",
        "forbidden",
        "unavailable",
        "empty",
      ],
      requests: calls.length,
      pageErrors: errors.length,
      data: "synthetic-local-only",
    })
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
