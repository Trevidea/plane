const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const vm = require("node:vm");
const test = require("node:test");
const webRequire = createRequire(path.resolve(__dirname, "../../package.json"));
const ts = webRequire("typescript");
const source = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, "../project-lead.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const compiled = { exports: {} };
vm.runInThisContext(`(function(require, module, exports) { ${source}\n})`)(webRequire, compiled, compiled.exports);
const { isProgramLeadCandidate } = compiled.exports;

test("workspace Users remain excluded even with elevated project roles", () => {
  assert.equal(isProgramLeadCandidate({ role: 1 }, { role: 20 }), false);
  assert.equal(isProgramLeadCandidate({ role: 1 }), false);
});
test("project Users remain excluded even with workspace membership", () => {
  assert.equal(isProgramLeadCandidate({ role: 15 }, { role: 1 }), false);
});
test("existing non-User roles remain eligible", () => {
  for (const role of [5, 15, 20]) assert.equal(isProgramLeadCandidate({ role }), true);
});
test("missing and inactive workspace memberships are excluded", () => {
  assert.equal(isProgramLeadCandidate(null), false);
  assert.equal(isProgramLeadCandidate({ role: 15, is_active: false }), false);
});
