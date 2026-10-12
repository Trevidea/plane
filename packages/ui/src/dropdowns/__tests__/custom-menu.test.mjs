import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { JSDOM } = require(process.env.JSDOM_PACKAGE_PATH || "jsdom");
const { build } = require(process.env.ESBUILD_PACKAGE_PATH || "esbuild");
const dom = new JSDOM("<div id='root'></div><div id='menus'></div><div id='context-menu-portal'></div>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});
const previousGlobals = new Map();
for (const name of [
  "window",
  "document",
  "navigator",
  "Element",
  "HTMLElement",
  "HTMLButtonElement",
  "HTMLFieldSetElement",
  "HTMLLegendElement",
  "HTMLIFrameElement",
  "Node",
  "NodeFilter",
  "MutationObserver",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
]) {
  previousGlobals.set(name, Object.getOwnPropertyDescriptor(global, name));
  Object.defineProperty(global, name, { configurable: true, writable: true, value: dom.window[name] });
}
previousGlobals.set("IS_REACT_ACT_ENVIRONMENT", Object.getOwnPropertyDescriptor(global, "IS_REACT_ACT_ENVIRONMENT"));
global.IS_REACT_ACT_ENVIRONMENT = true;

const React = require("react");
const { act, createElement, useRef, useState } = React;
const { createRoot } = require("react-dom/client");
const peekHookPath = fileURLToPath(
  new URL("../../../../../apps/web/core/hooks/use-peek-overview-outside-click.tsx", import.meta.url)
);
const bundle = await build({
  stdin: {
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
    contents: `export {CustomMenu} from './custom-menu'; export {ContextMenu} from './context-menu/root';
      export {default as usePeekOverviewOutsideClickDetector} from ${JSON.stringify(peekHookPath)};`,
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  jsx: "automatic",
  external: ["react", "react/jsx-runtime", "react-dom", "@headlessui/react", "lucide-react"],
  alias: {
    "@plane/hooks": fileURLToPath(new URL("../../../../hooks/src/use-outside-click-detector.tsx", import.meta.url)),
  },
  plugins: [
    {
      name: "menu-positioning-boundaries",
      setup(builder) {
        builder.onResolve({ filter: /^(\.\.\/)+utils$/ }, () => ({
          path: fileURLToPath(new URL("../../utils/classname.tsx", import.meta.url)),
        }));
        builder.onResolve({ filter: /^react-popper$|use-platform-os$/ }, ({ path }) => ({
          path,
          namespace: "fixture",
        }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
          contents:
            path === "react-popper"
              ? "export const usePopper = () => ({styles: {}, attributes: {}});"
              : "export const usePlatformOS = () => ({isMobile: false});",
        }));
      },
    },
  ],
});
const compiled = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(require, compiled, compiled.exports);
const { CustomMenu, ContextMenu, usePeekOverviewOutsideClickDetector } = compiled.exports;
const container = document.getElementById("root");
let root;

const Fixture = ({
  portalled = false,
  closeOnSelect = true,
  stopActionPropagation = true,
  stopMouseDownPropagation = true,
  onClose = () => {},
}) => {
  const [peek, setPeek] = useState(false);
  const cardRef = useRef(null);
  const otherCardRef = useRef(null);
  const peekRef = useRef(null);
  usePeekOverviewOutsideClickDetector(peekRef, () => setPeek(false), "A");
  const menu = (id) =>
    createElement(
      CustomMenu,
      {
        verticalEllipsis: true,
        ariaLabel: `Actions ${id}`,
        closeOnSelect,
        useCaptureForOutsideClick: true,
        portalElement: portalled ? document.getElementById("menus") : undefined,
        onMenuClose: () => onClose(id),
      },
      createElement(
        CustomMenu.MenuItem,
        {
          onClick: (event) => {
            if (stopActionPropagation) event.stopPropagation();
            setPeek(true);
          },
        },
        `Open ${id}`
      ),
      createElement(CustomMenu.MenuItem, { disabled: true }, `Disabled ${id}`)
    );
  return createElement(
    "div",
    {
      onMouseDown: (event) => {
        if (stopMouseDownPropagation) event.stopPropagation();
      },
      onClick: (event) => event.stopPropagation(),
    },
    createElement(
      "div",
      { ref: cardRef, "data-coaching-card-id": "A", "data-prevent-peek-outside-click": true },
      menu("A"),
      createElement("button", { onClick: () => setPeek(true) }, "Card body")
    ),
    createElement(
      "div",
      { ref: otherCardRef, "data-coaching-card-id": "B", "data-prevent-peek-outside-click": true },
      menu("B")
    ),
    createElement(ContextMenu, {
      parentRef: cardRef,
      items: [{ key: "open", title: "Context open", action: () => setPeek(true) }],
    }),
    createElement(ContextMenu, {
      parentRef: otherCardRef,
      items: [{ key: "open", title: "Other context open", action: () => setPeek(true) }],
    }),
    peek && createElement("aside", { ref: peekRef, "aria-label": "Card details" }, "Peek")
  );
};
const render = async (props) => {
  root = createRoot(container);
  await act(() => root.render(createElement(Fixture, props)));
};
const button = (label) => {
  const element = Array.from(document.querySelectorAll("button")).find(
    (candidate) => candidate.getAttribute("aria-label") === label || candidate.textContent === label
  );
  assert.ok(element, `Missing button: ${label}`);
  return element;
};
const click = async (element) => {
  await act(() => element.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true })));
  await act(() => element.dispatchEvent(new dom.window.MouseEvent("mouseup", { bubbles: true })));
  await act(() => element.click());
};
const menus = () => Array.from(document.querySelectorAll('[role="menu"]'));
const contextIsOpen = () =>
  document.querySelector('[data-context-menu="true"]').parentElement.className.includes("pointer-events-auto");

