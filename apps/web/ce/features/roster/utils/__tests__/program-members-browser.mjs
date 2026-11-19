// Render the real settings list with stale profile/membership stores, then refresh.
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const require = createRequire(path.join(web, "package.json"));
const { build } = require(process.env.ESBUILD_PACKAGE_PATH || "esbuild");
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE_PATH || "playwright");
const temp = await mkdtemp(path.join(tmpdir(), "program-members-browser-"));
const fixture = path.join(temp, "fixture.tsx");
const mocks = path.join(temp, "mocks.tsx");
await writeFile(
  mocks,
  `import React from 'react';import {observable,runInAction} from 'mobx';
export const EUserPermissions={ADMIN:20,MEMBER:15,USER:1};
export const EUserPermissionsLevel={PROJECT:'project'};
export const MEMBER_TRACKER_ELEMENTS={HEADER_ADD_BUTTON:'add'};
export const Search=()=>null;
export const useTranslation=()=>({t:key=>key});
export const useUserPermissions=()=>({allowPermissions:()=>true});
export const Button=({children,onClick})=><button onClick={onClick}>{children}</button>;
export const MembersSettingsLoader=()=> <div>Loading members</div>;
export const MemberListFiltersDropdown=()=>null;
export const SendProjectInvitationModal=()=>null;
export const ProjectMemberListItem=({memberDetails})=><div>{memberDetails.map(row=><div key={row.id}>{row.member.first_name} · User</div>)}</div>;
const state=observable({members:['coach'],profiles:{coach:{id:'coach',first_name:'Coach',last_name:'',display_name:'Coach'}}});
window.calls=[]; window.failRefresh=false;
const store={
 workspace:{fetchWorkspaceMembers:async()=>{window.calls.push('profiles'); if(window.failRefresh)throw Error('offline');runInAction(()=>{state.profiles.player={id:'player',first_name:'Approved Player',last_name:'',display_name:'Approved Player'};});}},
 project:{get projectMemberIds(){return state.members},
 fetchProjectMembers:async(workspace,project,clear)=>{window.calls.push(clear?'members-fresh':'members');if(window.failRefresh)throw Error('offline');runInAction(()=>{state.members=['coach','player'];});},
 getFilteredProjectMemberDetails:id=>state.profiles[id]?{id,member:state.profiles[id],role:id==='coach'?20:1,original_role:id==='coach'?20:1}:null,
 filters:{getFilters:()=>({}),updateFilters:()=>{}}}};
export const useMember=()=>store;`
);
await writeFile(
  fixture,
  `import React from 'react';import {createRoot} from 'react-dom/client';
import {ProjectMemberList} from ${JSON.stringify(path.join(web, "core/components/project/member-list.tsx"))};
createRoot(document.getElementById('root')).render(<ProjectMemberList workspaceSlug="school" projectId="team"/>);`
);
await build({
  entryPoints: [fixture],
  outfile: path.join(temp, "app.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  nodePaths: [path.join(web, "node_modules")],
  define: { "process.env.NODE_ENV": '"test"' },
  plugins: [
    {
      name: "fixture-boundaries",
      setup(builder) {
        builder.onResolve({ filter: /^(lucide-react|@plane\/|@\/)/ }, () => ({ path: mocks }));
        builder.onResolve(
          { filter: /^\.\/(dropdowns\/filters\/member-list|member-list-item|send-project-invitation-modal)$/ },
          () => ({ path: mocks })
        );
      },
    },
  ],
});
const server = createServer(async (request, response) => {
  response.setHeader("Content-Type", request.url === "/app.js" ? "application/javascript" : "text/html");
  response.end(
    request.url === "/app.js"
      ? await readFile(path.join(temp, "app.js"))
      : '<div id="root"></div><script src="/app.js"></script>'
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  try {
    await page.getByText("Approved Player · User", { exact: true }).waitFor({ timeout: 5000 });
  } catch (error) {
    console.error({
      errors,
      body: await page.locator("body").innerText(),
      calls: await page.evaluate(() => window.calls),
    });
    throw error;
  }
  assert.deepEqual(await page.evaluate(() => window.calls), ["profiles", "members-fresh"]);
  assert.deepEqual(errors, []);
  console.log("Program members refresh retrieves newly approved profile and membership: passed");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
