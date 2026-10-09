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
const temp = await mkdtemp(path.join(tmpdir(), "attachment-browser-"));
let bundle;
let checkedCredentials = false;
const server = createServer((req, res) => {
  if (req.url.startsWith("/api/asset/")) {
    checkedCredentials = req.headers.cookie?.includes("attachment-session=test") ?? false;
    const failed = req.url.includes("failed");
    res.writeHead(failed ? 400 : 200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify(failed ? { error: "The asset is not uploaded.", status: false } : { url: `${origin}/file` })
    );
  } else if (req.url === "/file") {
    res.writeHead(200, { "Content-Type": "text/html" }).end("Attachment opened");
  } else {
    res
      .writeHead(200, { "Content-Type": "text/html" })
      .end(`<div id="root"></div><div id="toast"></div><script>${bundle}</script>`);
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const mocks = {
  "mobx-react": "export const observer = c => c;",
  "@plane/i18n": "export const useTranslation = () => ({ t: key => key });",
  "@plane/propel/toast":
    "export const TOAST_TYPE = { ERROR: 'error' }; export const setToast = t => document.getElementById('toast').textContent = t.message;",
  "@plane/propel/tooltip": "export const Tooltip = ({children}) => children;",
  "@plane/ui": "export const CustomMenu = () => null; CustomMenu.MenuItem = () => null;",
  "@/components/dropdowns/member/avatar": "export const ButtonAvatars = () => null;",
  "@/components/icons": "export const getFileIcon = () => null;",
  "@/hooks/store/use-member": "export const useMember = () => ({getUserDetails: () => null});",
  "@/hooks/use-platform-os": "export const usePlatformOS = () => ({isMobile: false});",
  "@/hooks/store/use-issue-detail": `export const useIssueDetail = () => ({ attachment: { getAttachmentById: id => ({ id, attributes: {name: id + '.mp4', size: 10}, asset_url: '/api/asset/' + id + '/', updated_at: '2026-10-01', created_by: null }) }, toggleDeleteAttachmentModal: () => {} });`,
};
await writeFile(
  path.join(temp, "fixture.tsx"),
  `
import {createRoot} from 'react-dom/client';
import {IssueAttachmentsListItem} from ${JSON.stringify(path.join(web, "core/components/issues/attachment/attachment-list-item"))};
createRoot(document.getElementById('root')).render(<><IssueAttachmentsListItem attachmentId="failed" /><IssueAttachmentsListItem attachmentId="completed" /></>);
`
);

let browser;
try {
  const result = await build({
    absWorkingDir: web,
    entryPoints: [path.join(temp, "fixture.tsx")],
    bundle: true,
    write: false,
    jsx: "automatic",
    nodePaths: [path.join(web, "node_modules"), path.resolve(web, "../../node_modules")],
    define: {
      "process.env.NEXT_PUBLIC_API_BASE_URL": JSON.stringify(origin),
      "process.env.NODE_ENV": '"development"',
      "process.env": "{}",
    },
    plugins: [
      {
        name: "fixture-store",
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, (args) =>
            args.path in mocks ? { path: args.path, namespace: "fixture" } : undefined
          );
          builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
            contents: mocks[args.path],
            loader: "js",
          }));
        },
      },
    ],
  });
  bundle = result.outputFiles[0].text;
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext();
  await context.addCookies([{ name: "attachment-session", value: "test", url: origin }]);
  const page = await context.newPage();
  await page.goto(origin);
  const failedPopup = page.waitForEvent("popup");
  await page.getByRole("button", { name: /failed.mp4/ }).click();
  const failedTab = await failedPopup;
  await page.locator("#toast").filter({ hasText: "Please upload the file again" }).waitFor();
  assert.equal(failedTab.isClosed(), true);
  assert.equal(checkedCredentials, true);
  const completedPopup = page.waitForEvent("popup");
  await page.getByRole("button", { name: /completed.mp4/ }).click();
  const completedTab = await completedPopup;
  await completedTab.waitForURL(`${origin}/file`);
  assert.equal(await completedTab.evaluate(() => window.opener), null);
  assert.equal(checkedCredentials, true);
  console.log(
    "PASS: failed uploads show an in-app error; completed attachments open the resolved file with credentials"
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
