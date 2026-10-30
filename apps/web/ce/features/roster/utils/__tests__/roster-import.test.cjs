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
const { mapImportedRows } = load(path.resolve(__dirname, "../roster.utils.ts"));

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