afterEach(async () => {
  if (root) await act(() => root.unmount());
  root = undefined;
});
after(() => {
  dom.window.close();
  for (const [name, descriptor] of previousGlobals) {
    if (descriptor) Object.defineProperty(global, name, descriptor);
    else delete global[name];
  }
});

for (const portalled of [false, true]) {
  test(`opening another card closes the first menu (portalled: ${portalled})`, async () => {
    await render({ portalled });
    await click(button("Actions A"));
    assert.equal(menus().length, 1);
    await click(button("Actions B"));
    assert.equal(menus().length, 1);
    assert.match(menus()[0].textContent, /Open B/);
  });

  test(`opening card details closes the selected menu even when propagation stops (portalled: ${portalled})`, async () => {
    const closed = [];
    await render({ portalled, onClose: (id) => closed.push(id) });
    await click(button("Actions A"));
    await click(button("Open A"));
    assert.ok(document.querySelector('[aria-label="Card details"]'));
    assert.equal(menus().length, 0);
    assert.deepEqual(closed, ["A"]);
  });
}

test("coaching card clicks preserve peek while dismissing the previous card menu", async () => {
  await render({ stopMouseDownPropagation: false });
  await click(button("Card body"));
  await click(button("Actions A"));
  assert.ok(document.querySelector('[aria-label="Card details"]'));
  await click(button("Actions B"));
  assert.ok(document.querySelector('[aria-label="Card details"]'));
  assert.equal(menus().length, 1);
  assert.match(menus()[0].textContent, /Open B/);
  const outside = document.createElement("button");
  document.body.append(outside);
  try {
    await click(outside);
    assert.equal(document.querySelector('[aria-label="Card details"]'), null);
    assert.equal(menus().length, 0);
  } finally {
    outside.remove();
  }
});

test("legacy protected popovers still keep peek open", async () => {
  await render({ stopMouseDownPropagation: false });
  await click(button("Card body"));
  const popover = document.createElement("button");
  popover.setAttribute("data-prevent-outside-click", "true");
  document.body.append(popover);
  try {
    await click(popover);
    assert.ok(document.querySelector('[aria-label="Card details"]'));
  } finally {
    popover.remove();
  }
});

