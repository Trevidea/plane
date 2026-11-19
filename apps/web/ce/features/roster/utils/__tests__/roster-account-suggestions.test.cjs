/* eslint-disable @typescript-eslint/no-require-imports -- Executes real TypeScript helpers in the CommonJS test runner. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");
const filename = path.resolve(__dirname, "../roster-account-suggestions.ts");
const loaded = { exports: {} };
if (fs.existsSync(filename)) {
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInThisContext(`(function(module,exports){${source}\n})`)(loaded, loaded.exports);
}
const { findRosterAccountSuggestions, findRosterJerseyConflict } = loaded.exports;
const member = (id, overrides = {}) => ({
  id: `membership-${id}`,
  member: {
    id,
    first_name: "José",
    last_name: "De la Cruz",
    email: `${id}@example.com`,
    is_bot: false,
  },
  ...overrides,
});

test("matches normalized full names without treating a matching first name as identity", () => {
  assert.equal(typeof findRosterAccountSuggestions, "function");
  const matches = findRosterAccountSuggestions(
    [
      member("1"),
      member("2", {
        member: {
          id: "2",
          first_name: "José",
          last_name: "Other",
          email: "2@example.com",
          is_bot: false,
        },
      }),
    ],
    [],
    "  JOSÉ   De la Cruz ",
    ""
  );
  assert.deepEqual(
    matches.map((item) => [item.user.id, item.reason]),
    [["1", "name"]]
  );
});

test("exact email finds an account but excludes inactive, bot and already linked program accounts", () => {
  assert.equal(typeof findRosterAccountSuggestions, "function");
  const entries = [
    member("1"),
    member("2", { is_active: false }),
    member("3", {
      member: {
        id: "3",
        first_name: "José",
        last_name: "De la Cruz",
        is_bot: true,
        email: "3@example.com",
      },
    }),
    member("4"),
    member("5", {
      member: {
        id: "5",
        first_name: "José",
        last_name: "De la Cruz",
        email: "5@example.com",
        is_active: false,
      },
    }),
  ];
  assert.deepEqual(
    findRosterAccountSuggestions(entries, [{ user: "4", status: "removed" }], "José De la Cruz", "").map(
      (item) => item.user.id
    ),
    ["1"]
  );
  assert.equal(findRosterAccountSuggestions(entries, [], "Different Person", " 1@EXAMPLE.COM ")[0].reason, "email");
  assert.deepEqual(findRosterAccountSuggestions(entries, [], "", ""), []);
});

test("jersey conflict reserves active, injured and pending jerseys but excludes this player and inactive players", () => {
  assert.equal(typeof findRosterJerseyConflict, "function");
  const players = [
    { id: "a", jersey_number: "0", status: "active" },
    { id: "b", jersey_number: "7", status: "pending" },
    { id: "c", jersey_number: "8", status: "inactive" },
    { id: "d", jersey_number: "9", status: "injured" },
  ];
  assert.equal(findRosterJerseyConflict(players, " 0 ").id, "a");
  assert.equal(findRosterJerseyConflict(players, "7").id, "b");
  assert.equal(findRosterJerseyConflict(players, "9").id, "d");
  assert.equal(findRosterJerseyConflict(players, "0", "a"), undefined);
  assert.equal(findRosterJerseyConflict(players, "8"), undefined);
  assert.equal(findRosterJerseyConflict(players, ""), undefined);
});
