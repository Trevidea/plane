/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS loader executes transpiled fixture modules. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { createRequire } = require("node:module");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const webRequire = createRequire(path.resolve(__dirname, "../../../../../package.json"));
const ts = webRequire("typescript");
const load = (filename) => {
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  const localRequire = (id) => load(path.resolve(path.dirname(filename), `${id}.ts`));
  vm.runInThisContext(`(function(require, module, exports) { ${source}\n})`)(localRequire, loadedModule, loadedModule.exports);
  return loadedModule.exports;
};
const { mapImportedRows, getRosterAccountStatus, canDeleteRosterPlayer, getRosterDisplayEmail } = load(
  path.resolve(__dirname, "../roster.utils.ts")
);

test("linked players display their account email even when their roster email is blank or outdated", () => {
  assert.equal(
    getRosterDisplayEmail({ user: "linked-user", email: "", account_email: "member@example.com" }),
    "member@example.com"
  );
  assert.equal(
    getRosterDisplayEmail({ user: "linked-user", email: "old@example.com", account_email: "current@example.com" }),
    "current@example.com"
  );
  assert.equal(getRosterDisplayEmail({ user: "linked-user", email: "legacy@example.com" }), "legacy@example.com");
  assert.equal(
    getRosterDisplayEmail({ user: null, email: "invite@example.com", account_email: "stale@example.com" }),
    "invite@example.com"
  );
});

test("staff can remove linked or unlinked players while removed identities stay out of the roster", () => {
  for (const player of [
    { status: "active", email: null, user: null },
    { status: "active", email: "player@example.com", user: "linked-user" },
    { status: "inactive", user: "linked-user" },
    { status: "pending", registration_status: "pending" },
  ])
    assert.equal(canDeleteRosterPlayer(player), true);
  assert.equal(canDeleteRosterPlayer({ status: "removed", user: "linked-user" }), false);
});

test("imports accept active/inactive and normalize injured without permitting pending approval or removed", () => {
  for (const [input, expected] of [
    ["", "active"],
    ["ACTIVE", "active"],
    ["injured", "active"],
    ["Inactive", "inactive"],
  ]) {
    assert.equal(mapImportedRows([{ Name: "Player", Status: input }])[0].status, expected);
  }
  for (const status of ["pending", "removed", "unknown"]) {
    assert.throws(() => mapImportedRows([{ Name: "Player", Status: status }]), /Use active or inactive/);
  }
});

test("CSV/XLSX email headers are preserved and normalized", () => {
  for (const header of ["Email", "Email Address", "Player Email", "E-mail"]) {
    const [player] = mapImportedRows([{ "Player Name": "Player", [header]: " PLAYER@example.com " }]);
    assert.equal(player.email, "player@example.com");
    assert.equal(player.player_name, "Player");
  }
});

test("email-less legacy files remain importable", () => {
  const [player] = mapImportedRows([{ Name: "Player", Jersey: "17" }]);
  assert.equal(player.email, null);
  assert.equal(player.jersey_number, "17");
});

test("a row containing only email is retained for backend name validation", () => {
  assert.equal(mapImportedRows([{ Email: "player@example.com" }]).length, 1);
  assert.equal(mapImportedRows([{ Email: "" }]).length, 0);
});

test("account status uses real invitation state rather than treating every email as invited", () => {
  assert.equal(getRosterAccountStatus({ email: "" }), "email_missing");
  assert.equal(getRosterAccountStatus({ email: "player@example.com" }), "not_linked");
  assert.equal(getRosterAccountStatus({ user: "member-id", email: "" }), "linked");
  assert.equal(
    getRosterAccountStatus({ email: "player@example.com", account_status: "invitation_pending" }),
    "invitation_pending"
  );
});
