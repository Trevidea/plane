import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const require = createRequire(path.join(web, "package.json"));
const { build } = require(process.env.ESBUILD_PACKAGE_PATH || "esbuild");
const mocks = {
  "fixture:state": `export const fixture = { items: [], requests: [], toasts: [], role: "admin", group: "started", transition: null, error: null };`,
  "mobx-react": "export const observer = component => component;",
  "next/navigation": "export const useParams = () => ({ workspaceSlug: 'team' });",
  "@plane/constants": `export const ARCHIVABLE_STATE_GROUPS = ['completed', 'cancelled']; export const EUserPermissions = { ADMIN: 'admin', MEMBER: 'member' }; export const EUserPermissionsLevel = { PROJECT: 'project' };`,
  "@plane/propel/toast": `import {fixture} from 'fixture:state'; export const TOAST_TYPE = { SUCCESS: 'success', ERROR: 'error' }; export const setToast = toast => fixture.toasts.push(toast);`,
  "@plane/propel/tooltip": `export const Tooltip = ({children}) => children;`,
  "@plane/ui": `import {createElement} from 'react'; import {fixture} from 'fixture:state';
    export const CustomMenu = ({children, ariaLabel, optionsClassName, useCaptureForOutsideClick}) => createElement('nav', {'aria-label': ariaLabel, className: optionsClassName, 'data-capture-outside-click': useCaptureForOutsideClick}, children);
    CustomMenu.MenuItem = ({children, disabled, onClick, className}) => createElement('button', {disabled, onClick, className}, children);
    export const ContextMenu = ({items}) => { fixture.items = items; return null; };
    export const ModalCore = ({children, isOpen}) => isOpen ? createElement('div', {role: 'dialog'}, children) : null;
    export const Button = ({children, onClick, disabled}) => createElement('button', {onClick, disabled}, children);
    export const EModalWidth = {LG: 'lg'};`,
  "@headlessui/react": `import {createElement} from 'react'; export const Dialog = {Title: ({children}) => createElement('h2', null, children)};`,
  "@plane/utils": `export const cn = (...values) => values.filter(Boolean).join(' '); export const isDateTimePast = () => false;`,
  "@/components/comments/comment-create": `export const CommentCreate = () => null;`,
  "@/hooks/store/use-project": `export const useProject = () => ({getProjectIdentifierById: () => 'FB'});`,
  "@/hooks/store/use-project-state": `import {fixture} from 'fixture:state'; export const useProjectState = () => ({getStateById: () => ({name: 'In Work', group: fixture.group})});`,
  "@/hooks/store/user": `import {fixture} from 'fixture:state'; export const useUserPermissions = () => ({allowPermissions: roles => roles.includes(fixture.role)});`,
  "@/hooks/use-issue-peek-overview-redirection": `import {fixture} from 'fixture:state'; export default () => ({handleRedirection: (slug, issue) => fixture.requests.push({kind: 'open', slug, id: issue.id})});`,
  "@/services/issue/issue.service": `import {fixture} from 'fixture:state'; export class IssueService {
    async updateCoachingCard(slug, project, id, data) { fixture.requests.push({kind: 'update', slug, project, id, data}); if(fixture.error) throw fixture.error; }
    async transitionCoachingCard(slug, project, id, stage, reason) { fixture.requests.push({kind: 'transition', slug, project, id, stage, reason}); if(fixture.error) throw fixture.error; }
  }`,
  "@/services/roster.service": `export class RosterService {}`,
  "@/components/issues/issue-detail/sg-event-detail-page/create-card-model": `export const getPositionGroups = () => [];`,
  "@/components/issues/issue-detail/sg-event-detail-page/create-card-roster-picker": `export const CreateCardRosterPicker = () => null;`,
  "../../archive-issue-modal": `export const ArchiveIssueModal = () => null;`,
  "../../delete-issue-modal": `export const DeleteIssueModal = () => null;`,
  "../../issue-detail/issue-activity/helper": `export const useCommentOperations = () => ({});`,
};
const bundle = await build({
  absWorkingDir: web,
  stdin: {
    resolveDir: web,
    contents: `export {fixture} from 'fixture:state';
      export {CoachingCardMenu} from './core/components/issues/issue-layouts/kanban/coaching-card-menu';
      export {CoachingCardActions} from './core/components/issues/issue-layouts/kanban/coaching-card-actions';
      export {CoachingCardStageContext} from './core/components/issues/issue-layouts/kanban/coaching-card-stage-context';
      export {CoachingCardStageRequestContext} from './core/components/issues/issue-layouts/kanban/coaching-card-stage-request-context';`,
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  jsx: "automatic",
  external: ["react", "react-dom", "react-dom/server"],
  plugins: [
    {
      name: "coaching-menu-boundaries",
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
const { fixture, CoachingCardMenu, CoachingCardActions, CoachingCardStageContext, CoachingCardStageRequestContext } =
  compiled.exports;
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const config = {
  sport: "Football",
  initial_stage_id: "s0",
  stages: ["Identified", "Assigned", "In Work", "Ready for Coach Review", "Resolved"].map((name, index) => ({
    id: `s${index}`,
    name,
    order: index,
    abbreviation: name[0],
    allowed_next_stage_ids: [index - 1, index + 1]
      .filter((other) => other >= 0 && other < 5 && !(index === 1 && other === 2))
      .map((other) => `s${other}`),
  })),
};
const issue = {
  id: "card",
  project_id: "program",
  sequence_id: 10,
  state_id: "s2",
  created_at: "2026-10-01",
  coaching_card_data: { priority: "Standard", recipient_ids: ["player"] },
};
const render = (patch = {}, props = {}, component = CoachingCardMenu) =>
  renderToStaticMarkup(
    createElement(
      CoachingCardStageContext.Provider,
      { value: config },
      createElement(
        CoachingCardStageRequestContext.Provider,
        { value: async (_issue, stageId) => (fixture.transition ? { ...fixture.transition, stageId } : null) },
        createElement(component, {
          issue: { ...issue, ...patch },
          parentRef: { current: null },
          handleDelete: async () => {},
          handleArchive: async () => {},
          workspaceSlug: "team",
          projectId: "program",
          config,
          onChanged: () => fixture.requests.push({ kind: "changed" }),
          ...props,
        })
      )
    )
  );
const item = (key) => fixture.items.find((value) => value.key === key);
const settled = () => new Promise((resolve) => setImmediate(resolve));

const withBoardEvents = async (run) => {
  const previous = Object.getOwnPropertyDescriptor(global, "window");
  const target = new EventTarget();
  target.addEventListener("coaching-card-updated", (event) =>
    fixture.requests.push({ kind: "changed", detail: event.detail })
  );
  Object.defineProperty(global, "window", { configurable: true, value: target });
  try {
    await run();
  } finally {
    if (previous) Object.defineProperty(global, "window", previous);
    else delete global.window;
  }
};

beforeEach(() =>
  Object.assign(fixture, {
    items: [],
    requests: [],
    toasts: [],
    role: "admin",
    group: "started",
    transition: null,
    error: null,
  })
);

test("rendered menu has grouped actions, inline icons and current stage header", () => {
  const markup = render();
  assert.match(markup, /Actions for FB-10/);
  assert.match(markup, /<nav[^>]*class="[^"]*bg-custom-background-90/);
  assert.match(markup, /data-capture-outside-click="true"/);
  assert.match(markup, /FB-10.*In Work/);
  assert.match(markup, />movement</);
  assert.match(markup, />lifecycle</);
  assert.match(markup, /Every transition is logged/);
  assert.deepEqual(
    fixture.items.map((value) => value.key),
    ["next", "open", "follow-up", "previous", "raise", "lower", "archive", "delete"]
  );
  assert.equal(item("next").disabled, false);
  assert.equal(item("previous").disabled, false);
});

test("Assigned's automatic menu action stays disabled but reopening remains available", () => {
  assert.match(render({ state_id: "s1" }), /Move to In Work/);
  assert.equal(item("next").disabled, true);
  assert.equal(item("previous").disabled, false);
});

test("read-only and non-coach users retain Open card but cannot mutate", () => {
  for (const props of [{ readOnly: true }, {}]) {
    if (!props.readOnly) fixture.role = "guest";
    render({}, props);
    for (const action of fixture.items.filter((value) => value.key !== "open"))
      assert.equal(action.disabled, true, action.key);
    item("open").action();
    assert.deepEqual(fixture.requests.at(-1), { kind: "open", slug: "team", id: "card" });
  }
});

test("Delete is admin-only in this menu and Archive respects server state groups", () => {
  fixture.role = "member";
  render();
  assert.equal(item("delete").disabled, true);
  assert.equal(item("archive").disabled, true);
  fixture.role = "admin";
  fixture.group = "completed";
  render({ state_id: "s4" });
  assert.equal(item("delete").disabled, false);
  assert.equal(item("archive").disabled, false);
  assert.equal(item("next"), undefined);
});

test("priority limits disable the corresponding menu item", () => {
  render({ coaching_card_data: { priority: "Game Plan Critical" } });
  assert.equal(item("raise").disabled, true);
  assert.equal(item("lower").disabled, false);
  render({ coaching_card_data: { priority: "Developmental" } });
  assert.equal(item("raise").disabled, false);
  assert.equal(item("lower").disabled, true);
});

test("priority action updates coaching metadata, not generic issue priority", async () => {
  fixture.error = new Error("Synthetic rejection");
  render();
  item("raise").action();
  await settled();
  assert.deepEqual(fixture.requests, [
    { kind: "update", slug: "team", project: "program", id: "card", data: { priority: "Game Plan Critical" } },
  ]);
  assert.equal(fixture.toasts.at(-1).title, "Priority update failed");
});

test("successful priority updates notify the existing board refresh lifecycle", async () => {
  await withBoardEvents(async () => {
    render();
    item("lower").action();
    await settled();
    assert.deepEqual(fixture.requests, [
      { kind: "update", slug: "team", project: "program", id: "card", data: { priority: "Developmental" } },
      { kind: "changed", detail: { projectId: "program" } },
    ]);
    assert.equal(fixture.toasts.at(-1).title, "Priority updated");
  });
});

test("cancelled assignment/reopen does not submit a transition", async () => {
  render();
  item("previous").action();
  await settled();
  assert.deepEqual(fixture.requests, []);
});

test("shared stage action forwards the reopen reason and prevents duplicate submissions", async () => {
  fixture.transition = { reason: "Needs more practice" };
  fixture.error = new Error("Synthetic rejection");
  render();
  item("previous").action();
  item("previous").action();
  await settled();
  assert.deepEqual(fixture.requests, [
    { kind: "transition", slug: "team", project: "program", id: "card", stage: "s1", reason: "Needs more practice" },
  ]);
  assert.equal(fixture.toasts.at(-1).title, "Stage change failed");
});

test("successful next-stage actions use the existing transition API and board refresh event", async () => {
  await withBoardEvents(async () => {
    fixture.transition = {};
    render();
    item("next").action();
    await settled();
    assert.deepEqual(fixture.requests, [
      { kind: "transition", slug: "team", project: "program", id: "card", stage: "s3", reason: undefined },
      { kind: "changed", detail: { projectId: "program" } },
    ]);
    assert.equal(fixture.toasts.at(-1).title, "Moved to Ready for Coach Review");
  });
});

test("footer retains the next action but has no Choose stage button or Move card dialog", () => {
  const markup = render({}, {}, CoachingCardActions);
  assert.match(markup, /Next: Ready for Coach Review/);
  assert.doesNotMatch(markup, /Choose coaching card stage|Choose stage|Move card|ListFilter/);
});

test("first-stage cards have no footer action with or without recipients", () => {
  for (const recipient_ids of [[], ["player"]]) {
    const markup = render(
      { state_id: "s0", coaching_card_data: { ...issue.coaching_card_data, recipient_ids } },
      {},
      CoachingCardActions
    );
    assert.equal(markup, "");
  }
});

test("first-stage footer visibility follows configured stage identity rather than its name", () => {
  const renamedConfig = {
    ...config,
    stages: config.stages.map((stage) => (stage.id === "s0" ? { ...stage, name: "Film Tagged" } : stage)),
  };
  assert.equal(render({ state_id: "s0" }, { config: renamedConfig }, CoachingCardActions), "");
});

test("first-stage assignment remains available in the card menu", () => {
  const markup = render({ state_id: "s0" });
  assert.match(markup, /Assign to Player/);
  assert.equal(item("next").disabled, false);
  assert.equal(item("previous"), undefined);
  assert.doesNotMatch(markup, /Move back to/);
});

test("last-stage menus omit No next stage while retaining the previous-stage action", () => {
  const markup = render({ state_id: "s4" });
  assert.equal(item("next"), undefined);
  assert.equal(item("previous").disabled, false);
  assert.match(markup, /Move back to Ready for Coach Review/);
  assert.doesNotMatch(markup, /No next stage/);
});

test("unknown stages omit both unavailable transition placeholders", () => {
  const markup = render({ state_id: "unknown" });
  assert.equal(item("next"), undefined);
  assert.equal(item("previous"), undefined);
  assert.doesNotMatch(markup, /No next stage|Stage unavailable|Move back to -/);
  assert.ok(item("open"));
});
