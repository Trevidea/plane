/* eslint-disable @typescript-eslint/no-require-imports -- Loads real TypeScript helpers in the existing CommonJS test runner. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");
const filename = path.resolve(__dirname, "../roster-presentation.ts");
const loaded = { exports: {} };
if (fs.existsSync(filename)) {
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInThisContext(`(function(module,exports){${source}\n})`)(loaded, loaded.exports);
}
const { summarizeRoster, rosterToCSV, rosterToSpreadsheetRows } = loaded.exports;

test("summary keeps pending requests separate from active tagging players and excludes removed identities", () => {
  assert.equal(typeof summarizeRoster, "function");
  assert.deepEqual(
    summarizeRoster([
      { status: "active", user: "u1" },
      { status: "injured", user: null },
      { status: "active", registration_status: "pending" },
      { status: "pending" },
      { status: "inactive", user: "u2" },
      { status: "removed", user: "u3" },
    ]),
    { active: 3, inactive: 1, linked: 1, unmatched: 1, requests: 2 }
  );
});

test("CSV round-trip preserves names, quotes, jersey zero and graduation year; excludes removed and pending", () => {
  assert.equal(typeof rosterToCSV, "function");
  const csv = rosterToCSV([
    { player_name: 'Sam, "Junior"', jersey_number: "0", class_year: "2028", status: "injured", notes: "line\nbreak" },
    { player_name: "Departed", status: "removed" },
    { player_name: "Pending", status: "pending" },
  ]);
  const XLSX = require("xlsx");
  const book = XLSX.read(csv, { type: "string" });
  const rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { raw: false });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].player_name, 'Sam, "Junior"');
  assert.equal(rows[0].jersey_number, "0");
  assert.equal(rows[0].class_year, "2028");
  assert.equal(rows[0].status, "active");
  assert.equal(rows[0].notes, "line\nbreak");
});

test("export neutralizes spreadsheet formulas in untrusted roster text", () => {
  assert.equal(typeof rosterToCSV, "function");
  const csv = rosterToCSV([{ player_name: '=HYPERLINK("https://example.com")', notes: "  +123", status: "active" }]);
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.ok(csv.includes("'  +123"));
});

test("XLSX rows preserve text jersey numbers, use the same fields and exclude pending or removed players", () => {
  const XLSX = require("xlsx");
  const rows = rosterToSpreadsheetRows([
    { player_name: "Alex", jersey_number: "01", class_year: "2028", notes: "=1+1", status: "active" },
    { player_name: "Pending", status: "pending", registration_status: "pending" },
    { player_name: "Removed", status: "removed" },
  ]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "Roster");
  const output = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
  const restored = XLSX.read(output, { type: "buffer" });
  const players = XLSX.utils.sheet_to_json(restored.Sheets.Roster);
  assert.equal(players.length, 1);
  assert.equal(players[0].jersey_number, "01");
  assert.equal(players[0].class_year, "2028");
  assert.equal(players[0].notes, "'=1+1");
});
