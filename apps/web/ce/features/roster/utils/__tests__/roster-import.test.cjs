const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const vm = require("node:vm");
const test = require("node:test");
const webRequire = createRequire(path.resolve(__dirname, "../../../../../package.json"));
const ts = webRequire("typescript");
const load = (filename) => {
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const localRequire = (id) => load(path.resolve(path.dirname(filename), `${id}.ts`));
  vm.runInThisContext(`(function(require, module, exports) { ${source}\n})`)(localRequire, module, module.exports);
  return module.exports;
};
const { mapImportedRows, getRosterAccountStatus, canDeleteRosterPlayer } = load(
  path.resolve(__dirname, "../roster.utils.ts")
);

test("only players with missing email and no linked account can be deleted from the roster", () => {
  assert.equal(canDeleteRosterPlayer({ email: null, user: null, account_status: "email_missing" }), true);
  assert.equal(canDeleteRosterPlayer({ email: "   ", user: null }), true);
  assert.equal(canDeleteRosterPlayer({ email: "player@example.com", user: null }), false);
  assert.equal(canDeleteRosterPlayer({ email: null, user: "linked-user" }), false);
  assert.equal(canDeleteRosterPlayer({ email: null, user: null, account_status: "invitation_pending" }), false);
  assert.equal(canDeleteRosterPlayer({ email: null, user: "linked-user", account_status: "email_missing" }), false);
  assert.equal(
    canDeleteRosterPlayer({ email: "player@example.com", user: null, account_status: "email_missing" }),
    false
  );
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
