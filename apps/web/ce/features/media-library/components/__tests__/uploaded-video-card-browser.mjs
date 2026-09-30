import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Render the real uploaded-video modal and exercise its HTTP submission/retry flow.
// Only the surrounding project store and HTTP server are fixtures.
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const require = createRequire(path.join(web, "package.json"));
const { build } = require(process.env.ESBUILD_PACKAGE_PATH || "esbuild");
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE_PATH || "playwright");
const temp = await mkdtemp(path.join(tmpdir(), "uploaded-card-browser-"));
await writeFile(
  path.join(temp, "project.ts"),
  'export const useProject = () => ({ getProjectById: () => ({ name: "Basketball", sport: "" }) });'
);
await writeFile(
  path.join(temp, "fixture.tsx"),
  `
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { UploadedVideoCreateCard } from ${JSON.stringify(path.join(web, "ce/features/media-library/components/uploaded-video-create-card"))};
const item = { id: "video-1", packageId: "library", title: "Annotated practice", thumbnail: "", meta: {} };
function Fixture() {
  const [open, setOpen] = useState(true);
  return open ? <UploadedVideoCreateCard item={item} workspaceSlug="team" projectId="project" durationSeconds={42} onClose={() => setOpen(false)} /> : <p>Card created</p>;
}
createRoot(document.getElementById("root")).render(<Fixture />);
`
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
    "@/hooks/store/use-project": path.join(temp, "project.ts"),
  },
  nodePaths: [path.join(web, "node_modules"), path.resolve(web, "../../node_modules")],
  define: {
    "process.env.NODE_ENV": '"development"',
    "process.env.NEXT_PUBLIC_CP_SERVER_URL": '""',
    "process.env": "{}",
  },
  loader: { ".woff2": "dataurl", ".woff": "dataurl", ".svg": "dataurl", ".png": "dataurl" },
});
const submissions = [];
let rosterRequests = 0;
const server = createServer(async (req, res) => {
  const json = (status, value) =>
    res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(value));
  if (req.url.endsWith("/roster/")) {
    rosterRequests++;
    if (rosterRequests === 1) return json(500, { error: "Temporary roster failure" });
    return json(200, [
      { id: "player-1", player_name: "Alex Morgan", jersey_number: "12", position: "Guard", status: "active" },
    ]);
  }
  if (req.url.endsWith("/create-coaching-cards/")) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    submissions.push(JSON.parse(Buffer.concat(chunks).toString()));
    if (submissions.length === 1) return json(500, { error: "Temporary save failure" });
    return json(201, { cards: [{ id: "card-1" }], created_count: 1 });
  }
  if (req.url === "/fixture.js")
    return res
      .writeHead(200, { "Content-Type": "text/javascript" })
      .end(bundle.outputFiles.find((file) => file.path.endsWith(".js")).text);
  if (req.url.startsWith("/meta-type"))
    return json(200, { "Gateway Response": { result: [[{ field: "values", value: ["Basketball", "Varsity"] }]] } });
  res
    .writeHead(200, { "Content-Type": "text/html" })
    .end('<html><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole("heading", { name: "Create Card", exact: true }).waitFor();
  await page.getByRole("button", { name: /retry/i }).click();
  await page.getByRole("button", { name: "Show roster players", exact: true }).click();
  await page.getByRole("checkbox", { name: /Alex Morgan/ }).check();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByLabel("Title", { exact: false }).fill("Practice feedback");
  await page.getByLabel("Feedback", { exact: true }).fill("Keep your shoulders square.");
  const send = page.getByRole("button", { name: /^Save & Send/ });
  await send.click();
  await page.getByText(/Unable to send this card/).waitFor();
  assert.equal(await page.getByLabel("Title", { exact: false }).inputValue(), "Practice feedback");
  assert.match(await page.locator("body").innerText(), /Alex Morgan/);
  await send.click();
  await page.getByText("Card created", { exact: true }).waitFor();
  assert.equal(submissions.length, 2);
  assert.equal(submissions[0].request_id, submissions[1].request_id);
  assert.deepEqual(submissions[1].source_media, { package_id: "library", artifact_id: "video-1" });
  assert.deepEqual(submissions[1].context, {
    sport: null,
    level: null,
    program: null,
    season: null,
  });
  assert.deepEqual(submissions[1].player_ids, ["player-1"]);
  assert.equal(submissions[1].title, "Practice feedback");
  assert.equal(submissions[1].source_issue_id, undefined);
  assert.equal(submissions[1].playlists, undefined);
  assert.deepEqual(errors, []);
  console.log("PASS: uploaded-video card without metadata, roster retry, retained inputs, idempotent submission, success close");
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
