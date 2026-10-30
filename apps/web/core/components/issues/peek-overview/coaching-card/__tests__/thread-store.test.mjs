import assert from "node:assert/strict";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const root = path.resolve(web, "../..");
const require = createRequire(path.join(web, "package.json"));
const packages = await readdir(path.join(root, "node_modules/.pnpm"));
const esbuildPath = packages.find((name) => /^esbuild@/.test(name));
const { build } = require(process.env.ESBUILD_PACKAGE_PATH || path.join(root, "node_modules/.pnpm", esbuildPath, "node_modules/esbuild"));
const temp = await mkdtemp(path.join(tmpdir(), "thread-store-"));
await writeFile(path.join(temp, "service.ts"), `
export class IssueCommentService {
  async getIssueComments(w, p, i, params) {
    globalThis.threadRequests.push(params);
    return globalThis.threadResponse;
  }
}
`);
await build({
  entryPoints: [path.join(web, "core/store/issue/issue-details/comment.store.ts")],
  outfile: path.join(temp, "store.mjs"), bundle: true, platform: "node", format: "esm",
  alias: { "@/services/issue": path.join(temp, "service.ts") },
  nodePaths: [path.join(web, "node_modules"), path.join(root, "node_modules")],
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
});
const { IssueCommentStore } = await import(pathToFileURL(path.join(temp, "store.mjs")).href);
const store = new IssueCommentStore({ commentReaction: { applyCommentReactions() {} } }, "ISSUES");
const comment = (id, html) => ({ id, comment_html: html, created_at: "2026-10-30T10:00:00Z", comment_reactions: [] });
globalThis.threadRequests = [];
globalThis.threadResponse = [comment("coach", "Original"), comment("player", "Delete me")];
await store.fetchComments("school", "program", "card");
globalThis.threadResponse = [comment("coach", "Edited reply")];
await store.fetchComments("school", "program", "card", "mutate");
assert.deepEqual(globalThis.threadRequests[1], {}, "refresh must fetch edits and deletions, not only newer comments");
assert.deepEqual(Array.from(store.getCommentsByIssueId("card")), ["coach"], "deleted player message must disappear");
assert.equal(store.getCommentById("coach").comment_html, "Edited reply");
globalThis.threadResponse = [comment("new-player", "New reply")];
await store.fetchComments("school", "program", "card");
assert.ok(globalThis.threadRequests[2].created_at__gt, "normal fetch keeps incremental behavior");
assert.deepEqual(Array.from(store.getCommentsByIssueId("card")), ["coach", "new-player"]);
console.log("Thread store: refresh reconciles edits/deletions; normal fetch stays incremental.");
