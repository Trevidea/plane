import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const require = createRequire(path.join(web, "package.json"));
const { build } = require(process.env.ESBUILD_PACKAGE_PATH || "esbuild");
const mocks = {
  fixture: "export const fixture={states:[]};",
  "@plane/constants": "export const STATE_GROUPS={backlog:{},unstarted:{},started:{},completed:{},cancelled:{}};",
  "@plane/utils": "export const sortStates=states=>states;",
  "@/local-db/utils/load-workspace": "export const syncIssuesWithDeletedStates=()=>{};",
  "@/plane-web/services/project/project-state.service":
    "import {fixture} from 'fixture'; export class ProjectStateService {async getStates(){return fixture.states;}}",
};
const result = await build({
  absWorkingDir: web,
  stdin: {
    resolveDir: web,
    contents: "export {StateStore} from './core/store/state.store'; export {fixture} from 'fixture';",
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  external: ["mobx", "mobx-utils", "lodash-es"],
  plugins: [
    {
      name: "fixtures",
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) =>
          mocks[args.path] ? { path: args.path, namespace: "fixture" } : undefined
        );
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          contents: mocks[args.path],
          loader: "js",
        }));
      },
    },
  ],
});
const compiled = { exports: {} };
new Function("module", "exports", "require", result.outputFiles[0].text)(compiled, compiled.exports, require);
const { StateStore, fixture } = compiled.exports;

test("a project refresh removes deleted state IDs while retaining other programs", async () => {
  const store = new StateStore({ router: { workspaceSlug: "team", projectId: "program" } });
  store.stateMap = {
    old: { id: "old", name: "Deleted intake", project_id: "program" },
    other: { id: "other", name: "Other program", project_id: "other" },
  };
  fixture.states = [
    { id: "initial", name: "First state", project_id: "program", group: "backlog", sequence: 1, default: true },
  ];
  await store.fetchProjectStates("team", "program");
  assert.equal(store.getStateById("old"), undefined);
  assert.equal(store.getStateById("other").name, "Other program");
  assert.deepEqual(
    store.getProjectStates("program").map((state) => state.id),
    ["initial"]
  );
});

test("an empty API state list clears deleted local labels", async () => {
  const store = new StateStore({ router: { workspaceSlug: "team", projectId: "program" } });
  store.stateMap = { old: { id: "old", name: "Deleted intake", project_id: "program" } };
  fixture.states = [];
  await store.fetchProjectStates("team", "program");
  assert.deepEqual(store.getProjectStates("program"), []);
});
