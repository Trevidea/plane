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
const temp = await mkdtemp(path.join(tmpdir(), "qr-registration-browser-"));
const ui = path.join(temp, "ui.tsx");
const fixture = path.join(temp, "fixture.tsx");
const service = path.join(temp, "service.ts");
const context = path.join(temp, "context.tsx");
const permissions = path.join(temp, "permissions.ts");
const toast = path.join(temp, "toast.ts");
await writeFile(
  context,
  `import { createContext, useContext } from 'react'; export const RosterContext=createContext(null); export const useRoster=()=>useContext(RosterContext);`
);
await writeFile(permissions, `export const useUserPermissions=()=>({allowPermissions:()=>true});`);
await writeFile(toast, `export const TOAST_TYPE={SUCCESS:'success',ERROR:'error'}; export const setToast=()=>{};`);
await writeFile(
  ui,
  `
export { Input } from ${JSON.stringify(path.join(repo, "packages/ui/src/form-fields/input.tsx"))};
export { Button } from ${JSON.stringify(path.join(repo, "packages/ui/src/button/button.tsx"))};
export { ModalCore } from ${JSON.stringify(path.join(repo, "packages/ui/src/modals/modal-core.tsx"))};
export { EModalWidth } from ${JSON.stringify(path.join(repo, "packages/ui/src/modals/constants.ts"))};
`
);
await writeFile(
  service,
  `
let current = null;
export class RosterService {
  async getRegistration() { return current; }
  async generateRegistration() {
    current = { token: 'fixture', url: 'http://localhost:8000/auth/player-registration/?token=fixture', join_code: 'AB7D-2XY9',
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
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RegistrationQRModal } from ${JSON.stringify(path.join(web, "ce/features/roster/components/registration-qr-modal.tsx"))};
import { RosterApprovalButton } from ${JSON.stringify(path.join(web, "ce/features/roster/components/roster-approval-button.tsx"))};
import { RosterContext } from ${JSON.stringify(context)};
function Fixture() { const [open,setOpen]=useState(true); const [pending,setPending]=useState(true); const [coach,setCoach]=useState(true); return <>
<button onClick={()=>setOpen(true)}>Open registration</button>
<button onClick={()=>{setCoach(false);setPending(true);}}>View as athlete</button>
<RosterContext.Provider value={{workspaceSlug:'fixture-school',projectId:'fixture-program',canManage:coach,refetchRoster:async()=>setPending(false)}}>
  <span data-testid="approval">{pending?'Waiting for approval':'Linked'}</span>
  <RosterApprovalButton player={{id:'athlete',player_name:'Alex',registration_status:pending?'pending':null}}/>
</RosterContext.Provider>
{open && <RegistrationQRModal workspaceSlug="fixture-school" projectId="fixture-program" onClose={()=>setOpen(false)}/>}
</>; }
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
        builder.onResolve({ filter: /^@plane\/ui$/ }, () => ({ path: ui }));
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
      path.join(web, "ce/features/roster/components/registration-qr-modal.tsx"),
      path.join(web, "ce/features/roster/components/roster-approval-button.tsx"),
      path.join(repo, "packages/ui/src/modals/*.{ts,tsx}"),
      path.join(repo, "packages/ui/src/button/*.{ts,tsx}"),
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
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.error("Browser error:", error.message);
  });
  page.setDefaultTimeout(8000);
  await page.clock.install();
  const origin = "http://127.0.0.1:" + server.address().port;
  await browser.contexts()[0].grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  await page.goto(origin);
  await page.getByRole("button", { name: "Generate QR", exact: true }).click();
  await page.getByRole("button", { name: "Close registration", exact: true }).waitFor();
  assert.match(await page.getByRole("timer").innerText(), /Registration open/);
  assert.equal(await page.locator("svg title").filter({ hasText: "Scan to sign up" }).count(), 1);
  await page.getByText("AB7D-2XY9", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Copy", exact: true }).click();
  await page.getByRole("button", { name: "Copied", exact: true }).waitFor();
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    "http://localhost:8000/auth/player-registration/?token=fixture"
  );
  if (process.env.QR_SCREENSHOT) await page.screenshot({ path: process.env.QR_SCREENSHOT, fullPage: true });
  await page.getByRole("button", { name: "Show QR full screen", exact: true }).click();
  assert.equal(
    await page
      .locator("svg")
      .filter({ has: page.locator("title").filter({ hasText: "Scan to sign up" }) })
      .getAttribute("width"),
    "288"
  );
  await page.getByRole("button", { name: "Show QR details", exact: true }).click();
  await page.getByRole("button", { name: "Close QR window", exact: true }).click();
  await page.getByRole("button", { name: "Open registration", exact: true }).click();
  await page.getByRole("button", { name: "Close registration", exact: true }).waitFor();
  await page.clock.fastForward(901000);
  await page.getByText("This QR has expired.", { exact: false }).waitFor();
  assert.equal(await page.locator("svg title").filter({ hasText: "Scan to sign up" }).count(), 0);
  assert.equal(await page.getByText("AB7D-2XY9", { exact: true }).count(), 0);
  await page.getByRole("button", { name: "Generate QR", exact: true }).click();
  await page.getByRole("button", { name: "Close registration", exact: true }).click();
  await page.getByText("Registration is closed.", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Close QR window", exact: true }).click();
  await page.getByRole("button", { name: "Approve Alex", exact: true }).click();
  await page.getByTestId("approval").filter({ hasText: "Linked" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Approve Alex", exact: true }).count(), 0);
  await page.getByRole("button", { name: "View as athlete", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Approve Alex", exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  console.log("PASS: QR lifecycle, one-click approval/roster refresh, and athlete approval-button exclusion");
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
