// Component browser test with fixture registration data; no real enrollment or accounts.
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
const temp = await mkdtemp(path.join(tmpdir(), "roster-import-browser-"));
const ui = path.join(temp, "ui.tsx");
const fixture = path.join(temp, "fixture.tsx");
const service = path.join(temp, "service.ts");
const context = path.join(temp, "context.tsx");
const permissions = path.join(temp, "permissions.ts");
const toast = path.join(temp, "toast.ts");
await writeFile(
  context,
  `import { createContext, useContext } from 'react'; export const RosterContext=createContext(null); export const useRoster=()=>useContext(RosterContext);
export const getRosterFormState=()=>({player_name:'',email:'',jersey_number:'',position:'',height:'',weight:'',class_year:'',status:'active',notes:''});`
);
await writeFile(permissions, `export const useUserPermissions=()=>({allowPermissions:()=>true});`);
await writeFile(toast, `export const TOAST_TYPE={SUCCESS:'success',ERROR:'error'}; export const setToast=()=>{};`);
await writeFile(
  ui,
  `
export { Button } from ${JSON.stringify(path.join(repo, "packages/ui/src/button/button.tsx"))};
export { Input } from ${JSON.stringify(path.join(repo, "packages/ui/src/form-fields/input.tsx"))};
export { TextArea } from ${JSON.stringify(path.join(repo, "packages/ui/src/form-fields/textarea.tsx"))};
export { ToggleSwitch } from ${JSON.stringify(path.join(repo, "packages/ui/src/button/toggle-switch.tsx"))};
export { CustomMenu } from ${JSON.stringify(path.join(repo, "packages/ui/src/dropdowns/custom-menu.tsx"))};
export { CustomSelect } from ${JSON.stringify(path.join(repo, "packages/ui/src/dropdowns/custom-select.tsx"))};
export { ModalCore } from ${JSON.stringify(path.join(repo, "packages/ui/src/modals/modal-core.tsx"))};
export { EModalWidth, EModalPosition } from ${JSON.stringify(path.join(repo, "packages/ui/src/modals/constants.ts"))};
export { cn } from ${JSON.stringify(path.join(repo, "packages/ui/src/utils/index.ts"))};
`
);
await writeFile(
  service,
  `
let current = null;
export class RosterService {
  async findImportReturningAccounts(workspace, program, queries) {
    window.importMatchQueries = queries;
    return {rows: queries.map(query => ({
      results: query.player_name === 'Jordan Lee' ? [
        {id:'first-account',email:'jordan@example.com',previous_program:'2025 Varsity'},
        {id:'second-account',email:'jordan2@example.com',previous_program:'2024 JV'}
      ] : [], has_more:false
    }))};
  }
  async findReturningAccounts(workspace, program, name, year) {
    window.matchQuery = { workspace, program, name, year };
    return { results: [{id:'first-account',email:'jordan@example.com'},{id:'second-account',email:'jordan2@example.com'}], has_more:false };
  }
  async getRegistration() { return current; }
  async generateRegistration() {
    current = { token: 'fixture', url: 'http://localhost:8000/auth/player-registration/?token=fixture',
      workspace_name: 'Fixture School', program_name: 'Varsity Basketball', expires_at: new Date(Date.now()+900000).toISOString() };
    return current;
  }
  async closeRegistration() { current = null; }
  async approvePlayer() { return {}; }
}
`
);
await writeFile(
  fixture,
  `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {RosterAddPlayerActions} from ${JSON.stringify(path.join(web, "ce/features/roster/components/roster-add-player-actions.tsx"))};
import {RosterExportDropdown} from ${JSON.stringify(path.join(web, "ce/features/roster/components/roster-export-dropdown.tsx"))};
import {ImportRosterModal} from ${JSON.stringify(path.join(web, "ce/features/roster/components/roster-import-modal.tsx"))};
import {AddPlayerModal} from ${JSON.stringify(path.join(web, "ce/features/roster/components/roster-add-player-modal.tsx"))};
import {RosterContext} from ${JSON.stringify(context)};
function Fixture(){
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[adding,setAdding]=useState(false);
 return <><RosterExportDropdown projectId="fixture" players={[{id:'export-player',player_name:'Export Player',email:'export@example.com',jersey_number:'07',status:'active'}]}/><RosterAddPlayerActions onAdd={()=>window.addClicks=(window.addClicks||0)+1} onImport={()=>setOpen(true)}/><button onClick={()=>setOpen(true)}>Open import</button><button onClick={()=>setAdding(true)}>Open add form</button><RosterContext.Provider value={{
 isImportRosterModalOpen:open,isSubmitting:busy,canManage:true,
 isAddPlayerModalOpen:adding,closePlayerModal:()=>setAdding(false),workspaceSlug:'school',projectId:'fixture',positionOptions:[],classYearOptions:[],
 submitPlayer:async(payload,options)=>{window.addedPlayer={payload,options};setAdding(false);return true},
 closeImportRosterModal:()=>setOpen(false),pendingImportFile:null,setPendingImportFile:()=>{},
 allPlayers:[{id:'existing',player_name:'Existing Player',email:'existing@example.com',jersey_number:'7',status:'active'}],
 importPlayers:async(rows,importId,retry)=>{
   window.importedRows=rows;window.importAttempts=[...(window.importAttempts||[]),{rows,importId}];
   window.isExactRetry=retry;
   setBusy(true);await new Promise(r=>setTimeout(r,100));setBusy(false);
   if(window.failImportOnce){window.failImportOnce=false;return {kind:'unknown'};}
   if(window.rejectMatchOnce){window.rejectMatchOnce=false;return {kind:'rejected',rowError:{index:0,message:'No longer a match.'}};}
   setOpen(false);return {kind:'saved'};
 }
 }}><ImportRosterModal/><AddPlayerModal/></RosterContext.Provider></>
}
createRoot(document.getElementById('root')).render(<Fixture/>);
`
);
await build({
  entryPoints: [fixture],
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
        builder.onResolve({ filter: /^next\/image$/ }, () => ({ path: "image", namespace: "fixture-image" }));
        builder.onLoad({ filter: /.*/, namespace: "fixture-image" }, () => ({
          contents: 'import React from "react"; export default function Image(props){return <img {...props}/>}',
          loader: "jsx",
          resolveDir: web,
        }));
        builder.onResolve({ filter: /^@plane\/(ui|propel\/button)$/ }, () => ({ path: ui }));
        builder.onResolve({ filter: /^@\/services\/roster.service$/ }, () => ({ path: service }));
        builder.onResolve({ filter: /\/store\/roster-context$/ }, () => ({ path: context }));
        builder.onResolve({ filter: /^@\/hooks\/store\/user$/ }, () => ({ path: permissions }));
        builder.onResolve({ filter: /^@plane\/propel\/toast$/ }, () => ({ path: toast }));
      },
    },
  ],
});
const tailwindRequire = createRequire(path.join(repo, "packages/tailwind-config/package.json"));
const postcss = tailwindRequire("postcss");
const tailwind = tailwindRequire("tailwindcss");
const css = await postcss([
  tailwind({
    content: [
      path.join(web, "ce/features/roster/components/roster-import-modal.tsx"),
      path.join(web, "ce/features/roster/components/roster-add-player-actions.tsx"),
      path.join(web, "ce/features/roster/components/roster-add-player-modal.tsx"),
      path.join(web, "ce/features/roster/components/roster-approval-button.tsx"),
      path.join(repo, "packages/ui/src/modals/*.{ts,tsx}"),
      path.join(repo, "packages/ui/src/button/*.{ts,tsx}"),
      path.join(repo, "packages/ui/src/dropdowns/*.{ts,tsx}"),
      path.join(repo, "packages/ui/src/form-fields/*.{ts,tsx}"),
    ],
    theme: {
      extend: {
        colors: {
          "custom-background-100": "#191919",
          "custom-background-90": "#242424",
          "custom-text-100": "#fafafa",
          "custom-text-200": "#dedede",
          "custom-text-300": "#a3a3a3",
          "custom-primary-100": "#0ea5e9",
          "custom-border-200": "#404040",
          "custom-backdrop": "#0009",
        },
      },
    },
  }),
]).process("@tailwind base; @tailwind utilities;", { from: undefined });
const server = createServer(async (request, response) => {
  if (request.url === "/app.js") {
    response.setHeader("Content-Type", "text/javascript");
    response.end(await readFile(path.join(temp, "app.js")));
  } else {
    response.setHeader("Content-Type", "text/html");
    response.end(
      `<html><head><style>${css.css} body{background:#101010;color:white;font-family:system-ui}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>`
    );
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:" + server.address().port);
  const XLSX = require("xlsx");
  for (const format of ["XLSX", "CSV"]) {
    await page.getByRole("button", { name: "Export roster", exact: true }).click();
    const choice = page.getByRole("menuitem", { name: `Export as ${format}`, exact: true });
    assert.equal(
      await choice.locator("img").getAttribute("src"),
      format === "XLSX" ? "/attachment/excel-icon.png" : "/attachment/csv-icon.png"
    );
    const downloading = page.waitForEvent("download");
    await choice.click();
    const download = await downloading;
    assert.equal(download.suggestedFilename(), `roster-fixture.${format.toLowerCase()}`);
    const bytes = await readFile(await download.path());
    if (format === "XLSX") assert.equal(bytes.subarray(0, 2).toString(), "PK", "Excel export must be an XLSX workbook");
    const workbook = XLSX.read(bytes, { type: "buffer", raw: true });
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
    assert.equal(rows[0].player_name, "Export Player");
    assert.equal(rows[0].jersey_number, "07");
  }
  const addAction = page.getByRole("button", { name: "Add player", exact: true });
  const moreActions = page.getByRole("button", { name: "More ways to add players", exact: true });
  const addBounds = await addAction.boundingBox(),
    moreBounds = await moreActions.boundingBox();
  assert.equal(addBounds.height, moreBounds.height, "split button halves must have identical height");
  assert.equal(addBounds.y, moreBounds.y, "split button halves must align vertically");
  await page
    .getByRole("group", { name: "Add players", exact: true })
    .screenshot({ path: "/tmp/kanavio-add-player-split-button.png" });
  await addAction.click();
  assert.equal(await page.evaluate(() => window.addClicks), 1);
  await moreActions.click();
  await page.getByRole("menuitem", { name: "Import CSV or Excel", exact: true }).click();

  await page.locator("input[type=file]").setInputFiles({
    name: "roster.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "First Name,Last Name,Jersey,Email,Grad Year,Position,Height,Weight,Status,Notes\nAda,Lovelace,12,ada@example.com,2028,Guard,6ft,180,active,Returning player\nGrace,Hopper,12,ada@example.com,2029,Forward,6ft,190,active,\nNew,Player,7,new@example.com,2028,Center,6ft,200,active,"
    ),
  });
  await page.getByRole("button", { name: "Map columns", exact: true }).click();
  await page.getByRole("button", { name: /Field for First Name:/ }).waitFor();
  await page.setViewportSize({ width: 1024, height: 720 });
  await page.getByRole("button", { name: /Field for Notes:/ }).click();
  const fieldMenu = page.getByRole("menu").locator(":scope > div");
  await fieldMenu.waitFor();
  assert.equal(await page.locator("select").count(), 0, "mapping must use Plane dropdowns rather than native selects");
  const menuBounds = await fieldMenu.boundingBox();
  assert.ok(menuBounds.height <= 180, "mapping options should use a compact scrollable Plane menu");
  assert.ok(menuBounds.y >= 0 && menuBounds.y + menuBounds.height <= 720, "dropdown must stay within the viewport");
  await page.screenshot({ path: "/tmp/kanavio-plane-field-dropdown.png" });
  await page.getByRole("menuitem", { name: "Don't import", exact: true }).click();
  await page.getByRole("button", { name: /Field for Notes:/ }).click();
  await page.getByRole("menuitem", { name: "Notes", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Review rows", exact: true }).click();
  // A complete roster template must not push feedback and actions offscreen.
  const reviewRow = page.getByRole("row").filter({ has: page.getByLabel("Email for row 2", { exact: true }) });
  const feedback = page.locator("#roster-import-review-0");
  const feedbackBounds = await feedback.boundingBox();
  const dialogBounds = await page.getByRole("dialog").boundingBox();
  assert.ok(
    feedbackBounds.x >= dialogBounds.x &&
      feedbackBounds.x + feedbackBounds.width <= dialogBounds.x + dialogBounds.width,
    "review messages must fit inside the dialog for all template columns"
  );
  const decisionBounds = await reviewRow.getByRole("button", { name: "Exclude", exact: true }).boundingBox();
  assert.ok(
    decisionBounds.x + decisionBounds.width <= dialogBounds.x + dialogBounds.width,
    "row decisions must remain in the dialog without horizontal scrolling"
  );
  for (const width of [1024, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const fits = await page
      .getByRole("table", { name: "Roster import review", exact: true })
      .evaluate((table) => table.scrollWidth <= table.parentElement.clientWidth);
    assert.ok(fits, `full-template review must not overflow horizontally at ${width}px`);
    const action = await reviewRow.getByRole("button", { name: "Exclude", exact: true }).boundingBox();
    const dialog = await page.getByRole("dialog").boundingBox();
    assert.ok(action.x + action.width <= dialog.x + dialog.width, `row decision must fit at ${width}px`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await reviewRow.locator("summary").click();
  await page.getByLabel("Height for row 2", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Notes for row 2", { exact: true }).inputValue(), "Returning player");
  await reviewRow.locator("summary").click();
  const submit = () => page.getByRole("button", { name: "Import 3 players", exact: true });
  assert.equal(await submit().isDisabled(), true);
  assert.equal(await page.getByLabel("Email for row 2", { exact: true }).getAttribute("aria-invalid"), "true");
  assert.equal(await page.getByLabel("Jersey # for row 4", { exact: true }).getAttribute("aria-invalid"), "true");
  await page.getByLabel("Email for row 3", { exact: true }).fill("grace@example.com");
  await page.getByLabel("Jersey # for row 3", { exact: true }).fill("13");
  await page.getByLabel("Jersey # for row 4", { exact: true }).fill("14");
  assert.equal(await submit().isDisabled(), false);
  assert.equal(await page.getByLabel("Email for row 2", { exact: true }).getAttribute("aria-invalid"), "false");
  await page.getByLabel("Player name for row 4", { exact: true }).fill("");
  assert.equal(await submit().isDisabled(), true);
  await page.getByLabel("Player name for row 4", { exact: true }).fill("New Player");
  await page.getByRole("button", { name: "Check returning accounts", exact: true }).click();
  const row = page.getByRole("row").filter({ has: page.getByLabel("Email for row 3", { exact: true }) });
  await row.getByRole("button", { name: "Exclude", exact: true }).click();
  await page.getByRole("button", { name: "Import 2 players", exact: true }).waitFor();
  await row.getByRole("button", { name: "Restore", exact: true }).click();
  await submit().waitFor();
  await page.getByLabel("Jersey # for row 3", { exact: true }).fill("12");
  await page.getByRole("table", { name: "Roster import review", exact: true }).evaluate((table) => {
    table.parentElement.scrollTop = 0;
  });
  await page.screenshot({ path: "/tmp/kanavio-roster-import-duplicates.png", fullPage: true });
  await page.getByLabel("Jersey # for row 3", { exact: true }).fill("13");
  await submit().click();
  await page.waitForFunction(() => window.importedRows?.length === 3);
  assert.deepEqual(
    await page.evaluate(() => window.importedRows.map((r) => [r.player_name, r.jersey_number, r.email])),
    [
      ["Ada Lovelace", "12", "ada@example.com"],
      ["Grace Hopper", "13", "grace@example.com"],
      ["New Player", "14", "new@example.com"],
    ]
  );
  await page.getByRole("button", { name: "Open import", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Map columns", exact: true }).isDisabled(), true);
  await page
    .locator("input[type=file]")
    .setInputFiles({ name: "bad.txt", mimeType: "text/plain", buffer: Buffer.from("not a roster") });
  await page.getByRole("alert").filter({ hasText: "Choose a .csv or .xlsx file." }).waitFor();
  await page.locator("input[type=file]").setInputFiles({
    name: "same-names.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Name,Grad Year\nTaylor Smith,2028\nTaylor Smith,2028"),
  });
  await page.getByRole("button", { name: "Map columns", exact: true }).click();
  await page.getByRole("button", { name: "Review rows", exact: true }).click();
  const duplicateSubmit = page.getByRole("button", { name: "Import 2 players", exact: true });
  assert.equal(await duplicateSubmit.isDisabled(), true);
  await page.getByRole("button", { name: "Different person", exact: true }).nth(0).click();
  await page.getByRole("button", { name: "Different person", exact: true }).nth(1).click();
  assert.equal(await duplicateSubmit.isDisabled(), false);
  await page.getByLabel("Player name for row 2", { exact: true }).fill("Taylor Smith ");
  assert.equal(await duplicateSubmit.isDisabled(), true);
  await page.getByRole("button", { name: "Same person · exclude row", exact: true }).nth(1).click();
  await page.getByRole("button", { name: "Check returning accounts", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Import 1 player", exact: true }).isDisabled(), false);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Open import", exact: true }).click();
  await page.locator("input[type=file]").setInputFiles({
    name: "returning.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Name,Grad Year,Email\nJordan Lee,2027,\nNew Athlete,2029,new@example.test"),
  });
  await page.getByRole("button", { name: "Map columns", exact: true }).click();
  await page.getByRole("button", { name: "Review rows", exact: true }).click();
  const matchButton = page.getByRole("button", { name: /Account for row 2:/ });
  await matchButton.waitFor();
  assert.equal(await duplicateSubmit.isDisabled(), true, "a suggested account is not selected automatically");
  await matchButton.click();
  await page.getByRole("menuitem", { name: /jordan@example.com.*2025 Varsity/ }).click();
  assert.equal(await duplicateSubmit.isEnabled(), true);
  await page.getByLabel("Email for row 2", { exact: true }).fill("jordan2@example.com");
  assert.equal(await duplicateSubmit.isDisabled(), true, "editing the contact clears confirmation");
  await page.getByRole("button", { name: "Check returning accounts", exact: true }).click();
  await matchButton.click();
  assert.equal(
    await page.getByRole("menuitem", { name: /jordan@example.com.*2025 Varsity/ }).isDisabled(),
    true,
    "conflicting login email cannot be selected"
  );
  await page.getByRole("menuitem", { name: /jordan2@example.com.*2024 JV/ }).click();
  await page.evaluate(() => {
    window.rejectMatchOnce = true;
  });
  await duplicateSubmit.click();
  await page.getByRole("alert").filter({ hasText: "No longer a match." }).waitFor();
  assert.equal(await duplicateSubmit.isDisabled(), true, "a rejected account cannot be blindly resubmitted");
  await page.getByRole("button", { name: "Check returning accounts", exact: true }).click();
  await matchButton.click();
  await page.getByRole("menuitem", { name: /jordan2@example.com.*2024 JV/ }).click();
  await page.evaluate(() => {
    window.failImportOnce = true;
    window.importAttempts = [];
  });
  await duplicateSubmit.click();
  await page.getByRole("button", { name: "Retry import", exact: true }).waitFor();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Open import", exact: true }).click();
  await page.getByRole("button", { name: "Retry import", exact: true }).click();
  await page.waitForFunction(() => window.importAttempts?.length === 2);
  const attempts = await page.evaluate(() => window.importAttempts);
  assert.match(attempts[0].importId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(attempts[1], attempts[0], "retry must reuse the batch id and reviewed rows");
  assert.equal(await page.evaluate(() => window.isExactRetry), true);
  assert.equal(attempts[1].rows[0].existing_account_id, "second-account");
  assert.equal(attempts[1].rows[1].existing_account_id, undefined);
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open import", exact: true }).click();
  const bounds = await page.getByRole("dialog").boundingBox();
  assert.ok(bounds.width <= 390);
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Open add form", exact: true }).click();
  const addForm = page.getByRole("dialog");
  await addForm.getByLabel("First name *", { exact: true }).fill("Jordan");
  await addForm.getByLabel("Last name *", { exact: true }).fill("Lee");
  const find = addForm.getByRole("button", { name: "Find matching accounts", exact: true });
  assert.equal(await find.isDisabled(), true);
  const year = addForm.getByLabel("Grad year / class", { exact: true });
  await year.fill("2027");
  await find.click();
  await addForm.getByRole("radio", { name: "Keep unlinked", exact: true }).waitFor();
  assert.equal(await addForm.getByRole("radio", { name: "Keep unlinked", exact: true }).isChecked(), true);
  assert.equal(await addForm.getByRole("button", { name: "Add and link player", exact: true }).count(), 0);
  await addForm.getByRole("radio", { name: "jordan2@example.com", exact: true }).check();
  await year.fill("2028");
  assert.equal(await addForm.getByRole("button", { name: "Add and link player", exact: true }).count(), 0);
  await find.click();
  await addForm.getByRole("radio", { name: "jordan2@example.com", exact: true }).check();
  const email = addForm.getByLabel("Email (optional)", { exact: true });
  await email.fill("other@example.com");
  const confirm = addForm.getByRole("button", { name: "Add and link player", exact: true });
  assert.equal(await confirm.isDisabled(), true);
  await email.fill("");
  await confirm.click();
  assert.deepEqual(await page.evaluate(() => window.matchQuery), {
    workspace: "school",
    program: "fixture",
    name: "Jordan Lee",
    year: "2028",
  });
  assert.equal(await page.evaluate(() => window.addedPlayer.options.existingAccountId), "second-account");
  assert.equal(await page.evaluate(() => window.addedPlayer.payload.email), "");
  assert.deepEqual(errors, []);
  console.log(
    "PASS: Plane roster import and returning-account confirmation, including ambiguous matches, stale selection reset, email conflict, and exact submission payload at mobile width."
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
