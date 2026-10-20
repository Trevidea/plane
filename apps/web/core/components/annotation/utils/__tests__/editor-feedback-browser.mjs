import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const require = createRequire(path.join(web, "package.json"));

const { build } = require(process.env.ESBUILD_PACKAGE_PATH || "esbuild");
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE_PATH || "playwright");
const styleRequire = createRequire(require.resolve("@plane/tailwind-config"));
const tailwind = styleRequire("tailwindcss");
const postcss = createRequire(styleRequire.resolve("tailwindcss"))("postcss");
const bundle = await build({
  absWorkingDir: web,
  entryPoints: ["core/components/annotation/components/__tests__/editor-feedback-fixture.tsx"],
  bundle: true,
  write: false,
  outdir: "/tmp/annotation-feedback-bundle",
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  alias: { "@": path.join(web, "core") },
  define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" },
  loader: { ".woff2": "dataurl", ".woff": "dataurl", ".svg": "dataurl", ".png": "dataurl" },
});
const root = postcss.parse(await readFile(path.join(web, "styles/globals.css"), "utf8"));
root.walkAtRules("import", (rule) => rule.remove());
const css = (
  await postcss([
    tailwind({
      ...require(path.join(web, "tailwind.config.js")),
      content: [
        path.join(web, "core/components/annotation/**/*.{ts,tsx}"),
        path.join(web, "../../packages/{ui,propel}/src/**/*.{ts,tsx}"),
      ],
    }),
  ]).process(root, { from: path.join(web, "styles/globals.css") })
).css;
const html =
  '<!doctype html><html><head><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>';
const server = createServer((req, res) => {
  const resources = {
    "/": ["text/html", html],
    "/fixture.js": ["text/javascript", bundle.outputFiles.find((f) => f.path.endsWith(".js")).text],
    "/fixture.css": ["text/css", css],
  };
  const resource = resources[req.url];
  if (!resource) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "Content-Type": resource[0] }).end(resource[1]);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const failures = [];
const test = async (name, run) => {
  try {
    await run();
    console.log("PASS", name);
  } catch (error) {
    failures.push(name);
    console.error("FAIL", name, error.message);
  }
};
const save = async () => {
  await page.getByRole("button", { name: "Save editor", exact: true }).click();
  await page.waitForTimeout(100);
  return JSON.parse(await page.getByTestId("saved-json").innerText());
};
const stroke = async (y) => {
  const b = await page.getByTestId("drawing").boundingBox();
  await page.mouse.move(b.x + 200, b.y + y);
  await page.mouse.down();
  await page.mouse.move(b.x + 300, b.y + y + 20, { steps: 8 });
  await page.mouse.up();
};
try {
  await page.goto(`http://localhost:${server.address().port}`);
  await stroke(100);
  await save();
  // Select the real drawn stroke directly on the canvas.
  const b = await page.getByTestId("drawing").boundingBox();
  await page.mouse.click(b.x + 250, b.y + 110);
  await page.getByLabel("Annotation start in seconds", { exact: true }).waitFor();
  await page.getByRole("button", { name: /Open annotation color picker/ }).click();
  await page.getByRole("button", { name: "Use #22C55E annotation color", exact: true }).click();
  await page.getByRole("button", { name: "Freehand draw", exact: true }).click();
  await stroke(220);
  await test("color chosen while selected also colors next freehand", async () => {
    const a = await save();
    assert.equal(a[0].style.stroke, "#22c55e");
    assert.equal(a[1].style.stroke, "#22c55e");
  });
  await page.mouse.click(b.x + 250, b.y + 230);
  await test("interactive properties labels cannot be natively selected", async () => {
    const label = page.getByText("Starts at (sec)", { exact: true });
    await label.dblclick();
    assert.equal(await page.evaluate(() => window.getSelection()?.toString()), "");
    const input = page.getByLabel("Annotation color hex value", { exact: true });
    await input.evaluate((el) => el.select());
    assert.equal(await input.evaluate((el) => el.value.substring(el.selectionStart, el.selectionEnd)), "#22C55E");
  });
  await test("start time keeps existing duration inside clip", async () => {
    await page.getByLabel("Annotation start in seconds", { exact: true }).fill("20");
    const a = (await save())[1];
    assert.ok(a.endTime <= 10);
    assert.equal(a.endTime - a.startTime, 2);
    assert.equal(a.startTime, 8);
  });
  await test("duration preset stays inside clip", async () => {
    await page.getByRole("button", { name: "Seek to eight", exact: true }).click();
    await page.mouse.click(b.x + 250, b.y + 230);
    await page.getByRole("button", { name: "Show annotation for 8 seconds", exact: true }).click();
    const a = (await save())[1];
    assert.equal(a.endTime, 10);
    assert.equal(a.startTime, 8);
  });

  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
assert.deepEqual(failures, []);
