import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const require = createRequire(import.meta.url);
const { build } = require(process.env.ESBUILD_PACKAGE_PATH || "esbuild");
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE_PATH || "playwright");
const programId = "11111111-1111-4111-8111-111111111111";
const components = new Map([
  ["@/hooks/store/user", `export const useUser = () => ({data: {id: 'coach'}});`],
  [
    "next/link",
    `import React from 'react'; export default ({children,...props}) => React.createElement('a',props,children);`,
  ],
  [
    "@/services/roster.service",
    `
    let readAt = null;
    export class RosterService {
      async staffNotices(workspace) {
        if (workspace !== 'school') return {total_count: 0, unread_count: 0, results: []};
        return {total_count: 1, unread_count: readAt ? 0 : 1, results: [{id: 'notice',
          program_id: '${programId}', program_name: 'Varsity', created_at: '2026-11-26T00:00:00Z', read_at: readAt}]};
      }
      async markStaffNoticeRead(workspace, id) {
        if (workspace !== 'school' || id !== 'notice') throw new Error('Incorrect notice');
        readAt = '2026-11-26T01:00:00Z';
      }
    }
  `,
  ],
]);
const output = await build({
  stdin: {
    contents: `import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {RosterNotices} from './core/components/workspace-notifications/sidebar/roster-notices.tsx';
      createRoot(document.getElementById('root')).render(<RosterNotices workspace="school" />);`,
    resolveDir: web,
    loader: "tsx",
  },
  bundle: true,
  platform: "browser",
  define: { "process.env.NODE_ENV": '"test"' },
  jsx: "automatic",
  write: false,
  plugins: [
    {
      name: "fixtures",
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, ({ path }) =>
          components.has(path) ? { path, namespace: "fixture" } : undefined
        );
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
          contents: components.get(path),
          resolveDir: web,
        }));
      },
    },
  ],
});

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.setContent('<main id="root"></main>');
  await page.addScriptTag({ content: output.outputFiles[0].text });
  await page.getByText("1 unread", { exact: true }).waitFor();
  await page.locator("summary").click();
  const notice = page.getByRole("link", { name: "Join request: Varsity" });
  assert.equal(await notice.getAttribute("href"), `/school/projects/${programId}/roster/?view=join-requests`);
  await page.getByRole("button", { name: "Mark Varsity notice as read" }).click();
  await page.getByText("Read", { exact: false }).filter({ hasText: "· Read" }).waitFor();
  assert.equal(await page.getByText("1 unread", { exact: true }).count(), 0);
  console.log("PASS: roster inbox updates, safe roster link, and read state refresh.");
} finally {
  await browser.close();
}
