// Standalone UI regression: real PlayerArea + API client, a fixture API, no real accounts.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const require = createRequire(path.join(web, "package.json"));
const { build } = require(process.env.ESBUILD_PACKAGE_PATH || "esbuild");
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE_PATH || "playwright");
const temp = await mkdtemp(path.join(tmpdir(), "player-role-ui-"));
const stubs = {
  constants: 'export const API_BASE_URL = "";',
  ui: 'import React from "react"; export const Button = ({variant, size, children, ...props}) => <button {...props}>{children}</button>;',
  user: 'import {createContext,useContext} from "react"; export const UserContext=createContext(null); export const useUser=()=>useContext(UserContext);',
  dynamic: "export default () => () => null;",
  clip: "export const CoachingCardClipPlayer = () => null;",
};
for (const [name, source] of Object.entries(stubs)) await writeFile(path.join(temp, `${name}.tsx`), source);
await writeFile(
  path.join(temp, "fixture.tsx"),
  `
import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
import {PlayerArea} from ${JSON.stringify(path.join(web, "ce/features/player/components/player-area.tsx"))};
import {UserContext} from ${JSON.stringify(path.join(temp, "user.tsx"))};
function Fixture(){const [user,setUser]=useState('A'); document.cookie='user='+user+';path=/';
return <UserContext.Provider value={{data:{id:user},signOut:async()=>{}}}><div data-user={user}>
<button onClick={()=>setUser('B')}>Switch account</button><PlayerArea/></div></UserContext.Provider>}
createRoot(document.getElementById('root')).render(<Fixture/>);`
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
    "@plane/constants": path.join(temp, "constants.tsx"),
    "@plane/ui": path.join(temp, "ui.tsx"),
    "@/hooks/store/user": path.join(temp, "user.tsx"),
    "next/dynamic": path.join(temp, "dynamic.tsx"),
    "@/components/issues/issue-detail/coaching-card-clip-player": path.join(temp, "clip.tsx"),
  },
});
const calls = [];
const comments = { A: [], B: [] };
const progress = { A: { percent: 0, note: "", completed_at: null }, B: { percent: 0, note: "", completed_at: null } };
const reactions = { A: [], B: [] };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const actor = /user=([AB])/.exec(req.headers.cookie || "")?.[1] || "A";
  const json = (data, status = 200) =>
    res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(data));
  if (url.pathname === "/fixture.js")
    return res.writeHead(200, { "content-type": "text/javascript" }).end(bundle.outputFiles[0].text);
  if (!url.pathname.startsWith("/api/"))
    return res
      .writeHead(200, { "content-type": "text/html" })
      .end('<div id="root"></div><script src="/fixture.js"></script>');
  let body = "";
  for await (const chunk of req) body += chunk;
  const values = body ? JSON.parse(body) : {};
  calls.push({ actor, path: url.pathname, method: req.method, values });
  const project = { id: "program-1", name: "Program " + actor, workspace_slug: "school", workspace_name: "School" };
  if (url.pathname === "/api/player/assignments/") return json([project]);
  if (url.pathname === "/api/player/activities/")
    return json({
      total_count: 1,
      results: [
        {
          id: "activity-1",
          name: "Private activity " + actor,
          category: "Activity",
          description: "Assigned practice",
          feedback: "Personal feedback " + actor,
          clips: [],
          project,
          state: { id: "state", name: "Assigned" },
          progress: progress[actor],
        },
      ],
    });
  if (url.pathname.endsWith("/progress/")) {
    progress[actor] = { ...values, completed_at: values.percent === 100 ? "now" : null };
    return json(progress[actor]);
  }
  if (url.pathname.endsWith("/reactions/")) {
    if (req.method === "POST" && !reactions[actor].includes(values.reaction)) reactions[actor].push(values.reaction);
    if (req.method === "DELETE") reactions[actor] = reactions[actor].filter((value) => value !== values.reaction);
    return json(req.method === "GET" ? reactions[actor] : { reaction: values.reaction });
  }
  if (url.pathname.endsWith("/comments/")) {
    if (req.method === "POST") {
      const comment = {
        id: "comment-1",
        text: values.text,
        author: "Player " + actor,
        is_own: true,
        created_at: "now",
      };
      comments[actor].push(comment);
      return json(comment, 201);
    }
    return json(comments[actor]);
  }
  if (url.pathname.endsWith("/comments/comment-1/")) {
    if (req.method === "DELETE") {
      comments[actor] = [];
      return res.writeHead(204).end();
    }
    comments[actor][0].text = values.text;
    return json(comments[actor][0]);
  }
  return json({ error: "Unexpected route" }, 404);
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
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole("heading", { name: "Private activity A", exact: true }).waitFor();
  await page.getByRole("textbox", { name: "Your progress notes", exact: true }).fill("Practiced today");
  await page.getByRole("button", { name: "Complete my activity", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Your progress is saved." }).waitFor();
  assert.equal(progress.A.percent, 100);
  assert.equal(progress.A.note, "Practiced today");
  assert.ok(calls.filter((call) => call.path.endsWith("/progress/")).every((call) => !("state" in call.values)));
  await page.getByRole("textbox", { name: "Add a comment", exact: true }).fill("My comment");
  await page.getByRole("button", { name: "Post comment", exact: true }).click();
  await page.getByText("My comment", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("textbox", { name: "Edit your comment", exact: true }).fill("Updated comment");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("Updated comment", { exact: true }).waitFor();
  await page.getByRole("button", { name: "React 👍", exact: true }).first().click();
  await page.waitForFunction(
    () => document.querySelector('button[aria-label="React 👍"]')?.getAttribute("aria-pressed") === "true"
  );
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByText("Updated comment", { exact: true }).waitFor({ state: "detached" });
  await page.evaluate(() => {
    window.privateLeaks = [];
    new MutationObserver(() => {
      if (document.querySelector('[data-user="B"]') && document.body.textContent.includes("Private activity A"))
        window.privateLeaks.push("A");
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  });
  await page.getByRole("button", { name: "Switch account", exact: true }).click();
  await page.getByRole("heading", { name: "Private activity B", exact: true }).waitFor();
  assert.equal(await page.getByRole("slider").inputValue(), "0");
  assert.equal(await page.getByRole("textbox", { name: "Your progress notes", exact: true }).inputValue(), "");
  assert.deepEqual(await page.evaluate(() => window.privateLeaks), []);
  assert.deepEqual(errors, []);
  assert.ok(calls.every((call) => call.path.startsWith("/api/player/")));
  console.log(
    "Player area passed: personal completion, comment add/edit/delete, reactions, and account cache isolation."
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
