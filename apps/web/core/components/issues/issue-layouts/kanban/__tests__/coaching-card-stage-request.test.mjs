import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { after, afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const require = createRequire(path.join(web, "package.json"));
const { build } = require(process.env.ESBUILD_PACKAGE_PATH || "esbuild");
const { JSDOM } = require(process.env.JSDOM_PACKAGE_PATH || "jsdom");
const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost/" });
const previousGlobals = new Map();
for (const name of ["window", "document", "navigator", "HTMLElement", "Event", "KeyboardEvent"]) {
  previousGlobals.set(name, Object.getOwnPropertyDescriptor(global, name));
  Object.defineProperty(global, name, { configurable: true, writable: true, value: dom.window[name] });
}
previousGlobals.set("IS_REACT_ACT_ENVIRONMENT", Object.getOwnPropertyDescriptor(global, "IS_REACT_ACT_ENVIRONMENT"));
global.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = {
  "@plane/propel/toast": "export const TOAST_TYPE = {WARNING: 'warning'}; export const setToast = () => {};",
  "@plane/ui": `import {createElement} from 'react';
    export const EModalWidth = {MD: 'md'};
    export const ModalCore = ({children, isOpen, handleClose}) => isOpen ? createElement('div', {
      role: 'dialog', onKeyDown: event => {if(event.key === 'Escape') handleClose();}
    }, children) : null;
    export const Button = ({children, variant, size, ...props}) => createElement('button', props, children);`,
  "@headlessui/react": `import {createElement} from 'react'; export const Dialog = {
    Title: ({children}) => createElement('h2', null, children),
    Description: ({children}) => createElement('p', null, children)
  };`,
  "./coaching-card-actions": "export const AssignmentDialog = () => null;",
};
const bundle = await build({
  absWorkingDir: web,
  stdin: {
    resolveDir: web,
    contents:
      "export {useCoachingCardStageRequest} from './core/components/issues/issue-layouts/kanban/use-coaching-card-stage-request';",
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  jsx: "automatic",
  external: ["react", "react/jsx-runtime"],
  plugins: [
    {
      name: "stage-request-boundaries",
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, ({ path: specifier }) =>
          mocks[specifier] ? { path: specifier, namespace: "fixture" } : undefined
        );
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path: specifier }) => ({
          contents: mocks[specifier],
          loader: "js",
        }));
      },
    },
  ],
});
const compiled = { exports: {} };
new Function("module", "exports", "require", bundle.outputFiles[0].text)(compiled, compiled.exports, require);
const { useCoachingCardStageRequest } = compiled.exports;
const { act, createElement } = require("react");
const { createRoot } = require("react-dom/client");
const config = {
  sport: "Football",
  initial_stage_id: "s0",
  stages: ["Identified", "Assigned", "In Work", "Ready for Coach Review", "Resolved"].map((name, index) => ({
    id: `s${index}`,
    name,
    order: index,
    allowed_next_stage_ids: [index - 1, index + 1]
      .filter((other) => other >= 0 && other < 5 && !(index === 1 && other === 2))
      .map((other) => `s${other}`),
  })),
};
const assigned = {
  id: "card",
  name: "Pass protection",
  sequence_id: 10,
  state_id: "s1",
  roster_player_id: "a",
  coaching_card_data: {
    recipient_ids: ["a", "b"],
    recipients: [{ id: "a" }, { id: "b" }],
    player: { id: "a" },
  },
};
const container = document.getElementById("root");
let root;
let requestStageChange;
const Fixture = () => {
  const controller = useCoachingCardStageRequest(config, "team", "program", () => {}, "FB");
  requestStageChange = controller.requestStageChange;
  return controller.dialogs;
};
const mount = async () => {
  root = createRoot(container);
  await act(async () => root.render(createElement(Fixture)));
};
const request = async (issue = assigned, stageId = "s0") => {
  let result;
  await act(async () => {
    result = requestStageChange(issue, stageId);
  });
  return { result };
};
const click = async (label) => {
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent === label);
  assert.ok(button, `Button not found: ${label}`);
  await act(async () => button.click());
};
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = undefined;
});
after(() => {
  dom.window.close();
  for (const [name, descriptor] of previousGlobals) {
    if (descriptor) Object.defineProperty(global, name, descriptor);
    else delete global[name];
  }
});

