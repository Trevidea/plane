import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const webRequire = createRequire(fileURLToPath(new URL("../../../../../apps/web/package.json", import.meta.url)));
const imageRequire = (name) => (name === "next/image" ? webRequire(name).default : require(name));
const { JSDOM } = require(process.env.JSDOM_PACKAGE_PATH || "jsdom");
const { build } = require(process.env.ESBUILD_PACKAGE_PATH || "esbuild");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { act } = React;
const temp = await mkdtemp(path.join(tmpdir(), "image-fallback-test-"));
const output = path.join(temp, "image.cjs");
await build({
  entryPoints: [fileURLToPath(new URL("../image.tsx", import.meta.url))],
  outfile: output,
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["react", "next/image"],
});
// Resolve the same React instance as the renderer.
const { readFileSync } = await import("node:fs");
const compiled = { exports: {} };
new Function("require", "module", "exports", readFileSync(output, "utf8"))(imageRequire, compiled, compiled.exports);
const { ImageWithFallback, DEFAULT_IMAGE } = compiled.exports;
const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
for (const name of ["Element", "HTMLElement", "Node", "MutationObserver", "getComputedStyle"])
  globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test("missing and failed images show a default, then recover when the source changes", async () => {
  const root = createRoot(document.getElementById("root"));
  const render = async (props) =>
    act(() => root.render(React.createElement(ImageWithFallback, { alt: "Player", ...props })));
  await render({});
  assert.equal(document.querySelector("img").getAttribute("src"), DEFAULT_IMAGE);
  assert.equal(document.querySelector("img").getAttribute("data-image-fallback"), "true");
  assert.equal(document.querySelector("img").getAttribute("data-nimg"), "1");
  await render({ src: "/player.png", srcSet: "/player-2x.png 2x", className: "rounded", width: 40 });
  let image = document.querySelector("img");
  assert.equal(image.getAttribute("src"), "http://localhost/player.png");
  assert.equal(image.hasAttribute("data-image-fallback"), false);
  await act(() => image.dispatchEvent(new dom.window.Event("error")));
  image = document.querySelector("img");
  assert.equal(image.getAttribute("src"), DEFAULT_IMAGE);
  assert.equal(image.getAttribute("srcset"), null);
  assert.equal(image.alt, "Player");
  assert.equal(image.className, "rounded");
  assert.equal(image.width, 40);
  await act(() => image.dispatchEvent(new dom.window.Event("error")));
  assert.equal(image.getAttribute("src"), DEFAULT_IMAGE);
  await render({ src: "/new-player.png" });
  assert.equal(image.getAttribute("src"), "http://localhost/new-player.png");
  await render({ src: "/player.png" });
  assert.equal(image.getAttribute("src"), "http://localhost/player.png");
  await render({ src: "   " });
  assert.equal(image.getAttribute("src"), DEFAULT_IMAGE);
  await act(() => root.unmount());
});

test("Next images use the same fallback and recover without losing their dimensions", async () => {
  const nextOutput = path.join(temp, "next-image.cjs");
  const entry = fileURLToPath(
    new URL("../../../../../apps/web/core/components/common/image-with-fallback.tsx", import.meta.url)
  );
  await build({
    entryPoints: [entry],
    outfile: nextOutput,
    bundle: true,
    platform: "node",
    format: "cjs",
    jsx: "automatic",
    external: ["react", "react/jsx-runtime", "next/image"],
    alias: { "@plane/ui": fileURLToPath(new URL("../image.tsx", import.meta.url)) },
  });
  const webRequire = createRequire(fileURLToPath(new URL("../../../../../apps/web/package.json", import.meta.url)));
  const module = { exports: {} };
  new Function("require", "module", "exports", readFileSync(nextOutput, "utf8"))(
    (name) => (name === "next/image" ? webRequire(name) : require(name)),
    module,
    module.exports
  );
  const NextImage = module.exports.default;
  const root = createRoot(document.getElementById("root"));
  const render = (src) =>
    act(() =>
      root.render(React.createElement(NextImage, { src, width: 100, height: 80, alt: "Thumbnail", unoptimized: true }))
    );
  await render("");
  const image = document.querySelector("img");
  assert.equal(image.getAttribute("src"), DEFAULT_IMAGE);
  await render("/thumbnail.png");
  await act(() => image.dispatchEvent(new dom.window.Event("error")));
  assert.equal(image.getAttribute("src"), DEFAULT_IMAGE);
  assert.equal(image.getAttribute("data-image-fallback"), "true");
  assert.equal(image.width, 100);
  assert.equal(image.height, 80);
  await render("/new-thumbnail.png");
  assert.equal(image.src, "http://localhost/new-thumbnail.png");
  await act(() =>
    root.render(
      React.createElement(NextImage, {
        src: { src: "/static.png", width: 48, height: 32 },
        alt: "Static image",
        unoptimized: true,
      })
    )
  );
  await act(() => image.dispatchEvent(new dom.window.Event("error")));
  assert.equal(image.getAttribute("src"), DEFAULT_IMAGE);
  assert.equal(image.width, 48);
  assert.equal(image.height, 32);
  await act(() => root.unmount());
});

test("user avatars show initials for missing and failed photos and recover with a new photo", async () => {
  const avatarOutput = path.join(temp, "avatar.cjs");
  await build({
    entryPoints: [fileURLToPath(new URL("../../avatar/avatar.tsx", import.meta.url))],
    outfile: avatarOutput,
    bundle: true,
    platform: "node",
    format: "cjs",
    jsx: "automatic",
    external: ["react", "react/jsx-runtime", "react-dom", "next/image"],
    // Tooltip positioning is unrelated to avatar fallback behavior.
    plugins: [
      {
        name: "tooltip-fixture",
        setup(build) {
          build.onResolve({ filter: /^@plane\/propel\/tooltip$/ }, () => ({ path: "tooltip", namespace: "fixture" }));
          build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents: "export const Tooltip = ({ children }) => children;",
          }));
        },
      },
    ],
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", readFileSync(avatarOutput, "utf8"))(
    imageRequire,
    module,
    module.exports
  );
  const { Avatar } = module.exports;
  const container = document.getElementById("root");
  const root = createRoot(container);
  const render = (props) =>
    act(() => root.render(React.createElement(Avatar, { name: "Baron Browning", showTooltip: false, ...props })));
  await render({});
  assert.equal(container.querySelectorAll("img").length, 0);
  assert.equal(container.textContent, "B");
  await render({ src: "/player.png" });
  assert.equal(container.querySelector("img").getAttribute("src"), "http://localhost/player.png");
  await act(() => container.querySelector("img").dispatchEvent(new dom.window.Event("error")));
  assert.equal(container.querySelectorAll("img").length, 0);
  assert.equal(container.textContent, "B");
  await render({ src: "/new-player.png" });
  assert.equal(container.querySelector("img").getAttribute("src"), "http://localhost/new-player.png");
  await render({ name: "", src: undefined, fallbackText: "?" });
  assert.equal(container.textContent, "?");
  await act(() => root.unmount());
});
