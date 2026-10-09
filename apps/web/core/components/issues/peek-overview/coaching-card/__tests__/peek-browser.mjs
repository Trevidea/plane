import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Exercise the real URL adapter and clip dialog. Only the surrounding stores/router are fixtures.
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const require = createRequire(path.join(web, "package.json"));
const { build } = require(process.env.ESBUILD_PACKAGE_PATH || "esbuild");
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE_PATH || "playwright");
const temp = await mkdtemp(path.join(tmpdir(), "coaching-peek-browser-"));
const card1 = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const card2 = "11111111-2222-4333-8444-555555555555";
await writeFile(
  path.join(temp, "store.ts"),
  `
import { useSyncExternalStore } from "react";
let selection;
const listeners = new Set();
const store = {
  get peekIssue() { return selection; },
  setPeekIssue(value) { selection = value; for (const listener of listeners) listener(); },
  issue: { getIssueById: (id) => ({ id, category: "Coaching Card" }) }
};
export const useIssueDetail = () => {
  useSyncExternalStore((callback) => { listeners.add(callback); return () => listeners.delete(callback); }, () => selection);
  return store;
};
`
);
await writeFile(
  path.join(temp, "router.ts"),
  `
export const useParams = () => ({ workspaceSlug: "team", projectId: "project" });
export const usePathname = () => "/team/projects/project/issues/";
`
);
await writeFile(path.join(temp, "i18n.ts"), `export const useTranslation = () => ({ t: (value) => value });`);
await writeFile(
  path.join(temp, "editor.tsx"),
  `
import { useEffect, useState } from "react";
export const IssueDescriptionInput = ({ disabled, initialValue, onDescriptionChange }) => {
  const [value, setValue] = useState(initialValue);
  // Match the native editor's recreation when editable changes.
  useEffect(() => setValue(initialValue), [disabled]);
  return disabled ? <div data-testid="note-view">{value}</div>
    : <textarea aria-label="Coaching note draft" value={value}
        onChange={(event) => { setValue(event.target.value); onDescriptionChange(event.target.value); }} />;
};
`
);
await writeFile(
  path.join(temp, "services.ts"),
  `
export class IssueService {}
export class IssueArchiveService {}
export class WorkspaceDraftService {}
`
);
await writeFile(
  path.join(temp, "media.ts"),
  `export const useMediaLibraryItems = () => ({ items: [], isLoading: false }); export const useResolvedMediaSources = () => ({ effectiveVideoSrc: "" });`
);
await writeFile(path.join(temp, "persistence.ts"), `export const persistence = {};`);
await writeFile(
  path.join(temp, "fixture.tsx"),
  `
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { useIssueDetail } from ${JSON.stringify(path.join(temp, "store.ts"))};
import { useCoachingPeekUrl } from ${JSON.stringify(path.join(web, "core/components/issues/peek-overview/coaching-card/use-coaching-peek-url"))};
import { CoachingCardAddClip } from ${JSON.stringify(path.join(web, "core/components/issues/issue-detail/coaching-card-add-clip"))};
import { CoachingCardNote } from ${JSON.stringify(path.join(web, "core/components/issues/peek-overview/coaching-card/note"))};
import { IssueStore } from ${JSON.stringify(path.join(web, "core/store/issue/issue-details/issue.store"))};
let stored;
const detailStore = new IssueStore({ rootIssueStore: { issues: {
  addIssue: ([issue]) => { stored = { ...stored, ...issue }; },
  getIssueById: () => stored
} } }, "ISSUES");
detailStore.addIssueToStore({ id: "card", category: "Coaching Card", coaching_card_data: { kind: "coaching_card", card_type: "Correction" }, roster_player_id: "player", position_group: "RB" });
// SQLite caches generic issue fields only. Hydrating them must retain board metadata.
const normalized = detailStore.addIssueToStore({ id: "card", category: "Coaching Card", description_html: "Cached note" });
function Fixture() {
  useCoachingPeekUrl(true);
  const { peekIssue, setPeekIssue } = useIssueDetail();
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState("Original instruction");
  const [failSave, setFailSave] = useState(false);
  const [saves, setSaves] = useState(0);
  const open = (issueId) => setPeekIssue({ workspaceSlug: "team", projectId: "project", issueId });
  return <>
    <div id="board" style={{ height: 100, overflow: "auto" }}><div style={{ height: 1000 }}>Coaching board</div></div>
    <button onClick={() => open(${JSON.stringify(card1)})}>First card</button>
    <button onClick={() => open(${JSON.stringify(card2)})}>Second card</button>
    <output data-testid="selection">{peekIssue?.issueId || "closed"}</output>
    {peekIssue && <button onClick={() => setPeekIssue(undefined)}>Close peek</button>}
    <button onClick={() => setAdding(true)}>Add clip</button>
    {adding && <CoachingCardAddClip onClose={() => setAdding(false)} />}
    <output data-testid="normalized">{JSON.stringify(normalized)}</output>
    <button onClick={() => setFailSave(!failSave)}>Toggle save failure</button>
    <span data-testid="note-saves">{saves}</span>
    <CoachingCardNote issue={{ id: "note", description_html: note }} workspaceSlug="team" projectId="project"
      disabled={false} issueOperations={{}} editorRef={{ current: null }} onSave={async ({ feedback }) => {
        await new Promise((resolve) => setTimeout(resolve, 60));
        if (failSave) throw new Error("Save failed");
        setSaves(saves + 1); setNote(feedback);
      }} />
  </>;
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
    "@/hooks/store/use-issue-detail": path.join(temp, "store.ts"),
    "next/navigation": path.join(temp, "router.ts"),
    "@plane/i18n": path.join(temp, "i18n.ts"),
    "@/services/issue": path.join(temp, "services.ts"),
    "ce/features/media-library/hooks/use-media-library-items": path.join(temp, "media.ts"),
    "ce/features/media-library/hooks/media-detail-hooks": path.join(temp, "media.ts"),
    "@/local-db/storage.sqlite": path.join(temp, "persistence.ts"),
  },
  nodePaths: [path.join(web, "node_modules"), path.resolve(web, "../../node_modules")],
  define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" },
  loader: { ".woff2": "dataurl", ".woff": "dataurl", ".svg": "dataurl", ".png": "dataurl" },
  plugins: [
    {
      name: "editor-fixture",
      setup(builder) {
        builder.onResolve({ filter: /^\.\.\/\.\.\/description-input$/ }, () => ({
          path: path.join(temp, "editor.tsx"),
        }));
      },
    },
  ],
});
const server = createServer((req, res) => {
  if (req.url === "/fixture.js")
    return res
      .writeHead(200, { "Content-Type": "text/javascript" })
      .end(bundle.outputFiles.find((file) => file.path.endsWith(".js")).text);
  res
    .writeHead(200, { "Content-Type": "text/html" })
    .end('<html><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const board = `http://127.0.0.1:${server.address().port}/team/projects/project/issues/?group_by=state&sport=Football`;
  const expectSelection = (id) =>
    page.waitForFunction((value) => document.querySelector("output")?.textContent === value, id);
  await page.goto(board);
  await expectSelection("closed");
  await page.locator("#board").evaluate((element) => {
    element.scrollTop = 300;
  });
  await page.getByRole("button", { name: "First card" }).click();
  await expectSelection(card1);
  await page.waitForURL(`**&card=${card1}`);
  assert.equal(await page.locator("#board").evaluate((element) => element.scrollTop), 300);
  await page.goBack();
  await expectSelection("closed");
  assert.equal(page.url(), board);
  await page.goForward();
  await expectSelection(card1);
  await page.getByRole("button", { name: "Second card" }).click();
  await expectSelection(card2);
  await page.waitForURL(`**&card=${card2}`);
  await page.getByRole("button", { name: "Close peek" }).click();
  await expectSelection("closed");
  await page.waitForURL(board);
  assert.equal(await page.locator("#board").evaluate((element) => element.scrollTop), 300);
  await page.getByRole("button", { name: "First card" }).click();
  await expectSelection(card1);
  await page.waitForURL(`**&card=${card1}`);
  await page.evaluate(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("sport", "Basketball");
    window.history.replaceState(window.history.state, "", url);
  });
  await page.getByRole("button", { name: "Close peek" }).click();
  await expectSelection("closed");
  await page.waitForURL(board.replace("Football", "Basketball"));
  await page.goto(`${board}&card=${card1}`);
  await expectSelection(card1);
  await page.reload();
  await expectSelection(card1);
  await page.getByRole("button", { name: "Close peek" }).click();
  await expectSelection("closed");
  await page.waitForURL(board);
  await page.getByRole("button", { name: "Add clip" }).click();
  await page.getByRole("dialog").waitFor();
  assert.match(await page.getByRole("dialog").innerText(), /Choose footage and a range/);
  await page.getByLabel("Video URL").fill(`${board.split("/team")[0]}/clip.m3u8`);
  await page.getByLabel("Start (seconds or timecode)", { exact: true }).fill("6");
  await page.getByLabel("End (optional)").fill("4");
  await page.getByRole("button", { name: "Preview clip" }).click();
  await page.getByRole("alert").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Coaching note draft").fill("Discarded change");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await page.getByTestId("note-view").textContent(), "Original instruction");
  assert.equal(await page.getByTestId("note-saves").textContent(), "0");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Coaching note draft").fill("Keep shoulders square");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).waitFor();
  assert.equal(await page.getByTestId("note-view").textContent(), "Keep shoulders square");
  assert.equal(await page.getByTestId("note-saves").textContent(), "1");
  await page.getByRole("button", { name: "Toggle save failure" }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Coaching note draft").fill("Retained draft after failure");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.equal(await page.getByLabel("Coaching note draft").inputValue(), "Retained draft after failure");
  assert.equal(await page.getByTestId("note-saves").textContent(), "1");
  const normalizedCard = JSON.parse(await page.getByTestId("normalized").textContent());
  assert.deepEqual(normalizedCard.coaching_card_data, { kind: "coaching_card", card_type: "Correction" });
  assert.equal(normalizedCard.roster_player_id, "player");
  assert.equal(normalizedCard.position_group, "RB");
  assert.deepEqual(errors, []);
  console.log(
    "PASS: selection/history, direct link/refresh, board scroll/filters, clip dialog, note save/cancel/failure, and coaching metadata hydration"
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