test("Assigned to Identified waits for confirmation and counts unique players", async () => {
  await mount();
  const before = structuredClone(assigned);
  const { result } = await request();
  let settled = false;
  void result.then(() => (settled = true));
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(container.querySelector("h2").textContent, "Move card back to Identified?");
  assert.equal(
    container.querySelector("p").textContent.replace(/\s+/g, " "),
    "This card is currently assigned to 2 players. Cards in Identified cannot have assigned players. Moving this card will remove those player assignments."
  );
  assert.equal(container.querySelector("textarea"), null);
  assert.deepEqual(assigned, before);
  await click("Move & Unassign Players");
  assert.deepEqual(await result, { stageId: "s0", reason: "Moved back to Identified and unassigned all players." });
  assert.equal(container.querySelector("[role=dialog]"), null);
});

test("Cancel leaves stage and assignments unchanged and permits another request", async () => {
  await mount();
  const before = structuredClone(assigned);
  const { result } = await request();
  await click("Cancel");
  assert.equal(await result, null);
  assert.deepEqual(assigned, before);
  const retried = await request();
  assert.ok(container.querySelector("[role=dialog]"));
  await click("Cancel");
  assert.equal(await retried.result, null);
});

test("dismissing or unmounting the dialog aborts the stage request", async () => {
  await mount();
  const first = await request();
  await act(async () =>
    container
      .querySelector("[role=dialog]")
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
  );
  assert.equal(await first.result, null);
  const second = await request();
  await act(async () => root.unmount());
  root = undefined;
  assert.equal(await second.result, null);
});

test("legacy roster/player assignments still show the unassignment confirmation", async () => {
  await mount();
  for (const patch of [
    { roster_player_id: "legacy", coaching_card_data: {} },
    { roster_player_id: null, coaching_card_data: { player: { id: "legacy" } } },
    { roster_player_id: null, coaching_card_data: { recipients: [{ id: "legacy" }] } },
  ]) {
    const { result } = await request({ ...assigned, ...patch });
    assert.match(container.querySelector("p").textContent, /assigned to 1 player\./);
    await click("Cancel");
    assert.equal(await result, null);
  }
});

test("position-group recipients are included in the confirmation count", async () => {
  await mount();
  const { result } = await request({
    ...assigned,
    roster_player_id: null,
    position_group: "Guard",
    coaching_card_data: { position_group: "Guard", recipient_ids: ["a", "b", "c"] },
  });
  assert.match(container.querySelector("p").textContent, /assigned to 3 players\./);
  await click("Cancel");
  assert.equal(await result, null);
});

test("later backward drops preserve the existing one-stage reopen and reason dialog", async () => {
  await mount();
  const { result } = await request({ ...assigned, state_id: "s3" }, "s0");
  assert.equal(container.querySelector("h2").textContent, "Reopen FB-10");
  assert.match(container.querySelector("p").textContent, /Move back to In Work/);
  assert.ok(container.querySelector("textarea[required]"));
  assert.equal([...container.querySelectorAll("button")].find((item) => item.textContent === "Reopen").disabled, true);
  await click("Cancel");
  assert.equal(await result, null);
});

test("a second request cannot replace an open unassignment confirmation", async () => {
  await mount();
  const first = await request();
  assert.equal(await requestStageChange({ ...assigned, id: "other" }, "s0"), null);
  assert.equal(container.querySelectorAll("[role=dialog]").length, 1);
  await click("Move & Unassign Players");
  assert.equal((await first.result).stageId, "s0");
});
