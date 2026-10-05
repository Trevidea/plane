import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const require = createRequire(path.join(web, "package.json"));
const { build } = require(process.env.ESBUILD_PACKAGE_PATH || "esbuild");
const mocks = {
  "@/lib/store-context": "export const store = {};",
  "@/local-db/utils/query-constructor": "export const SPECIAL_ORDER_BY = {};",
  "@/local-db/utils/utils": "export const updatePersistentLayer = () => {};",
  "@/plane-web/store/issue/helpers/base-issue.store": "export const workItemSortWithOrderByExtended = () => [];",
  "@/services/issue": "export class IssueService {} export class IssueArchiveService {}",
  "@/services/cycle.service": "export class CycleService {}",
  "@/services/module.service": "export class ModuleService {}",
  "@plane/utils": `
    export const convertToISODateString = value => value || "";
    export const isDateTimePast = () => false;
    export const checkDateCriteria = () => true;
    export const parseDateFilter = () => ({});
  `,
};
const bundle = await build({
  absWorkingDir: web,
  stdin: {
    resolveDir: web,
    contents: 'export { ProjectIssues } from "./core/store/issue/project/issue.store"; export { autorun } from "mobx";',
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  plugins: [
    {
      name: "mock-project-boundaries",
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) =>
          mocks[args.path] ? { path: args.path, namespace: "mock" } : undefined
        );
        builder.onLoad({ filter: /.*/, namespace: "mock" }, (args) => ({ contents: mocks[args.path], loader: "js" }));
      },
    },
  ],
});
const compiledStore = { exports: {} };
new Function("module", "exports", "require", bundle.outputFiles[0].text)(compiledStore, compiledStore.exports, require);
const { ProjectIssues, autorun } = compiledStore.exports;

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((success, failure) => {
    resolve = success;
    reject = failure;
  });
  return { promise, resolve, reject };
};

const setup = () => {
  const cards = {
    card: { id: "card", project_id: "project", state_id: "old", sort_order: 100, created_at: "2026-10-01" },
    other: { id: "other", project_id: "project", state_id: "next", sort_order: 200, created_at: "2026-10-01" },
  };
  const root = {
    rootStore: {
      router: {},
      user: { localDBEnabled: false },
      projectRoot: { project: { fetchProjectDetails: async () => {} } },
    },
    projectMap: { project: { sport: "Football" } },
    issues: {
      getIssueById: (id) => cards[id],
      getIssuesByIds: (ids) => ids.map((id) => cards[id]),
      updateIssue: (id, values) => Object.assign(cards[id], values),
      addIssue: (items) => items.forEach((item) => (cards[item.id] = item)),
    },
    issueDetail: { relation: { extractRelationsFromIssues: () => {} } },
  };
  const filters = {
    issueFilters: { displayFilters: { layout: "kanban", group_by: "state", order_by: "sort_order" } },
    getFilterParams: () => ({ layout: "kanban" }),
  };
  const store = new ProjectIssues(root, filters);
  store.groupedIssueIds = { old: ["card"], next: ["other"] };
  store.groupedIssueCount = { old: 1, next: 1 };
  store.paginationOptions = { canGroup: true, perPageCount: 30 };
  const api = deferred();
  const calls = [];
  store.issueService.transitionCoachingCard = (...args) => {
    calls.push(args);
    return api.promise;
  };
  store.issueService.patchIssue = async (...args) => calls.push(args);
  return { store, cards, api, calls };
};

test("a dropped card moves immediately and keeps its requested ordering", async () => {
  const { store, cards, api, calls } = setup();
  const pending = store.transitionCoachingCard("school", "project", "card", "next", 150);
  assert.equal(cards.card.state_id, "next");
  assert.deepEqual([...store.getIssueIds("old")], []);
  assert.deepEqual([...store.getIssueIds("next")], ["card", "other"]);
  assert.equal(store.getGroupIssueCount("old", undefined, false), 0);
  assert.equal(store.getGroupIssueCount("next", undefined, false), 2);
  assert.notEqual(store.getIssueLoader(), "init-loader");
  api.resolve();
  await pending;
  assert.equal(cards.card.sort_order, 150);
  assert.deepEqual(calls, [
    ["school", "project", "card", "next"],
    ["school", "project", "card", { sort_order: 150 }],
  ]);
});

