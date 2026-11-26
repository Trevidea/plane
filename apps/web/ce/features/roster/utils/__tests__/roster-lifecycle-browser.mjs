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
export const Avatar=({name})=><span aria-hidden="true">{name?.slice(0,1)}</span>;
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
export const usePathname=()=>window.location.pathname;
export const Dialog={Title:({children})=><h2>{children}</h2>};
export default function Link({children}){return <span>{children}</span>};
export const EUserPermissions={ADMIN:20,MEMBER:15}; export const EUserPermissionsLevel={WORKSPACE:'workspace',PROJECT:'project'};
export const API_BASE_URL='';
export const useUserPermissions=()=>({allowPermissions:(roles)=>roles.includes(15)||window.testRole==='admin'});
export const useUserReadOnly=()=>false;
export const TOAST_TYPE={SUCCESS:'success',ERROR:'error'}; export const setToast=(toast)=>{window.lastToast=toast};
`
);
await put(
  "metadata",
  `
export default function Sport({onChange}) { return <select aria-label="Sport" onChange={(e)=>onChange(e.target.value)}><option/><option>Basketball</option></select>; }
export function ProjectEventMetadataFields({control}) { return <>
  <select aria-label="Season" onChange={e=>control._formValues.event_season=e.target.value}><option/><option>2026-2027</option></select>
  <select aria-label="Division" onChange={e=>control._formValues.event_program=e.target.value}><option/><option>Women</option></select>
  <select aria-label="Level" onChange={e=>control._formValues.event_level=e.target.value}><option/><option>Varsity</option></select>
</>; }
`
);
await put("empty", `import React from 'react'; export const RosterEmptyState=()=> <p>No players yet. Add player</p>;`);
await put(
  "service",
  `
