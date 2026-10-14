import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const require = createRequire(path.join(web, "package.json"));
const { build } = require(process.env.ESBUILD_PACKAGE_PATH || "esbuild");
const bundle = await build({
  absWorkingDir: web,
  stdin: {
    resolveDir: web,
    contents: `export * from './core/components/issues/issue-layouts/kanban/coaching-card-types';
      export {CoachingCardLegend} from './core/components/issues/issue-layouts/kanban/coaching-card-legend';`,
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  jsx: "automatic",
  external: ["react", "react-dom", "react-dom/server"],
});
const compiled = { exports: {} };
new Function("module", "exports", "require", bundle.outputFiles[0].text)(compiled, compiled.exports, require);
const {
  COACHING_CARD_TYPES,
  COACHING_CARD_GROUP_ACCENT,
  getCoachingCardAccent,
  getCoachingCardBorderBackground,
  getCoachingCardLegendEntries,
  CoachingCardLegend,
} = compiled.exports;
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

test("legend covers every card type using exactly the card border colors", () => {
  const entries = getCoachingCardLegendEntries();
  assert.equal(entries.length, 4);
  assert.deepEqual(
    entries.flatMap((entry) => entry.labels).sort(),
    Object.values(COACHING_CARD_TYPES)
      .map((type) => type.label)
      .sort()
  );
  for (const [name, type] of Object.entries(COACHING_CARD_TYPES)) {
    const entry = entries.find((entry) => entry.labels.includes(type.label));
    assert.equal(entry.accent, getCoachingCardAccent(name));
    assert.equal(entry.accent, getCoachingCardBorderBackground(name));
  }
});

test("Correction and Multi-Week Development share one blue legend entry", () => {
  const entries = getCoachingCardLegendEntries();
  assert.deepEqual(entries.find((entry) => entry.accent === "#2893cc")?.labels, [
    "Correction",
    "Multi-Week Development",
  ]);
  assert.equal(entries.filter((entry) => entry.accent === "#2893cc").length, 1);
});

test("position-group marker preserves each card type's split border", () => {
  for (const name of Object.keys(COACHING_CARD_TYPES)) {
    assert.equal(
      getCoachingCardBorderBackground(name, "O-Line"),
      `linear-gradient(180deg, ${getCoachingCardAccent(name)} 50%, ${COACHING_CARD_GROUP_ACCENT} 50%)`
    );
    assert.equal(getCoachingCardBorderBackground(name, ""), getCoachingCardAccent(name));
    assert.equal(getCoachingCardBorderBackground(name, null), getCoachingCardAccent(name));
  }
});

test("missing or unknown card types retain the existing blue fallback", () => {
  assert.equal(getCoachingCardAccent(), "#2893cc");
  assert.equal(getCoachingCardAccent("unknown"), "#2893cc");
});

test("rendered legend names all markers instead of relying on color alone", () => {
  const markup = renderToStaticMarkup(createElement(CoachingCardLegend));
  assert.match(markup, /role="group" aria-label="Coaching card border legend"/);
  assert.equal((markup.match(/justify-end/g) || []).length, 2);
  for (const label of ["Correction / Multi-Week Development", "Reinforcement", "Scout", "S&amp;C", "Position group"])
    assert.ok(markup.includes(label), label);
  assert.equal((markup.match(/<li /g) || []).length, 5);
  assert.equal((markup.match(/aria-hidden="true"/g) || []).length, 5);
  assert.match(markup, /background:linear-gradient\(180deg, #2893cc 50%, #7a4488 50%\)/);
  assert.doesNotMatch(markup, /<(button|a|input)\b/);
});
