import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const require = createRequire(path.join(web, "package.json"));
const { build } = require(process.env.ESBUILD_PACKAGE_PATH || "esbuild");
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE_PATH || "playwright");
const temp = await mkdtemp(path.join(tmpdir(), "annotation-workspace-"));
await writeFile(
  path.join(temp, "shell.tsx"),
  `export const API_BASE_URL='';export const ImageFullScreenModal=()=>null;export const LogoSpinner=()=>null;export const EModalWidth={XL:'xl'};export function Button({children,unstyled,variant,size,loading,...props}){return <button {...props}>{children}</button>}export function ModalCore({isOpen,children}){return isOpen?<div role="dialog">{children}</div>:null}export const ImageWithFallback=(props)=><img {...props}/>;export const PlayerOverlay=()=>null;export const PlayerSettingsPanel=()=>null;export const renderWorkspaceDate=(v)=>v;`
);
await writeFile(
  path.join(temp, "fixture.tsx"),
  `import {useState,useRef} from 'react';import {createRoot} from 'react-dom/client';import {createPortal} from 'react-dom';import {MediaDetailPreview} from ${JSON.stringify(path.join(web, "ce/features/media-library/components/media-detail-preview"))};function Fixture(){const [open,setOpen]=useState(false);const [host,setHost]=useState(null);const [attempts,setAttempts]=useState(0);const [saved,setSaved]=useState(false);const ref=useRef(null);return <><p>Attempts: {attempts}</p>{saved?<p>Returned to staging</p>:null}<MediaDetailPreview item={{id:'clip',packageId:'media',title:'Clip',thumbnail:'',meta:{}}} isVideo canAnnotateVideo isVideoAnnotationWorkspaceOpen={open} showVideoTimeline={open} hasUnsavedVideoAnnotationChanges={open} annotationReturnLabel="Staging Area" onVideoAnnotationPropertiesElementChange={setHost} onOpenVideoAnnotationWorkspace={()=>setOpen(true)} onCloseVideoAnnotationWorkspace={async()=>{setAttempts(attempts+1);if(attempts===0)return false;setSaved(true);setOpen(false);return true;}} onDiscardVideoAnnotationWorkspace={()=>setOpen(false)} videoRef={ref} settingsPanelRef={ref} onOverlayToggle={()=>{}} onOverlaySeek={()=>{}} qualityOptions={[]} playbackRates={[]} setIsImageZoomOpen={()=>{}} onCloseSettings={()=>{}} currentPlaybackRate={1} onSelectQuality={()=>{}} onSelectRate={()=>{}} effectiveImageSrc="" sanitizedDocumentPreviewHtml="" videoAnnotationContent={host?createPortal(<label>Color<input defaultValue="cyan"/></label>,host):null}/></>}createRoot(document.getElementById('root')).render(<Fixture/>);`
);
const shell = path.join(temp, "shell.tsx");
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
    "@plane/ui": shell,
    "@plane/editor": shell,
    "@plane/constants": shell,
    "@plane/utils": shell,
    "@/components/common/logo-spinner": shell,
  },
  plugins: [
    {
      name: "player-shell",
      setup(b) {
        b.onResolve({ filter: /^\.\/player-ui$/ }, () => ({ path: shell }));
      },
    },
  ],
  nodePaths: [path.join(web, "node_modules"), path.resolve(web, "../../node_modules")],
  define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" },
  loader: { ".svg": "dataurl", ".woff2": "dataurl", ".png": "dataurl" },
});
const server = createServer((req, res) =>
  req.url === "/fixture.js"
    ? res
        .writeHead(200, { "Content-Type": "text/javascript" })
        .end(bundle.outputFiles.find((f) => f.path.endsWith(".js")).text)
    : res
        .writeHead(200, { "Content-Type": "text/html" })
        .end(
          '<html><head><style>.hidden{display:none!important}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'
        )
);
await new Promise((r) => server.listen(0, "127.0.0.1", r));
let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  page.on("pageerror", (e) => console.error(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") console.error(m.text());
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole("button", { name: "Open annotation editor", exact: true }).click();
  await page.getByLabel("Color", { exact: true }).fill("blue");
  assert.equal(await page.getByRole("complementary", { name: "Annotation properties" }).isVisible(), true);
  assert.equal(await page.getByRole("button", { name: /^(Show|Hide|Close) properties$/ }).count(), 0);
  assert.equal(await page.getByLabel("Color", { exact: true }).inputValue(), "blue");
  const saveButton = page.getByRole("button", { name: "Save annotations", exact: true });
  assert.equal(await saveButton.innerText(), "Save");
  await saveButton.click();
  const save = page.getByRole("dialog").getByRole("button", { name: "Save", exact: true });
  await save.click();
  await page.getByText("Attempts: 1", { exact: true }).waitFor();
  assert.equal(await save.isVisible(), true, "Failed save must leave the editor open");
  await save.click();
  await page.getByText("Returned to staging", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Open annotation editor", exact: true }).isVisible(), true);
  await page.getByRole("button", { name: "Open annotation editor", exact: true }).click();
  await page.getByRole("button", { name: "Back without saving annotations", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Save annotations", exact: true }).isVisible(), true);
  console.log(
    "PASS: properties remain visible without a toggle, Save label is correct, failed save stays open, successful save returns, Back protects unsaved work"
  );
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}