const mk=(id,name,status,user=null,registration_status=null)=>({id,player_name:name,status,user,registration_status,jersey_number:'17',created_at:'2026-11-18',updated_at:'2026-11-18'});
let roster=[mk('a','Alex','active','account-a'),mk('b','Blake','inactive','account-b'),mk('c','Casey','injured','account-c'),mk('p','Pending','pending',null,'pending')];
let events=[{id:'old',roster_identity:'former',player_name:'Former Athlete',jersey_number:'42',action:'removed',previous_status:'active',status:'removed',created_at:'2026-11-18',actor_name:'Coach',has_account:true}];
const teams=[], seasons=[], staff=[];
const response=(results)=>({results:structuredClone(results),next:null,previous:null});
window.requests=[];
export class AuthService { async requestCSRFToken() { return {csrf_token:'fixture-csrf'}; } }
export class APIService {
  async post(url, body) {
    window.requests.push(['diagnostic',url,body]);
    const incident={id:'1'.repeat(32),reference:'LOCAL-FIXTURE',analysis_status:'completed',submission_status:'not-submitted',can_share:true};
    if(body.mode==='send'){incident.submission_status='received';incident.support_reference='KAN-FIXTURE';}
    return {data:{incident}};
  }
}
export const teamSeasonError=(e)=>e.message;
export class TeamSeasonService {
 async correctAccount(w,p,id,current,replacement){window.requests.push(['correct',id,current,replacement]); const row=roster.find(r=>r.id===id);row.user=replacement;row.email='';row.account_link_held=!replacement;return row;}
 async readPage(w,route){
   if(route==='teams')return response(teams);
   if(route.endsWith('/seasons'))return response(seasons);
   if(route.endsWith('/staff'))return response(staff);
   if(route==='staff-options')return response([{id:'operator',name:'Operator Fixture'}]);
   return response([]);
 }
 async createTeam(w,name){const team={id:'team-1',name};teams.push(team);return team;}
 async addSeason(w,team,data){window.requests.push(['season',team,data]);const row={...data,id:'season-1',project_id:'project-1',archived:false};seasons.push(row);return row;}
 async setStaff(w,season,id,values){window.requests.push(['assign',season,id,values]);staff.splice(0,staff.length,{id,name:'Operator Fixture',...values});}
 async clearStaff(){staff.splice(0,staff.length);}
}
export class WorkspaceService { async fetchWorkspaceMembers(){return [{id:'membership',role:1,is_active:true,member:{id:'avery-account',first_name:'Avery',last_name:'Lee',email:'avery@example.com',is_bot:false}}]} }
export class RosterService {
 async createRosterPlayer(w,p,payload){window.requests.push(['create',payload]);if(window.failCreate)throw {error:'Fixture save failure'};const row={...payload,id:'created-'+roster.length,program_id:p,user:payload.existing_account_id??null,created_at:'2026-11-18',updated_at:'2026-11-18'};roster.push(row);return structuredClone(row)}
 async getRoster(){return structuredClone(roster)}
 async previewPlayerAccountDeletion(){const enabled=!!window.allowDelete;return {enabled, confirmation:enabled?'reviewed-batch':null, impact:{workspace_memberships:1,program_memberships:2,personal_cards:3,shared_cards:4,roster_entries:5,profile_images:1,private_messages:2,private_attachments:0,activity_progress:0,join_records:1}}}
 async getRosterEvents(){if(window.failEvents)throw {error:'Fixture history failure'}; return structuredClone(events)}
 async updateRosterPlayer(w,p,id,payload){window.requests.push(['patch',id,payload]); if(window.failStatus)throw {error:'Fixture status failure'};const row=roster.find(r=>r.id===id);Object.assign(row,payload);if(payload.status==='inactive')row.jersey_number=null;return structuredClone(row)}
 async deleteRosterPlayer(w,p,id){window.requests.push(['remove',id]);const row=roster.find(r=>r.id===id);roster=roster.filter(r=>r.id!==id);events.unshift({id:'event-'+id,roster_identity:id,player_name:row.player_name,jersey_number:row.jersey_number,action:'removed',previous_status:row.status,status:'removed',created_at:'2026-11-18',actor_name:'Coach',has_account:!!row.user})}
 async declinePlayer(w,p,id){window.requests.push(['decline',id]);const row=roster.find(r=>r.id===id);if(row.status==='pending')roster=roster.filter(r=>r.id!==id);else {row.registration_status=null;row.registration_email=null;row.registration_name=null;}}
 async deletePlayerAccount(w,p,id,confirmation){window.requests.push(['account',id,confirmation]);roster=roster.map(r=>r.id===id?{...r,user:null}:r);events=events.map(e=>e.roster_identity===id?{...e,has_account:false}:e)}
 async approvePlayer(w,p,id){const row=roster.find(r=>r.id===id);row.status='active';row.registration_status=null;row.user='approved';return row}
 async resendPlayerInvitation(w,p,id){window.requests.push(['resend',id]);const row=roster.find(r=>r.id===id);row.invitation_delivery={status:'queued',retry_after:'2099-01-01T00:00:00Z'};return structuredClone(row)}
 async issuePlayerResetCode(w,p,id,user){window.requests.push(['reset',id,user]);return {code:'KT47-JF6P-KT47-JF6P',expiresAt:'2099-01-01T00:00:00Z'}}
}
window.emptyRoster=()=>{roster=[]};
window.addCorrectionFixture=()=>{roster.push(mk('correction','Correction Athlete','active','wrong-account'))};
window.addRosterClaim=()=>{roster.push({...mk('claim','Roster Athlete','active',null,'pending'),jersey_number:'10',registration_email:'claimant@example.com',registration_name:'Account Name'})};
window.addDeliveryFixture=()=>{roster.push({...mk('mail','Mail Athlete','active'),email:'mail@example.com',account_status:'invitation_pending',invitation_delivery:{status:'failed',retry_after:null}})};
window.acceptFixtureEmail=()=>{roster.find(r=>r.id==='mail').invitation_delivery={status:'accepted',retry_after:'2099-01-01T00:00:00Z'}};
`
);
await put(
  "fixture",
  `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {RosterProvider,useRoster} from ${JSON.stringify(path.join(web, "ce/features/roster/store/roster-context.tsx"))};
