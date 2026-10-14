import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const require = createRequire(path.join(web, "package.json"));
const ts = require("typescript");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const fixture = { isLoading: true, states: [] };
const groups = ["backlog", "unstarted", "started", "completed", "cancelled"];
const callbacks = Object.fromEntries(
  ["fetchProjectStates", "createState", "moveStatePosition", "updateState", "deleteState", "markStateAsDefault"].map(
    (name) => [name, async () => {}]
  )
);
const modules = {};
const mocks = {
  "mobx-react": { observer: (component) => component },
  swr: () => ({ isLoading: fixture.isLoading }),
  "@plane/constants": {
    EUserPermissionsLevel: { PROJECT: "project" },
    EIconSize: { XL: "xl" },
    STATE_GROUPS: Object.fromEntries(groups.map((group) => [group, { label: group }])),
  },
  "@plane/types": { EUserProjectRoles: { ADMIN: 20 } },
  "lucide-react": { Pencil: () => null },
  "@plane/propel/icons": { StateGroupIcon: () => null },
  "@/hooks/store/user": { useUserPermissions: () => ({ allowPermissions: () => true }) },
  "@/hooks/store/use-project-state": {
    useProjectState: () => ({
      ...callbacks,
      groupedProjectStates: Object.fromEntries(
        groups.map((group) => [group, fixture.states.filter((state) => state.group === group)])
      ),
    }),
  },
  "./state-item": { StateItem: ({ state }) => createElement("div", { "data-state": state.id }, state.name) },
  "./create-update/create": { StateCreate: () => null },
};
const load = (file) => {
  if (modules[file]) return modules[file];
  const source = ts.transpileModule(readFileSync(path.join(web, file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const compiled = { exports: {} };
  const dependencies = (name) => {
    if (mocks[name]) return mocks[name];
    if (name === "@/helpers/program-states") return load("helpers/program-states.ts");
    if (name === "@/components/project-states")
      return {
        ProjectStateLoader: () => createElement("div", { "data-loading": true }, "Loading states"),
        ...load("core/components/project-states/lifecycle-state-list.tsx"),
      };
    return require(name);
  };
  new Function("module", "exports", "require", source)(compiled, compiled.exports, dependencies);
  modules[file] = compiled.exports;
  return compiled.exports;
};
const { ProjectStateRoot } = load("core/components/project-states/root.tsx");
const render = () =>
  renderToStaticMarkup(createElement(ProjectStateRoot, { workspaceSlug: "sport-work", projectId: "cricket" }));

test("settings show a loader while fetching instead of five unconfigured state placeholders", () => {
  fixture.isLoading = true;
  fixture.states = [];
  const markup = render();
  assert.match(markup, /data-loading/);
  assert.doesNotMatch(markup, /Set up .* state/);
});

test("settings render all six persisted roles from the empty-program migration", () => {
  fixture.isLoading = false;
  const names = ["Identify", "To Review", "Action Required", "In Progress", "Verified", "Closed"];
  const roles = ["identified", "assigned", "reviewed", "practice", "verified", "closed"];
  const stateGroups = ["backlog", "unstarted", "started", "started", "completed", "cancelled"];
  fixture.states = names.map((name, index) => ({
    id: roles[index],
    name,
    lifecycle_role: roles[index],
    group: stateGroups[index],
    sequence: index,
  }));
  const markup = render();
  assert.deepEqual(
    [...markup.matchAll(/data-state="[^"]+">([^<]+)</g)].map((match) => match[1]),
    names
  );
  assert.doesNotMatch(markup, /data-loading/);
});
