/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { createRequire } = require("node:module");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const webRequire = createRequire(path.resolve(__dirname, "../../package.json"));
const ts = webRequire("typescript");
const roles = { ADMIN: 20, MEMBER: 15, GUEST: 5, USER: 1 };
function load(relative, overrides = {}) {
  const source = ts.transpileModule(
    fs.readFileSync(path.resolve(__dirname, relative), "utf8").replaceAll("import.meta.url", '"file:///test.ts"'),
    {
      fileName: relative,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }
  ).outputText;
  const compiledModule = { exports: {} };
  const require = (name) => {
    if (name in overrides) return overrides[name];
    if (name.startsWith("./utils/")) return {};
    if (name === "mobx") return { makeObservable() {}, action: () => {}, observable: { ref: null }, computed: null };
    if (name === "mobx-utils") return { computedFn: (fn) => fn };
    if (name === "@plane/constants")
      return {
        EUserPermissions: roles,
        EPageAccess: { PUBLIC: 0 },
        EUserPermissionsLevel: { WORKSPACE: "WORKSPACE", PROJECT: "PROJECT" },
        WORKSPACE_SIDEBAR_DYNAMIC_NAVIGATION_ITEMS_LINKS: [],
      };
    if (name === "@plane/types") return { EUserWorkspaceRoles: roles };
    if (name === "@/helpers/user-readonly") return load("../user-readonly.ts");
    if (name === "@/plane-web/services") return { WorkspaceService: class {} };
    if (name === "@/services/page") return { ProjectPageService: class {} };
    if (name.includes("service")) return {};
    return webRequire(name);
  };
  vm.runInThisContext(`(function(require, module, exports) { ${source}\n})`)(
    require,
    compiledModule,
    compiledModule.exports
  );
  return compiledModule.exports;
}
test("workspace User ceilings stale elevated project roles while mixed project roles stay local", () => {
  const { BaseUserPermissionStore } = load("../../core/store/user/base-permissions.store.ts");
  class Permissions extends BaseUserPermissionStore {
    getProjectRoleByWorkspaceSlugAndProjectId = (slug, id) => this.getProjectRole(slug, id);
  }
  const store = new Permissions({ router: { workspaceSlug: "one", projectId: "a" } });
  store.workspaceUserInfo.one = { role: 1 };
  store.workspaceProjectsPermissions.one = { a: 20, b: 15 };
  assert.equal(store.getProjectRoleByWorkspaceSlugAndProjectId("one", "a"), 1);
  assert.equal(store.allowPermissions([20, 15], "PROJECT", "one", "a"), false);
  assert.equal(store.allowPermissions([1], "PROJECT", "one", "a"), true);
  store.workspaceUserInfo.one = { role: 15 };
  store.workspaceProjectsPermissions.one = { a: 1, b: 15 };
  assert.equal(store.allowPermissions([20, 15, 5], "PROJECT", "one", "a"), false);
  assert.equal(store.allowPermissions([20, 15], "PROJECT", "one", "b"), true);
  store.workspaceUserInfo.one = { role: 20 };
  assert.equal(store.getProjectRoleByWorkspaceSlugAndProjectId("one", "a"), 1);
});
test("owned pages cannot override User read-only permissions", () => {
  class BasePage {
    constructor(store, page) {
      this.rootStore = store;
      Object.assign(this, page);
    }
    get isCurrentUserOwner() {
      return true;
    }
  }
  const { ProjectPage } = load("../../core/store/pages/project-page.ts", { "./base-page": { BasePage } });
  const page = new ProjectPage(
    { router: { workspaceSlug: "one" }, user: { permission: { getProjectRoleByWorkspaceSlugAndProjectId: () => 1 } } },
    { id: "page", project_ids: ["a"], access: 1 }
  );
  assert.equal(page.canCurrentUserAccessPage, true);
  for (const key of [
    "canCurrentUserEditPage",
    "canCurrentUserDuplicatePage",
    "canCurrentUserLockPage",
    "canCurrentUserChangeAccess",
    "canCurrentUserArchivePage",
    "canCurrentUserDeletePage",
    "canCurrentUserFavoritePage",
    "canCurrentUserMovePage",
    "isContentEditable",
  ])
    assert.equal(page[key], false, key);
});
test("normal workspace login and media bootstrap preserve read-only semantics", () => {
  const { getWorkspaceEntryPath, isUserReadOnly } = load("../user-readonly.ts");
  assert.equal(getWorkspaceEntryPath("team"), "/team");
  assert.equal(isUserReadOnly("1", 20), true);
  assert.equal(isUserReadOnly(15, 1), true);
  assert.equal(isUserReadOnly(15, 15), false);
});
test("read-only media bootstrap uses GET and keeps normal bootstrap POST", async () => {
  const calls = [];
  class APIService {
    get(...args) {
      calls.push(["GET", ...args]);
      return Promise.resolve({ data: { id: "library" } });
    }
    post(...args) {
      calls.push(["POST", ...args]);
      return Promise.resolve({ data: { id: "library" } });
    }
  }
  const { MediaLibraryService } = load("../../core/services/media-library.service.ts", {
    "@/services/api.service": { APIService },
    "@/helpers/workflow-diagnostics": {},
  });
  const service = new MediaLibraryService();
  assert.deepEqual(await service.ensureProjectLibrary("team", "program", undefined, true), { id: "library" });
  await service.ensureProjectLibrary("team", "program");
  assert.equal(calls[0][0], "GET");
  assert.equal(calls[1][0], "POST");
  assert.equal(calls[0][1], "/api/workspaces/team/projects/program/media-library/");
});
test("a page linked to another editable program stays read-only in its User program", () => {
  class BasePage {
    constructor(store, page) {
      this.rootStore = store;
      Object.assign(this, page);
    }
    get isCurrentUserOwner() {
      return true;
    }
  }
  const { ProjectPage } = load("../../core/store/pages/project-page.ts", { "./base-page": { BasePage } });
  const router = { workspaceSlug: "one", projectId: "readonly" };
  const page = new ProjectPage(
    {
      router,
      user: { permission: { getProjectRoleByWorkspaceSlugAndProjectId: (_, id) => (id === "readonly" ? 1 : 15) } },
    },
    { id: "page", project_ids: ["readonly", "editable"], access: 0 }
  );
  assert.equal(page.isContentEditable, false);
  assert.equal(page.canCurrentUserArchivePage, false);
  router.projectId = "editable";
  assert.equal(page.isContentEditable, true);
});
test("User board reads bypass cached SQLite rows and deleted-item sync", async () => {
  let syncCalls = 0;
  class IssueService {
    async getIssuesFromServer() {
      return { results: ["live"] };
    }
    async getIssuesForSync() {
      syncCalls++;
      throw new Error("User sync must be skipped");
    }
  }
  const { Storage } = load("../../core/local-db/storage.sqlite.ts", {
    "@/services/issue/issue.service": { IssueService },
    "@/lib/store-context": {
      rootStore: {
        user: {
          localDBEnabled: true,
          permission: { getWorkspaceRoleByWorkspaceSlug: () => 1, getProjectRoleByWorkspaceSlugAndProjectId: () => 1 },
        },
      },
    },
    "./utils/utils": {
      log() {},
      logError(error) {
        throw error;
      },
    },
    "./utils/query-sanitizer.ts": { sanitizeWorkItemQueries: (_, __, query) => query },
    "./utils/query-constructor": {
      issueFilterQueryConstructor: () => "query",
      issueFilterCountQueryConstructor: () => "count",
    },
    "./utils/query-executor": {
      runQuery() {
        throw new Error("Cached SQLite rows must not be read");
      },
    },
  });
  const storage = new Storage();
  storage.status = "ready";
  storage.db = {};
  storage.workspaceSlug = "team";
  storage.getStatus = () => "ready";
  assert.deepEqual(await storage.getIssues("team", "program", {}, {}), { results: ["live"] });
  await storage.syncIssues("program");
  assert.equal(syncCalls, 0);
});
test("User login actually enters the normal workspace instead of player", () => {
  const redirects = [];
  const EPageTypes = { NON_AUTHENTICATED: "login", AUTHENTICATED: "app" };
  const { AuthenticationWrapper } = load("../../core/lib/wrappers/authentication-wrapper.tsx", {
    "mobx-react": { observer: (fn) => fn },
    "next/navigation": { useSearchParams: () => ({ get: () => null }), usePathname: () => "/" },
    swr: { default: () => ({ isLoading: false }) },
    "@/helpers/authentication.helper": { EPageTypes },
    "@/components/common/logo-spinner": { LogoSpinner: () => null },
    "@/hooks/store/use-workspace": {
      useWorkspace: () => ({ loader: false, workspaces: { team: { slug: "team", role: 1 } } }),
    },
    "@/hooks/store/user": {
      useUser: () => ({ isLoading: false, data: { id: "user" }, fetchCurrentUser() {} }),
      useUserProfile: () => ({ data: { id: "profile", is_onboarded: true } }),
      useUserSettings: () => ({ data: { workspace: { last_workspace_slug: "team" } } }),
    },
    "@/hooks/use-app-router": { useAppRouter: () => ({ push: (path) => redirects.push(path) }) },
  });
  AuthenticationWrapper({ children: null, pageType: EPageTypes.NON_AUTHENTICATED });
  assert.deepEqual(redirects, ["/team"]);
});
test("workspace User home omits widgets with unsupported fetches while Member home stays intact", () => {
  const { getVisibleHomeWidgetKeys } = load("../user-readonly.ts");
  const widgets = ["quick_links", "recents", "my_stickies"];
  assert.deepEqual(getVisibleHomeWidgetKeys(widgets, 1), ["recents"]);
  assert.deepEqual(getVisibleHomeWidgetKeys(widgets, "1"), ["recents"]);
  assert.deepEqual(getVisibleHomeWidgetKeys(widgets, 15), widgets);
});
test("User programs do not request or activate diagnostics capabilities", () => {
  let readOnly = true;
  const requests = [];
  const { WorkflowReporting } = load("../../core/components/profile/diagnostics/workflow-reporting.tsx", {
    react: { useEffect: (effect) => effect(), useState: () => [null, () => {}] },
    "next/navigation": { useParams: () => ({ workspaceSlug: "team", projectId: "program" }) },
    "@/hooks/use-user-readonly": { useUserReadOnly: () => readOnly },
    "@/helpers/workflow-diagnostics": { operationEndpoint: () => "/operations" },
    "@/services/diagnostics.service": {
      DiagnosticsService: class {
        operation(url) {
          requests.push(url);
          return Promise.resolve({ enabled: false });
        }
      },
    },
  });
  WorkflowReporting();
  assert.deepEqual(requests, []);
  readOnly = false;
  WorkflowReporting();
  assert.deepEqual(requests, ["/operations"]);
});
