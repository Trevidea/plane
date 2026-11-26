/* eslint-disable @typescript-eslint/no-require-imports -- Executes real TypeScript helpers in the CommonJS test runner. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");
const filename = path.resolve(__dirname, "../roster-jersey.ts");
const loaded = { exports: {} };
if (fs.existsSync(filename)) {
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInThisContext(`(function(module,exports){${source}\n})`)(loaded, loaded.exports);
}
const { findRosterJerseyConflict } = loaded.exports;

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
