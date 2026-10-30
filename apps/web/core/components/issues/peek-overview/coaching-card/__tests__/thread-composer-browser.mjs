// Exercise the real comment composer; only the rich editor and app services are fixtures.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const root = path.resolve(web, "../..");
const require = createRequire(path.join(web, "package.json"));
const packages = await readdir(path.join(root, "node_modules/.pnpm"));
const esbuildPath = packages.find((name) => /^esbuild@/.test(name));
const { build } = require(process.env.ESBUILD_PACKAGE_PATH || path.join(root, "node_modules/.pnpm", esbuildPath, "node_modules/esbuild"));
const temp = await mkdtemp(path.join(tmpdir(), "thread-composer-"));
await writeFile(path.join(temp, "mocks.tsx"), `
import { forwardRef, useImperativeHandle } from "react";
export const EIssueCommentAccessSpecifier = { INTERNAL: "INTERNAL", EXTERNAL: "EXTERNAL" };
export const cn = (...v) => v.filter(Boolean).join(" ");
export const isCommentEmpty = (v) => !v || v === "<p></p>";
export const useWorkspace = () => ({ getWorkspaceBySlug: () => ({ id: "school" }) });
export class FileService { async updateBulkProjectAssetsUploadStatus() { throw new Error("Asset finalization fixture"); } }
export const LiteTextEditor = forwardRef((props, ref) => {
  useImperativeHandle(ref, () => ({ clearEditor: () => { window.clears++; }, isEditorReadyToDiscard: () => true }));
  return <div data-access={props.accessSpecifier} data-draft={props.initialValue} data-busy={props.isSubmitting}>
    <button onClick={() => props.onChange({}, "<p>Player reply</p>")}>Draft</button>
    <button onClick={props.onEnterKeyPress}>Send</button>
    <button onClick={() => props.uploadFile("block", {})}>Upload</button>
  </div>;
});
`);
await writeFile(path.join(temp, "fixture.tsx"), `
import { createRoot } from "react-dom/client";
import { CommentCreate } from ${JSON.stringify(path.join(web, "core/components/comments/comment-create.tsx"))};
window.clears = 0; window.mode = "undefined"; window.sent = [];
const operations = { uploadCommentAsset: async () => ({ asset_id: "asset" }), createComment: async (data) => {
  window.sent.push(data);
  if (window.mode === "throw") throw new Error("Offline fixture");
  return window.mode === "success" ? { id: "message" } : undefined;
} };
createRoot(document.getElementById("root")).render(<>
  <section id="shared"><CommentCreate workspaceSlug="school" projectId="program" entityId="card"
    activityOperations={operations} defaultAccess="EXTERNAL" showAccessSpecifier
    onSubmitCallback={() => { if (window.callbackFails) throw new Error("Callback fixture"); }} /></section>
  <section id="generic"><CommentCreate workspaceSlug="school" entityId="other" activityOperations={operations} /></section>
</>);
const wait = () => new Promise(resolve => setTimeout(resolve, 100));
const check = (condition, message) => { if (!condition) throw new Error(message); };
(async () => {
  await wait();
  const editor = () => document.querySelector("#shared [data-access]");
  check(editor().dataset.access === "EXTERNAL", "thread should default to shared access");
  check(document.querySelector("#generic [data-access]").dataset.access === "INTERNAL", "other composers stay internal");
  document.querySelector("#shared button").click(); await wait();
  const send = () => document.querySelectorAll("#shared button")[1].click();
  for (const mode of ["undefined", "throw"]) {
    window.mode = mode; send(); await wait();
    check(editor().dataset.draft === "<p>Player reply</p>", "failed sends must keep the draft: " + mode);
    check(window.clears === 0, "failed sends must not clear the editor");
  }
  window.mode = "success"; send(); await wait();
  check(window.clears === 1, "successful send clears the editor once");
  check(editor().dataset.draft === "<p></p>", "successful send resets the form");
  check(window.sent.length === 3 && window.sent.every(data => data.access === "EXTERNAL"), "payloads must carry shared visibility");
  check(editor().dataset.access === "EXTERNAL", "shared default persists after sending");
  document.querySelector("#shared button").click(); await wait();
  window.callbackFails = true; send(); await wait();
  check(window.clears === 2, "a saved message must clear even if post-submit callback fails");
  check(editor().dataset.draft === "<p></p>", "saved messages must not remain available for duplicate retries");
  window.callbackFails = false;
  document.querySelector("#shared button").click(); await wait();
  document.querySelectorAll("#shared button")[2].click(); await wait();
  send(); await wait();
  check(window.clears === 3, "a saved message must clear even if asset finalization fails");
  check(editor().dataset.draft === "<p></p>", "asset errors must not allow duplicate retries");
  document.body.append(Object.assign(document.createElement("pre"), { textContent: "THREAD-COMPOSER-PASS" }));
})().catch(error => document.body.append(Object.assign(document.createElement("pre"), { textContent: "THREAD-COMPOSER-FAIL: " + error.message })));
`);
const bundle = await build({
  entryPoints: [path.join(temp, "fixture.tsx")], bundle: true, write: false, format: "iife", jsx: "automatic",
  alias: Object.fromEntries([
    "@plane/constants", "@plane/utils", "@/hooks/store/use-workspace", "@/services/file.service", "@/components/editor/lite-text",
  ].map(name => [name, path.join(temp, "mocks.tsx")])),
  nodePaths: [path.join(web, "node_modules"), path.join(root, "node_modules")],
  define: { "process.env.NODE_ENV": '"development"' },
});
const server = createServer((req, res) => {
  if (req.url === "/fixture.js") return res.writeHead(200, { "Content-Type": "text/javascript" }).end(bundle.outputFiles[0].text);
  res.end('<html><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
try {
  const chrome = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const child = spawn(chrome, ["--headless", "--no-sandbox", "--disable-gpu", "--no-first-run",
    "--disable-background-networking", "--user-data-dir=" + path.join(temp, "profile"),
    "--virtual-time-budget=5000", "--dump-dom", `http://127.0.0.1:${server.address().port}`]);
  let output = "", errors = "";
  child.stdout.on("data", data => { output += data; });
  child.stderr.on("data", data => { errors += data; });
  await new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", resolve); });
  assert.ok(output.includes("THREAD-COMPOSER-PASS"), output || errors);
  console.log("Thread composer: shared defaults, failed-send drafts, success reset verified in Chrome.");
} finally {
  server.close();
}