test("clicking the card body opens peek and closes its menu", async () => {
  await render();
  await click(button("Actions A"));
  await click(button("Card body"));
  assert.ok(document.querySelector('[aria-label="Card details"]'));
  assert.equal(menus().length, 0);
});

test("moving keyboard focus to another card dismisses the previous menu", async () => {
  await render();
  await click(button("Actions A"));
  await act(() => button("Actions B").focus());
  assert.equal(menus().length, 0);
  await click(button("Actions B"));
  assert.equal(menus().length, 1);
});

test("action bubbling does not notify menu closure twice", async () => {
  const closed = [];
  await render({ stopActionPropagation: false, onClose: (id) => closed.push(id) });
  await click(button("Actions A"));
  await click(button("Open A"));
  assert.equal(menus().length, 0);
  assert.deepEqual(closed, ["A"]);
});

test("switching between three-dot and right-click menus does not leave both open", async () => {
  await render();
  await click(button("Actions A"));
  const card = button("Actions A").parentElement.parentElement;
  await act(() => card.dispatchEvent(new dom.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
  assert.equal(menus().length, 0);
  assert.equal(contextIsOpen(), true);
  await click(button("Actions B"));
  assert.equal(contextIsOpen(), false);
  assert.equal(menus().length, 1);
});

test("moving focus away dismisses a right-click menu", async () => {
  await render();
  const card = button("Actions A").parentElement.parentElement;
  await act(() => card.dispatchEvent(new dom.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
  assert.equal(contextIsOpen(), true);
  await act(() => button("Actions B").focus());
  assert.equal(contextIsOpen(), false);
});

test("right-clicking a different card closes the previous context menu", async () => {
  await render();
  for (const label of ["Actions A", "Actions B"]) {
    const card = button(label).parentElement.parentElement;
    await act(() => card.dispatchEvent(new dom.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    const openMenus = Array.from(document.querySelectorAll('[data-context-menu="true"]')).filter((element) =>
      element.parentElement.className.includes("pointer-events-auto")
    );
    assert.equal(openMenus.length, 1);
    assert.equal(openMenus[0].textContent, label === "Actions A" ? "Context open" : "Other context open");
  }
});

test("right-click actions close before card details are displayed", async () => {
  await render();
  const card = button("Actions A").parentElement.parentElement;
  await act(() => card.dispatchEvent(new dom.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
  await click(button("Context open"));
  assert.ok(document.querySelector('[aria-label="Card details"]'));
  assert.equal(contextIsOpen(), false);
});

test("a portalled submenu action closes both submenu and parent", async () => {
  const closed = [];
  root = createRoot(container);
  await act(() =>
    root.render(
      createElement(
        CustomMenu,
        { verticalEllipsis: true, ariaLabel: "Nested menu", closeOnSelect: true, onMenuClose: () => closed.push(true) },
        createElement(
          CustomMenu.SubMenu,
          { trigger: "More actions" },
          createElement(CustomMenu.MenuItem, { onClick: (event) => event.stopPropagation() }, "Nested action")
        )
      )
    )
  );
  await click(button("Nested menu"));
  const trigger = Array.from(document.querySelectorAll('[role="menuitem"]')).find(
    (element) => element.textContent === "More actions"
  );
  assert.ok(trigger);
  await click(trigger.firstElementChild);
  await click(button("Nested action"));
  assert.equal(menus().length, 0);
  assert.deepEqual(closed, [true]);
});

test("disabled actions leave the menu open and Escape closes it", async () => {
  await render();
  await click(button("Actions A"));
  await click(button("Disabled A"));
  assert.equal(menus().length, 1);
  await act(() =>
    button("Actions A").dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
  );
  assert.equal(menus().length, 0);
});

test("menus without closeOnSelect retain their existing behavior", async () => {
  await render({ closeOnSelect: false });
  await click(button("Actions A"));
  await click(button("Open A"));
  assert.equal(menus().length, 1);
});
