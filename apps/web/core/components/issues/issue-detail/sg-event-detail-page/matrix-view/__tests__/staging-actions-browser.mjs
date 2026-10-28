import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../../..");
const require = createRequire(path.join(web, "package.json"));
const { build } = require(process.env.ESBUILD_PACKAGE_PATH || "esbuild");
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE_PATH || "playwright");
const temp = await mkdtemp(path.join(tmpdir(), "staging-actions-"));
const base = path.join(web, "core/components/issues/issue-detail/sg-event-detail-page");
await writeFile(
  path.join(temp, "ui.tsx"),
  `
export { DEFAULT_IMAGE, useImageFallback } from ${JSON.stringify(path.resolve(web, "../../packages/ui/src/image/image.tsx"))};
export const Button = ({unstyled, children, ...props}) => <button {...props}>{children}</button>;
export const Checkbox = ({checked, onChange, iconClassName, ...props}) => <input {...props} type="checkbox" checked={checked} onChange={onChange}/>;
export const AlertModalCore = () => null;
export const ImageWithFallback = (props) => <img {...props}/>;
export const CustomSelect = ({children}) => <div>{children}</div>; CustomSelect.Option = ({children}) => <span>{children}</span>;
export const CustomMenu = ({children}) => <div>{children}</div>; CustomMenu.MenuItem = ({children}) => <span>{children}</span>;
export const Tooltip = ({children}) => children;
export const setToast = () => {}; export const TOAST_TYPE = { ERROR: 'error', SUCCESS: 'success' };
`
);
await writeFile(
  path.join(temp, "image.tsx"),
  `export default function Image({fill, unoptimized, ...props}) { return <img {...props}/>; }`
);
await writeFile(
  path.join(temp, "fixture.tsx"),
  `
import { useState } from 'react'; import { createRoot } from 'react-dom/client';
import { SgMatrixPlaylistPanel } from ${JSON.stringify(path.join(base, "matrix-view/components/matrix-playlist-panel"))};
import { TagsPanelToolbar } from ${JSON.stringify(path.join(base, "tags-view/components/tags-panel-toolbar"))};
function Fixture() {
 const [annotationEnabled, setAnnotationEnabled] = useState(false); const [annotatedPlaylist, setAnnotatedPlaylist] = useState('');
 const [draft, setDraft] = useState(null); const [selectedCount, setSelected] = useState(0); const [creating, setCreating] = useState(false); const [cards, setCards] = useState(0);
 const playlist = { id: 'playlist', name: 'Practice', url: annotationEnabled ? '/playlist.m3u8' : undefined, thumbnail: '/poster.svg', clip: 2, clips: [{ id:'one', title:'First clip', thumbnail:'   ' }, { id:'two', title:'Second clip', thumbnail:'/broken.svg' }] };
 return <><button onClick={() => setSelected(selectedCount ? 0 : 1)}>Toggle selected tags</button><button onClick={() => setCreating(!creating)}>Toggle creating</button><output>{cards} cards</output>
 <button onClick={() => setAnnotationEnabled(true)}>Enable annotation</button><output data-testid="annotation-playlist">{annotatedPlaylist}</output>
 <SgMatrixPlaylistPanel availableRows={[]} draft={draft} onDraftChange={setDraft} customPlaylists={[playlist]} onCreatePlaylist={async () => true} onCreateCard={() => setCards(cards+1)} onPlayPlaylist={annotationEnabled ? (p) => setAnnotatedPlaylist(p.id) : undefined} onDeletePlaylist={async () => {}} onUpdatePlaylist={async (p) => p}/>
 <TagsPanelToolbar activeFilterLabel="All" availableGroups={[]} defaultGroupValue="All tags" effectiveGroupValue="All tags" groupSelectLabel="All" isColumnsPanelOpen={false} isCreatingPlaylist={creating} isSearchOpen={true} onColumnsPanelOpen={() => {}} onCreatePlaylist={() => {}} onCreateCard={() => setCards(cards+1)} onRowFilterModeChange={() => {}} onSearchQueryChange={() => {}} onSelectedGroupValueChange={() => {}} onToggleSearch={() => {}} rowFilterMode="all" searchQuery="" selectedCount={selectedCount} selectedPlayableCount={selectedCount} selectedAvailableColumnCount={0} showCreateActions={true} totalColumnCount={0}/>
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
    "@plane/ui": path.join(temp, "ui.tsx"),
    "@plane/propel/toast": path.join(temp, "ui.tsx"),
    "@plane/propel/tooltip": path.join(temp, "ui.tsx"),
    "next/image": path.join(temp, "image.tsx"),
  },
  define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" },
  plugins: [
    {
      name: "video-fixture",
      setup(builder) {
        builder.onResolve({ filter: /hls-video$/ }, () => ({ path: "video", namespace: "fixture" }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: "export const HlsVideo = () => null;",
        }));
      },
    },
  ],
});
const server = createServer((req, res) => {
  if (req.url === "/fixture.js")
    return res.writeHead(200, { "Content-Type": "text/javascript" }).end(bundle.outputFiles[0].text);
  if (req.url === "/broken.svg") return res.writeHead(404).end();
  if (req.url.endsWith(".svg"))
    return res
      .writeHead(200, { "Content-Type": "image/svg+xml" })
      .end(
        '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="red"/></svg>'
      );
  res
    .writeHead(200, { "Content-Type": "text/html" })
    .end(
      '<html><style>li,button{padding:8px} .select-none{user-select:none} .select-text{user-select:text}</style><div id="root"></div><script src="/fixture.js"></script></html>'
    );
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
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:" + server.address().port);
  const staging = page.getByRole("complementary", { name: "Staging Area" });
  await page.getByRole("button", { name: "Toggle selected tags" }).waitFor();
  const failures = [];
  async function check(name, run) {
    try {
      await run();
      console.log("PASS " + name);
    } catch (error) {
      failures.push(name + ": " + error.message);
      console.error("FAIL " + name + ": " + error.message);
    }
  }
  await check("clip count is a plural count with explanation", async () => {
    assert.equal(await staging.getByText("2 clips", { exact: true }).count(), 1);
    assert.equal(
      await staging.getByText("2 clips", { exact: true }).getAttribute("title"),
      "Number of clips in this playlist"
    );
  });
  await check("empty clip preview and failed clip preview use playlist poster", async () => {
    await page.waitForTimeout(150);
    const sources = await staging
      .locator("li li img")
      .evaluateAll((imgs) => imgs.map((img) => img.getAttribute("src")));
    assert.deepEqual(sources, ["/poster.svg", "/poster.svg"]);
  });
  await check("disabled card action explains selection and draft requirements", async () => {
    const button = staging.getByRole("button", { name: "Create Card", exact: true });
    assert.equal(await button.isDisabled(), true);
    assert.match(await staging.innerText(), /Select a playlist containing saved clips/);
    await staging.getByRole("checkbox").check();
    assert.equal(await button.isEnabled(), true);
    await button.click();
    assert.equal(await page.getByText("1 cards", { exact: true }).count(), 1);
    await staging.getByRole("button", { name: "Add playlist", exact: true }).click();
    assert.equal(await button.isDisabled(), true);
    assert.match(await staging.innerText(), /Save or discard playlist changes/);
  });
  await check("tag card action uses selected rows and creation guidance updates", async () => {
    const buttons = page.getByRole("button", { name: "Create Card", exact: true });
    assert.equal(await buttons.nth(1).isDisabled(), true);
    await page.getByRole("button", { name: "Toggle selected tags" }).click();
    assert.equal(await buttons.nth(1).isEnabled(), true);
    await buttons.nth(1).click();
    assert.equal(await page.getByText("2 cards", { exact: true }).count(), 1);
    await page.getByRole("button", { name: "Toggle creating" }).click();
    const create = page.getByRole("button", { name: "Creating", exact: true });
    assert.equal(await create.isDisabled(), true);
    assert.match(await create.getAttribute("title"), /Creating playlist/);
  });
  await check("staging prevents native selection and image drag, preserves editing", async () => {
    assert.equal(
      await staging.locator('ul[aria-label="Staged playlists"] > li').evaluate((el) => getComputedStyle(el).userSelect),
      "none"
    );
    assert.equal(await staging.locator("li li img").first().getAttribute("draggable"), "false");
    const input = staging.getByRole("textbox", { name: "Playlist name" });
    assert.equal(await input.count(), 1);
    assert.notEqual(await input.evaluate((el) => getComputedStyle(el).userSelect), "none");
  });
  await check("staging title editing retains text selection", async () => {
    await staging.getByRole("button", { name: "Cancel new playlist", exact: true }).click();
    await staging.getByRole("button", { name: "Edit Practice", exact: true }).click();
    const title = staging.getByRole("textbox", { name: "Playlist title", exact: true });
    await title.selectText();
    assert.equal(
      await title.evaluate((input) => input.value.slice(input.selectionStart, input.selectionEnd)),
      "Practice"
    );
    assert.equal(await title.evaluate((input) => getComputedStyle(input).userSelect), "text");
    await title.press("Escape");
    const play = staging.getByTitle("Play Practice", { exact: true });
    await play.dblclick();
    await page.getByRole("button", { name: "Close playlist video", exact: true }).click();
    assert.equal(await page.evaluate(() => window.getSelection().toString()), "");
  });
  await check("playlist Annotate opens the existing workspace handler for the correct playlist", async () => {
    const selection = staging.getByRole("checkbox", { name: "Select Practice", exact: true });
    const wasSelected = await selection.isChecked();
    await page.getByRole("button", { name: "Enable annotation", exact: true }).click();
    await staging.getByRole("button", { name: "Annotate Practice", exact: true }).click();
    assert.equal(await page.getByTestId("annotation-playlist").innerText(), "playlist");
    assert.equal(await selection.isChecked(), wasSelected);
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