test("a rejected transition rolls back the card and column counts", async () => {
  const { store, cards, api } = setup();
  const pending = store.transitionCoachingCard("school", "project", "card", "next", 150);
  api.reject(new Error("Permission denied"));
  await assert.rejects(pending, /Permission denied/);
  assert.equal(cards.card.state_id, "old");
  assert.equal(cards.card.sort_order, 100);
  assert.deepEqual([...store.getIssueIds("old")], ["card"]);
  assert.deepEqual([...store.getIssueIds("next")], ["other"]);
  assert.equal(store.getGroupIssueCount("old", undefined, false), 1);
  assert.equal(store.getGroupIssueCount("next", undefined, false), 1);
});

test("a failed reorder does not undo an already committed stage", async () => {
  const { store, cards, api } = setup();
  store.issueService.patchIssue = async () => {
    throw new Error("Reorder failed");
  };
  const pending = store.transitionCoachingCard("school", "project", "card", "next", 150);
  api.resolve();
  await assert.rejects(pending, /Reorder failed/);
  assert.equal(cards.card.state_id, "next");
  assert.equal(cards.card.sort_order, 100);
  assert.deepEqual([...store.getIssueIds("next")], ["card", "other"]);
});

test("background refresh keeps the board mounted and preserves cards on failure", async () => {
  const { store } = setup();
  const request = deferred();
  store.issueService.getIssues = () => request.promise;
  const pending = store.fetchIssuesWithExistingPagination("school", "project", "mutation");
  assert.equal(store.getIssueLoader(), "mutation");
  assert.deepEqual([...store.getIssueIds("old")], ["card"]);
  assert.equal(store.getGroupIssueCount("old", undefined, false), 1);
  assert.equal(store.paginationOptions.perPageCount, 30);
  request.reject(new Error("Network unavailable"));
  await assert.rejects(pending, /Network unavailable/);
  assert.deepEqual([...store.getIssueIds("old")], ["card"]);
  assert.equal(store.getIssueLoader(), undefined);
});

test("successful background refresh reconciles column contents without an initial loader", async () => {
  const { store, cards } = setup();
  const states = [];
  const dispose = autorun(() => {
    states.push({ empty: store.groupedIssueIds === undefined, loader: store.getIssueLoader() });
  });
  const request = deferred();
  store.issueService.getIssues = () => request.promise;
  const pending = store.fetchIssuesWithExistingPagination("school", "project", "mutation");
  assert.deepEqual([...store.getIssueIds("old")], ["card"]);
  request.resolve({
    total_count: 2,
    results: {
      old: { results: [], total_results: 0 },
      next: { results: [{ ...cards.card, state_id: "next" }, cards.other], total_results: 2 },
    },
  });
  await pending;
  assert.deepEqual([...store.getIssueIds("old")], []);
  assert.deepEqual([...store.getIssueIds("next")], ["card", "other"]);
  assert.equal(cards.card.state_id, "next");
  assert.equal(store.getIssueLoader(), undefined);
  dispose();
  assert.equal(
    states.some((state) => state.empty || state.loader === "init-loader"),
    false
  );
});

test("initial loads still clear stale cards and show the initial loader", async () => {
  const { store } = setup();
  const request = deferred();
  store.issueService.getIssues = () => request.promise;
  const pending = store.fetchIssues("school", "project", "init-loader", { canGroup: true, perPageCount: 30 });
  assert.equal(store.getIssueLoader(), "init-loader");
  assert.equal(store.groupedIssueIds, undefined);
  request.reject(new Error("Offline"));
  await assert.rejects(pending, /Offline/);
});
