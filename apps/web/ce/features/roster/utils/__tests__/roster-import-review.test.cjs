/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { createRequire } = require("node:module");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = createRequire(path.resolve(__dirname, "../../../../../package.json"))("typescript");
const load = (filename) => {
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`)(
    (id) => load(path.resolve(path.dirname(filename), `${id}.ts`)),
    mod,
    mod.exports
  );
  return mod.exports;
};
const review = () => load(path.resolve(__dirname, "../roster-import-review.ts"));
test("detects first/last and graduation aliases and supports explicit remapping", () => {
  const { suggestRosterMapping, mapRosterColumns, getMappingErrors } = review();
  const headers = ["First Name", "Last Name", "Graduation Year", "E-mail", "Shirt"];
  const mapping = suggestRosterMapping(headers);
  assert.equal(mapping["Graduation Year"], "class_year");
  mapping.Shirt = "jersey_number";
  const [row] = mapRosterColumns(
    [
      {
        "First Name": " Ada ",
        "Last Name": "Lovelace",
        "Graduation Year": "2028",
        "E-mail": " ADA@EXAMPLE.COM ",
        Shirt: "12",
      },
    ],
    mapping
  );
  assert.equal(row.player_name, "Ada Lovelace");
  assert.equal(row.email, "ada@example.com");
  assert.equal(row.class_year, "2028");
  assert.equal(row.jersey_number, "12");
  assert.equal(getMappingErrors(mapping).length, 0);
  assert.ok(getMappingErrors({ A: "email" }).length);
  assert.ok(getMappingErrors({ A: "player_name", B: "email", C: "email" }).length);
});
test("marks both in-file conflicts, existing roster conflicts and invalid values; exclusion resolves conflicts", () => {
  const { validateRosterImport } = review();
  const rows = [
    { player_name: "Ada", email: "ada@example.com", jersey_number: "12" },
    { player_name: "Bob", email: "ADA@example.com", jersey_number: "12" },
    { player_name: "", email: "broken" },
    { player_name: "Existing", email: "existing@example.com", jersey_number: "7" },
  ];
  const existing = [{ player_name: "Existing", email: "existing@example.com", jersey_number: "7", status: "active" }];
  const results = validateRosterImport(rows, existing);
  assert.ok(results[0].errors.some((e) => e.includes("email")));
  assert.ok(results[1].errors.some((e) => e.includes("Jersey")));
  assert.ok(results[2].errors.some((e) => e.includes("name")));
  assert.ok(results[2].errors.some((e) => e.includes("email")));
  assert.ok(results[3].errors.some((e) => e.includes("roster")));
  assert.equal(validateRosterImport(rows, [], new Set([1, 2, 3]))[0].errors.length, 0);
});
test("possible name and grad year duplicates warn without claiming account matches; removed roster rows do not conflict", () => {
  const { validateRosterImport } = review();
  const rows = [{ player_name: " Ada Lovelace ", class_year: "2028", jersey_number: "1" }];
  const results = validateRosterImport(rows, [
    { player_name: "ada lovelace", class_year: "2028", jersey_number: "2", status: "active" },
  ]);
  assert.equal(results[0].errors.length, 0);
  assert.ok(results[0].warnings.some((e) => e.includes("name and grad year")));
  assert.equal(validateRosterImport(rows, [{ ...rows[0], status: "removed" }])[0].warnings.length, 0);
});
test("validates backend field lengths and statuses without rejecting optional email or grad year", () => {
  const { validateRosterImport } = review();
  assert.equal(validateRosterImport([{ player_name: "Ada" }], [])[0].errors.length, 0);
  assert.ok(
    validateRosterImport(
      [{ player_name: "x".repeat(256), email: "a".repeat(250) + "@x.com", status: "pending" }],
      []
    )[0].errors.length >= 3
  );
});