import RosterPage from ${JSON.stringify(path.join(web, "ce/features/roster/components/roster-page.tsx"))};
import {TeamSeasonAdmin} from ${JSON.stringify(path.join(web, "ce/features/programs/team-season-admin.tsx"))};
window.testRole='member';
function Controls(){const r=useRoster();return <><input aria-label="Search roster" value={r.searchValue} onChange={e=>r.setSearchValue(e.target.value)}/><button onClick={r.openCreatePlayerModal}>Add fixture player</button><button onClick={()=>{window.emptyRoster();r.refetchRoster()}}>Empty fixture</button><button onClick={()=>{window.addRosterClaim();r.refetchRoster()}}>Add claim fixture</button><button onClick={()=>{window.addDeliveryFixture();r.refetchRoster()}}>Add delivery fixture</button><button onClick={()=>{window.addCorrectionFixture();r.refetchRoster()}}>Add correction fixture</button></>}
function Fixture(){const [role,setRole]=useState('member'),[teams,setTeams]=useState(false);return <><button onClick={()=>{window.testRole='admin';setRole('admin')}}>Become admin fixture</button><button onClick={()=>setTeams(true)}>Open team admin fixture</button>{teams?<TeamSeasonAdmin/>:<RosterProvider key={role}><Controls/><RosterPage/></RosterProvider>}</>}
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
        builder.onResolve({ filter: /^@headlessui\/react$/ }, () => ({ path: files.boundaries }));
        builder.onResolve(
          {
            filter:
              /^(@\/hooks\/store\/user|@\/hooks\/use-user-readonly|@\/components\/core\/page-title|next\/navigation|next\/link|@plane\/constants|@plane\/propel\/toast)$/,
          },
          () => ({ path: files.boundaries })
        );
        builder.onResolve({ filter: /^@\/services\/(api|auth|roster|team-season|workspace).service$/ }, () => ({
          path: files.service,
        }));
        builder.onResolve(
          { filter: /^@\/components\/(dropdowns\/sport-property|project\/event-metadata-fields)$/ },
          () => ({ path: files.metadata })
        );
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
  assert.equal(await row("Blake").count(), 0);
  assert.equal(await row("Casey").getByText("Active", { exact: true }).count(), 1);
  assert.equal(await page.getByRole("button", { name: "Delete account", exact: true }).count(), 0);
  await page.getByRole("tab", { name: "Join requests (1)", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Edit", exact: true }).count(), 0);
  await page.getByRole("button", { name: "Approve Pending", exact: true }).click();
  await page.getByRole("tab", { name: "Join requests (0)", exact: true }).waitFor();
  await page.getByRole("button", { name: "Report issue", exact: true }).click();
  const issue = page.getByRole("dialog", { name: "Report roster issue" });
  assert.equal(await issue.getByRole("button", { name: "Send to Kanavio" }).count(), 0);
  await issue.getByRole("button", { name: "Save locally" }).click();
  await issue.getByText(/Stored locally, not shared/).waitFor();
  assert.deepEqual(await page.evaluate(() => window.requests.filter((r) => r[0] === "diagnostic").map((r) => r[2].mode)), ["save"]);
  await issue.getByRole("button", { name: "Send to Kanavio" }).click();
  await issue.getByText(/Received by Kanavio/).waitFor();
  await issue.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("tab", { name: "All players (3)", exact: true }).click();
  await row("Pending").getByText("Linked", { exact: true }).waitFor();
  await row("Alex").getByRole("button", { name: "Alex", exact: true }).click();
  await page.getByRole("heading", { name: "Alex", exact: true }).waitFor();
  await page.getByRole("button", { name: "Reset password", exact: true }).click();
  const reset = page.getByRole("dialog").filter({ hasText: "Reset password for Alex" });
  assert.match(await reset.innerText(), /replaces any previous code/);
  await reset.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.requests.filter((r) => r[0] === "reset")), []);
  await page.getByRole("button", { name: "Reset password", exact: true }).click();
  await reset.getByRole("button", { name: "Issue reset code", exact: true }).click();
  await page.getByText("KT47-JF6P-KT47-JF6P", { exact: true }).waitFor();
  const resetDialog = page.getByRole("dialog").filter({ hasText: "One-time reset code" });
  const privateReset = resetDialog.locator("[data-support-private]");
  assert.equal(await privateReset.innerText(), "KT47-JF6P-KT47-JF6P");
  if (process.env.RESET_SCREENSHOT)
    await resetDialog.screenshot({ path: process.env.RESET_SCREENSHOT, mask: [privateReset], maskColor: "#101820" });
  await page.getByRole("button", { name: "Done", exact: true }).click();
  assert.equal(await page.getByText("KT47-JF6P-KT47-JF6P", { exact: true }).count(), 0);
  assert.deepEqual(await page.evaluate(() => window.requests.filter((r) => r[0] === "reset")), [
    ["reset", "a", "account-a"],
  ]);
  await page.getByRole("button", { name: "Close player details", exact: true }).click();
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
  const previewButton = row("Former Athlete").getByRole("button", { name: "Preview account deletion", exact: true });
  await previewButton.click();
  const deletion = page.getByRole("dialog").filter({ hasText: "Account deletion preview" });
  await deletion.getByText("Permanent deletion is disabled.", { exact: true }).waitFor();
  await deletion.getByText("Shared cards kept", { exact: true }).waitFor();
  assert.equal(await deletion.getByRole("button", { name: "Delete account", exact: true }).count(), 0);
  await deletion.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal((await page.evaluate(() => window.requests.filter((r) => r[0] === "account"))).length, 0);
  await page.evaluate(() => (window.allowDelete = true));
  await previewButton.click();
  await deletion.getByRole("button", { name: "Delete account", exact: true }).waitFor();
  assert.equal(await deletion.getByRole("button", { name: "Delete account", exact: true }).isDisabled(), true);
  await deletion.getByRole("checkbox", { name: /I reviewed the impact/ }).check();
  await deletion.getByRole("button", { name: "Delete account", exact: true }).click();
  await row("Former Athlete").getByText("No linked account", { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.requests.filter((r) => r[0] === "account")), [
    ["account", "former", "reviewed-batch"],
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
  await page.getByRole("tab", { name: "All players (0)", exact: true }).click();
  await page.getByRole("tab", { name: "Event log", exact: true }).click();
  await page.getByRole("alert").getByText("Fixture history failure", { exact: true }).waitFor();
  await page.evaluate(() => (window.failEvents = false));
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await row("Former Athlete").waitFor();
  await page.getByRole("button", { name: "Add fixture player", exact: true }).click();
  await page.getByLabel("First name *", { exact: true }).fill("Avery");
  await page.getByLabel("Last name *", { exact: true }).fill("Lee");
  await page.getByLabel("Email (optional)", { exact: true }).fill("avery@example.com");
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
  await page.getByRole("button", { name: "Add delivery fixture", exact: true }).click();
  await row("Mail Athlete").getByText("Email failed", { exact: true }).waitFor();
  await row("Mail Athlete").getByRole("button", { name: "Mail Athlete", exact: true }).click();
  const details = page.getByRole("complementary", { name: "Mail Athlete" });
  await details.getByText(/share the team join link/).waitFor();
  await details.getByRole("button", { name: "Resend invitation", exact: true }).click();
  await details.getByText("Email queued", { exact: true }).waitFor();
  assert.equal(await details.getByRole("button", { name: "Resend invitation", exact: true }).isDisabled(), true);
  await page.evaluate(() => window.acceptFixtureEmail());
  await details.getByRole("button", { name: "Refresh status", exact: true }).click();
  await details.getByText("Accepted by mail server", { exact: true }).waitFor();
  await details.getByText("Inbox delivery is not confirmed.", { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.requests.filter((r) => r[0] === "resend")), [["resend", "mail"]]);
  await details.getByRole("button", { name: "Close player details", exact: true }).click();
  await page.getByRole("button", { name: "Add correction fixture" }).click();
  await row("Correction Athlete").getByRole("button", { name: "Correction Athlete", exact: true }).click();
  await page.getByRole("button", { name: "Correct account link", exact: true }).click();
  const correction = page.getByRole("dialog").filter({ hasText: "Correct account link" });
  assert.equal(await correction.getByRole("button", { name: "Confirm correction" }).isDisabled(), true);
  await correction.getByRole("radio", { name: "Revoke access and leave unlinked" }).check();
  await correction.getByRole("button", { name: "Confirm correction" }).click();
  await correction.waitFor({ state: "hidden" });
  await row("Correction Athlete").getByText("Account access revoked", { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.requests.filter((r) => r[0] === "correct")), [
    ["correct", "correction", "wrong-account", null],
  ]);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open team admin fixture" }).click();
  await page.getByRole("heading", { name: "Teams and seasons" }).waitFor();
  await page.getByRole("textbox", { name: "Team name" }).fill("Girls Varsity");
  await page.getByRole("button", { name: "Create team" }).click();
  await page.getByRole("textbox", { name: "Program name" }).fill("Girls Varsity 26-27");
  await page.getByRole("textbox", { name: "Program ID" }).fill("VAR2627");
  await page.getByLabel("Sport", { exact: true }).selectOption("Basketball");
  await page.getByLabel("Season", { exact: true }).selectOption("2026-2027");
  await page.getByLabel("Division", { exact: true }).selectOption("Women");
  await page.getByLabel("Level", { exact: true }).selectOption("Varsity");
  await page.getByRole("button", { name: "Create season" }).click();
  await page.getByRole("heading", { name: "Season staff", exact: true }).first().waitFor();
  const rendered = await page.evaluate(() =>
    [...document.querySelectorAll("h2")]
      .filter((h) => h.textContent === "Season staff")
      .map((h) => h.parentElement.outerHTML.slice(0, 220))
  );
  assert.equal(rendered.length, 1, JSON.stringify(rendered));
  await page.getByLabel("Workspace staff", { exact: true }).selectOption("operator");
  await page.getByLabel("Staff assignment", { exact: true }).selectOption("operator");
  await page.getByLabel("Delegate roster edits", { exact: true }).check();
  await page.getByRole("button", { name: "Save assignment" }).click();
  await page.getByRole("button", { name: "Remove assignment for Operator Fixture" }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.requests.filter((r) => r[0] === "assign")), [
    ["assign", "season-1", "operator", { assignment: "operator", manage_roster: true }],
  ]);
  assert.deepEqual(errors, []);
  console.log("PASS: roster lifecycle, guarded account correction, team and season creation, and staff assignment.");
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
