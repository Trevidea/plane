// Exercise real roster state and components with in-memory API fixtures; no accounts are modified.
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const repo = path.resolve(web, "../..");
const require = createRequire(path.join(web, "package.json"));
const { build } = require(process.env.ESBUILD_PACKAGE_PATH || "esbuild");
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE_PATH || "playwright");
const temp = await mkdtemp(path.join(tmpdir(), "roster-lifecycle-browser-"));
const files = {};
const put = async (name, source) => {
  files[name] = path.join(temp, `${name}.tsx`);
  await writeFile(files[name], source);
};
await put(
  "ui",
  `
import React from 'react';
export const cn=(...args)=>args.filter(Boolean).join(' ');
export const ToggleSwitch=({value,onChange,label,disabled})=><button type="button" role="switch" aria-checked={value} aria-label={label} disabled={disabled} onClick={()=>onChange(!value)} />;
export const Avatar=({name,src})=>src?<img src={src} alt={name}/>:<span aria-hidden="true">{name?.slice(0,1)}</span>;
export const Button=React.forwardRef(({children,onClick,disabled,type='button',variant,size,loading,unstyled,prependIcon,appendIcon,...props},ref)=><button ref={ref} type={type} onClick={onClick} disabled={disabled||loading} {...props}>{children}</button>);
export const Checkbox=({checked,onClick,disabled,'aria-label':label})=><input type="checkbox" checked={checked} readOnly onClick={onClick} disabled={disabled} aria-label={label}/>;
export const CustomMenu=({children,customButton})=><div>{customButton}{children}</div>;
CustomMenu.MenuItem=Button;
export const CustomSelect=({children,label})=><div>{label}{children}</div>; CustomSelect.Option=({children})=><span>{children}</span>;
export const Input=props=><input {...props}/>; export const TextArea=props=><textarea {...props}/>;
export const EModalPosition={}, EModalWidth={};
export const ModalCore=({children,isOpen})=>isOpen?<div role="dialog">{children}</div>:null;
export const AlertModalCore=({isOpen,title,content,handleClose,handleSubmit,primaryButtonText,isSubmitting})=>isOpen?<div role="dialog" aria-label={title}><h2>{title}</h2>{content}<button onClick={handleClose}>Cancel</button><button disabled={isSubmitting} onClick={handleSubmit}>{primaryButtonText.default}</button></div>:null;
`
);
await put(
  "boundaries",
  `
import React from 'react';
export const PageHead=()=>null; export const useParams=()=>({workspaceSlug:'school',projectId:'team'});
export default function Link({children}){return <span>{children}</span>};
export const EUserPermissions={ADMIN:20,MEMBER:15}; export const EUserPermissionsLevel={WORKSPACE:'workspace',PROJECT:'project'};
export const useUserPermissions=()=>({allowPermissions:(roles)=>roles.includes(15)||window.testRole==='admin'});
export const useUserReadOnly=()=>false;
export const getFileURL=(path)=>path||undefined;
export const TOAST_TYPE={SUCCESS:'success',ERROR:'error'}; export const setToast=(toast)=>{window.lastToast=toast};
`
);
await put("empty", `import React from 'react'; export const RosterEmptyState=()=> <p>No players yet. Add player</p>;`);
await put(
  "service",
  `
const mk=(id,name,status,user=null,registration_status=null)=>({id,player_name:name,status,user,registration_status,jersey_number:'17',created_at:'2026-11-18',updated_at:'2026-11-18'});
let roster=[{...mk('a','Alex','active','account-a'),account_avatar_url:'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=='},mk('b','Blake','inactive','account-b'),mk('c','Casey','injured','account-c'),mk('p','Pending','pending',null,'pending')];
let events=[{id:'old',roster_identity:'former',player_name:'Former Athlete',jersey_number:'42',action:'removed',previous_status:'active',status:'removed',created_at:'2026-11-18',actor_name:'Coach',has_account:true}];
window.requests=[];
export class WorkspaceService { async fetchWorkspaceMembers(){return [{id:'membership',role:1,is_active:true,member:{id:'avery-account',first_name:'Avery',last_name:'Lee',email:'avery@example.com',is_bot:false}}]} }
export class RosterService {
 async createRosterPlayer(w,p,payload){window.requests.push(['create',payload]);if(window.failCreate)throw {error:'Fixture save failure'};const row={...payload,id:'created-'+roster.length,program_id:p,user:payload.email==='avery@example.com'?'avery-account':null,created_at:'2026-11-18',updated_at:'2026-11-18'};roster.push(row);return structuredClone(row)}
 async getRoster(){return structuredClone(roster)}
 async getRosterEvents(){if(window.failEvents)throw {error:'Fixture history failure'}; return structuredClone(events)}
 async updateRosterPlayer(w,p,id,payload){window.requests.push(['patch',id,payload]); if(window.failStatus)throw {error:'Fixture status failure'};const row=roster.find(r=>r.id===id);Object.assign(row,payload);if(payload.status==='inactive')row.jersey_number=null;return structuredClone(row)}
 async deleteRosterPlayer(w,p,id){window.requests.push(['remove',id]);const row=roster.find(r=>r.id===id);roster=roster.filter(r=>r.id!==id);events.unshift({id:'event-'+id,roster_identity:id,player_name:row.player_name,jersey_number:row.jersey_number,action:'removed',previous_status:row.status,status:'removed',created_at:'2026-11-18',actor_name:'Coach',has_account:!!row.user})}
 async declinePlayer(w,p,id){window.requests.push(['decline',id]);const row=roster.find(r=>r.id===id);if(row.status==='pending')roster=roster.filter(r=>r.id!==id);else {row.registration_status=null;row.registration_email=null;row.registration_name=null;}}
 async deletePlayerAccount(w,p,id){window.requests.push(['account',id]);roster=roster.map(r=>r.id===id?{...r,user:null}:r);events=events.map(e=>e.roster_identity===id?{...e,has_account:false}:e)}
 async approvePlayer(w,p,id){const row=roster.find(r=>r.id===id);row.status='active';row.registration_status=null;row.user='approved';return row}
}
window.emptyRoster=()=>{roster=[]};
window.renameRosterPlayer=(id,name)=>{roster.find((player)=>player.id===id).player_name=name};
window.addRosterClaim=()=>{roster.push({...mk('claim','Roster Athlete','active',null,'pending'),jersey_number:'10',registration_email:'claimant@example.com',registration_name:'Account Name'})};
`
);
await put(
  "fixture",
  `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {RosterProvider,useRoster} from ${JSON.stringify(path.join(web, "ce/features/roster/store/roster-context.tsx"))};
import RosterPage from ${JSON.stringify(path.join(web, "ce/features/roster/components/roster-page.tsx"))};
window.testRole='member';
function Controls(){const r=useRoster();return <><input aria-label="Search roster" value={r.searchValue} onChange={e=>r.setSearchValue(e.target.value)}/><button onClick={r.openCreatePlayerModal}>Add fixture player</button><button onClick={()=>{window.emptyRoster();r.refetchRoster()}}>Empty fixture</button><button onClick={()=>{window.addRosterClaim();r.refetchRoster()}}>Add claim fixture</button></>}
function Fixture(){const [role,setRole]=useState('member');return <><button onClick={()=>{window.testRole='admin';setRole('admin')}}>Become admin fixture</button><RosterProvider key={role}><Controls/><RosterPage/></RosterProvider></>}
createRoot(document.getElementById('root')).render(<Fixture/>);
`
);
await build({
  entryPoints: [files.fixture],
  outfile: path.join(temp, "app.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  define: { "process.env": "{}" },
  nodePaths: [path.join(web, "node_modules"), path.join(repo, "node_modules")],
  plugins: [
    {
      name: "fixture-boundaries",
      setup(builder) {
        builder.onResolve({ filter: /^@plane\/(ui|propel\/button)$/ }, () => ({ path: files.ui }));
        builder.onResolve(
          {
            filter:
              /^(@\/hooks\/store\/user|@\/hooks\/use-user-readonly|@\/components\/core\/page-title|next\/navigation|next\/link|@plane\/constants|@plane\/propel\/toast|@plane\/utils)$/,
          },
          () => ({ path: files.boundaries })
        );
        builder.onResolve({ filter: /^@\/services\/(roster|workspace).service$/ }, () => ({ path: files.service }));
        builder.onResolve({ filter: /^\.\/roster-empty-state$/ }, () => ({ path: files.empty }));
      },
    },
  ],
});
const server = createServer(async (req, res) => {
  if (req.url === "/app.js") {
    res.setHeader("Content-Type", "text/javascript");
    res.end(await readFile(path.join(temp, "app.js")));
  } else {
    res.end('<html><body><div id="root"></div><script src="/app.js"></script></body></html>');
  }
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
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:" + server.address().port);
  const row = (name) => page.getByRole("row").filter({ has: page.getByText(name, { exact: true }) });
  await page.getByRole("tab", { name: "All players (2)", exact: true }).waitFor();
  const refresh = page.getByRole("button", { name: "Refresh", exact: true });
  await page.getByLabel("Search roster").fill("Alex");
  await page.evaluate(() => window.renameRosterPlayer("a", "Alex Updated"));
  await refresh.click();
  await row("Alex Updated").waitFor();
  assert.equal(await page.getByLabel("Search roster").inputValue(), "Alex");
  await page.evaluate(() => window.renameRosterPlayer("a", "Alex"));
  await refresh.click();
  await page.getByLabel("Search roster").fill("");
  await row("Casey").waitFor();
  assert.equal(await row("Blake").count(), 0);
  assert.equal(await row("Casey").getByText("Active", { exact: true }).count(), 1);
  assert.equal(await page.getByRole("button", { name: "Delete account", exact: true }).count(), 0);
  await page.getByRole("tab", { name: "Join requests (1)", exact: true }).click();
  assert.equal(await refresh.count(), 1);
  assert.equal(await page.getByRole("button", { name: "Edit", exact: true }).count(), 0);
  await page.getByRole("button", { name: "Approve Pending", exact: true }).click();
  await page.getByRole("tab", { name: "Join requests (0)", exact: true }).waitFor();
  await page.getByRole("tab", { name: "All players (3)", exact: true }).click();
  await row("Pending").getByText("Linked", { exact: true }).waitFor();
  await row("Alex").getByRole("button", { name: "Alex", exact: true }).click();
  const alexDetails = page.getByRole("complementary", { name: "Alex", exact: true });
  await alexDetails.waitFor();
  const rowPhoto = await row("Alex").getByRole("img", { name: "Alex", exact: true }).getAttribute("src");
  const detailsPhoto = alexDetails.getByRole("img", { name: "Alex", exact: true });
  assert.equal(await detailsPhoto.count(), 1, "Player details should display the roster photo");
  assert.equal(await detailsPhoto.getAttribute("src"), rowPhoto);

  const statusButtons = alexDetails.getByRole("group", { name: "Roster status" });
  const inactiveStatus = statusButtons.getByRole("button", { name: "inactive", exact: true });
  const activeStatus = statusButtons.getByRole("button", { name: "active", exact: true });
  const confirmInactive = page.getByRole("dialog", { name: "Set player inactive?" });
  await inactiveStatus.click();
  assert.equal(await confirmInactive.count(), 1, "Changing status should ask for confirmation");
  assert.equal((await page.evaluate(() => window.requests)).length, 0);
  await confirmInactive.getByRole("button", { name: "Cancel" }).click();
  assert.equal(await activeStatus.getAttribute("aria-pressed"), "true");
  assert.equal((await page.evaluate(() => window.requests)).length, 0);

  await inactiveStatus.click();
  await confirmInactive.getByRole("button", { name: "Set inactive" }).click();
  await confirmInactive.waitFor({ state: "hidden" });
  assert.equal(await inactiveStatus.getAttribute("aria-pressed"), "true");

  await activeStatus.click();
  const confirmActive = page.getByRole("dialog", { name: "Set player active?" });
  await confirmActive.waitFor();
  assert.deepEqual(await page.evaluate(() => window.requests), [["patch", "a", { status: "inactive" }]]);
  await confirmActive.getByRole("button", { name: "Set active" }).click();
  await confirmActive.waitFor({ state: "hidden" });
  assert.equal(await activeStatus.getAttribute("aria-pressed"), "true");

  await statusButtons.getByRole("button", { name: "Removed", exact: true }).click();
  const confirmRemoved = page.getByRole("dialog", { name: "Remove from roster", exact: true });
  await confirmRemoved.getByRole("button", { name: "Cancel" }).click();
  assert.deepEqual(await page.evaluate(() => window.requests), [
    ["patch", "a", { status: "inactive" }],
    ["patch", "a", { status: "active" }],
  ]);
  await alexDetails.getByRole("button", { name: "Close player details", exact: true }).click();
  await row("Casey").getByRole("button", { name: "Casey", exact: true }).click();
  const caseyDetails = page.getByRole("complementary", { name: "Casey", exact: true });
  await caseyDetails.getByText("C", { exact: true }).waitFor();
  assert.equal(await caseyDetails.locator("img").count(), 0);
  await caseyDetails.getByRole("button", { name: "Close player details", exact: true }).click();
  await page.evaluate(() => (window.failStatus = true));
  await row("Alex").getByRole("button", { name: "Set inactive", exact: true }).click();
  await page.waitForFunction(() => window.lastToast?.message === "Fixture status failure");
  assert.equal(await row("Alex").count(), 1);
  await page.evaluate(() => (window.failStatus = false));
  await row("Alex").getByRole("button", { name: "Set inactive", exact: true }).click();
  await page.getByRole("tab", { name: "Inactive (2)", exact: true }).click();
  await row("Alex").waitFor();
  assert.equal(await row("Casey").count(), 0);
  await row("Alex").getByRole("button", { name: "Set active", exact: true }).click();
  await page.getByRole("tab", { name: "All players (3)", exact: true }).click();
  await row("Alex").getByRole("button", { name: "Remove from roster", exact: true }).click();
  const removal = page.getByRole("dialog", { name: "Remove from roster", exact: true });
  assert.match(await removal.innerText(), /account and historical coaching cards/);
  await removal.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal((await page.evaluate(() => window.requests.filter((r) => r[0] === "remove"))).length, 0);
  await row("Alex").getByRole("button", { name: "Remove from roster", exact: true }).click();
  await removal.getByRole("button", { name: "Remove from roster", exact: true }).click();
  await page.getByRole("tab", { name: "All players (2)", exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.requests.filter((r) => r[0] === "account"))).length, 0);
  await page.getByRole("tab", { name: "Event log", exact: true }).click();
  await row("Alex").getByText("Removed", { exact: true }).first().waitFor();
  assert.equal(await page.getByRole("button", { name: "Delete account", exact: true }).count(), 0);
  await page.getByRole("button", { name: "Become admin fixture", exact: true }).click();
  await page.getByRole("tab", { name: "Event log", exact: true }).click();
  await row("Former Athlete").getByRole("button", { name: "Delete account", exact: true }).click();
  const deletion = page.getByRole("dialog", { name: "Permanently delete account", exact: true });
  assert.match(
    await deletion.innerText(),
    /globally removes their login, profile photo, memberships, and their own coaching cards/
  );
  await deletion.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal((await page.evaluate(() => window.requests.filter((r) => r[0] === "account"))).length, 0);
  await row("Former Athlete").getByRole("button", { name: "Delete account", exact: true }).click();
  await deletion.getByRole("button", { name: "Delete account", exact: true }).click();
  await row("Former Athlete").getByText("No linked account", { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.requests.filter((r) => r[0] === "account")), [
    ["account", "former"],
  ]);
  await page.getByRole("tab", { name: "Inactive (1)", exact: true }).click();
  await page.getByLabel("Search roster").fill("no match");
  await page.getByText("No players match your search or filters.", { exact: true }).waitFor();
  assert.equal(await page.getByRole("tab", { name: "All players (2)", exact: true }).count(), 1);
  await page.getByLabel("Search roster").fill("");
  await page.getByRole("tab", { name: "All players (2)", exact: true }).click();
  await row("Casey").getByRole("checkbox", { name: "Select Casey", exact: true }).click();
  await page.getByRole("button", { name: "Set selected players inactive", exact: true }).click();
  await page.getByRole("tab", { name: "Inactive (2)", exact: true }).click();
  await row("Casey").waitFor();
  await row("Casey").getByRole("checkbox", { name: "Select Casey", exact: true }).click();
  await page.getByRole("button", { name: "Make selected players active", exact: true }).click();
  await page.getByRole("tab", { name: "Inactive (1)", exact: true }).waitFor();
  await page.getByRole("button", { name: "Empty fixture", exact: true }).click();
  await page.getByText("No players yet. Add player", { exact: true }).waitFor();
  await page.getByRole("tab", { name: "Event log", exact: true }).click();
  await row("Former Athlete").waitFor();
  await page.evaluate(() => (window.failEvents = true));
  await refresh.click();
  await page.getByRole("alert").getByText("Fixture history failure", { exact: true }).waitFor();
  await page.evaluate(() => (window.failEvents = false));
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await row("Former Athlete").waitFor();
  await page.getByRole("button", { name: "Add fixture player", exact: true }).click();
  await page.getByLabel("First name *", { exact: true }).fill("Avery");
  await page.getByLabel("Last name *", { exact: true }).fill("Lee");
  await page.getByRole("radio", { name: /Avery Lee/ }).check();
  assert.equal(await page.getByLabel("Email (optional)", { exact: true }).inputValue(), "avery@example.com");
  await page.getByLabel("Jersey #", { exact: true }).fill("42");
  await page.getByRole("switch", { name: "Add another", exact: true }).click();
  await page.getByRole("button", { name: "Add player", exact: true }).click();
  await page.waitForFunction(() => window.requests.filter((r) => r[0] === "create").length === 1);
  await page.waitForFunction(() => document.getElementById("roster-player-first-name")?.value === "");
  const created = await page.evaluate(() => window.requests.find((r) => r[0] === "create")[1]);
  assert.equal(created.player_name, "Avery Lee");
  assert.equal(created.email, "avery@example.com");
  await page.getByLabel("First name *", { exact: true }).fill("Other");
  await page.getByLabel("Last name *", { exact: true }).fill("Player");
  await page.getByLabel("Jersey #", { exact: true }).fill("42");
  assert.equal(await page.getByRole("button", { name: "Add player", exact: true }).isDisabled(), true);
  await page.getByLabel("Jersey #", { exact: true }).fill("43");
  await page.evaluate(() => (window.failCreate = true));
  await page.getByRole("button", { name: "Add player", exact: true }).click();
  await page
    .getByText("Player could not be saved. Your details are kept; review the error and try again.", { exact: true })
    .waitFor();
  assert.equal(await page.getByLabel("First name *", { exact: true }).inputValue(), "Other");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Add claim fixture", exact: true }).click();
  await page.getByRole("tab", { name: "All players (2)", exact: true }).click();
  await row("Roster Athlete").waitFor();
  await page.getByRole("tab", { name: "Join requests (1)", exact: true }).click();
  await page.getByText("claimant@example.com", { exact: true }).waitFor();
  await page.getByText("Account Name", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Decline", exact: true }).click();
  const decline = page.getByRole("dialog", { name: "Decline join request", exact: true });
  assert.match(
    await decline.innerText(),
    /roster entry, email, jersey number and tagging history will remain unchanged/
  );
  await decline.getByRole("button", { name: "Decline request", exact: true }).click();
  await page.getByRole("tab", { name: "Join requests (0)", exact: true }).waitFor();
  await page.getByRole("tab", { name: "All players (2)", exact: true }).click();
  await row("Roster Athlete").getByText("10", { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.requests.filter((r) => r[0] === "decline")), [
    ["decline", "claim"],
  ]);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: Player Details photo and initial fallback; active/inactive tabs and counts; injured normalization; pending approval; member status/remove/error/cancel flows; no account deletion on removal; removed event snapshots; admin global deletion confirmation and identity; empty roster/history; event retry."
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
