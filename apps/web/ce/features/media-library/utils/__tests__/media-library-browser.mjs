import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const require = createRequire(path.join(web, "package.json"));
const { build } = require(process.env.ESBUILD_PACKAGE_PATH || "esbuild");
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE_PATH || "playwright");
const temp = await mkdtemp(path.join(tmpdir(), "media-library-browser-"));
await writeFile(
  path.join(temp, "fixture.tsx"),
  `
import { createRoot } from "react-dom/client";
import { MediaListView } from ${JSON.stringify(path.join(web, "ce/features/media-library/components/media-list-view.tsx"))};
import { MediaCard } from ${JSON.stringify(path.join(web, "ce/features/media-library/components/media-card.tsx"))};
const base = { packageId: "package", description: "", title: "Upload", createdAt: "Today", views: 0, itemsCount: 1, primaryTag: "", secondaryTag: "", docs: [], duration: "", thumbnail: "/poster.svg", meta: {}, format: "m3u8", mediaType: "video", id: "upload" };
const event = { ...base, id: "event", title: "Event", mediaType: "document", format: "json", meta: { artifact_type: "completed-event-json" } };
const items = [base, event, { ...base, id: "pending", title: "Pending", isTranscodeActive: true }, { ...base, id: "document", title: "Document", mediaType: "document", format: "pdf" }];
const href = (item) => "/team/projects/project/media-library/" + item.id + "?from=" + encodeURIComponent("/team/projects/project/media-library/section/Events?view=list");
createRoot(document.getElementById("root")).render(<><p id="selectable">Useful selectable description</p><MediaListView sections={[{ title: "Media", items }]} getItemHref={href}/><div id="cards"><MediaCard item={base} href={href(base)}/><MediaCard item={event} href={href(event)}/></div></>);
`
);
const stub = `import React from "react";
export const ImageWithFallback = ({ src, ...props }) => <img src={src} {...props}/>;
export const Tag = ({ children, ...props }) => <span {...props}>{children}</span>;
export const ETagSize = { SM: "sm" }; export const ETagVariant = { OUTLINED: "outlined" };
export const Table = (p) => <table {...p}/>; export const TableBody = (p) => <tbody {...p}/>; export const TableCell = (p) => <td {...p}/>; export const TableHead = (p) => <th {...p}/>; export const TableHeader = (p) => <thead {...p}/>; export const TableRow = (p) => <tr {...p}/>;
export const useVideoDuration = () => ({ durationLabel: "", setVideoDuration() {} });
export const API_BASE_URL = "";
export const usePathname = () => "/team/projects/project/media-library/section/Events";
export const useSearchParams = () => new URLSearchParams("view=list");
export default function Link({ href, children, src, ...props }) { return src ? <img src={src} {...props}/> : <a href={href} {...props}>{children}</a>; }
`;
await writeFile(path.join(temp, "stub.tsx"), stub);
const bundle = await build({
  absWorkingDir: web,
  entryPoints: [path.join(temp, "fixture.tsx")],
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  define: { "process.env": "{}" },
  nodePaths: [path.join(web, "node_modules")],
  plugins: [
    {
      name: "fixture-dependencies",
      setup(build) {
        build.onResolve(
          {
            filter:
              /^(next\/link|next\/navigation|@plane\/ui|@plane\/propel\/table|@\/components\/common\/image-with-fallback|.*hooks\/use-video-duration)$/,
          },
          () => ({ path: path.join(temp, "stub.tsx") })
        );
      },
    },
  ],
});
const server = createServer((req, res) => {
  if (req.url === "/bundle.js") {
    res.setHeader("Content-Type", "text/javascript");
    res.end(bundle.outputFiles[0].text);
  } else if (req.url === "/poster.svg") {
    res.setHeader("Content-Type", "image/svg+xml");
    res.end(
      '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="green"/></svg>'
    );
  } else {
    res.end(
      '<html><head><style>.select-none{user-select:none}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>'
    );
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage();
  page.on("pageerror", (error) => console.error(error.message));
  await page.goto(
    `http://127.0.0.1:${server.address().port}/team/projects/project/media-library/section/Events?view=list`
  );
  await page.waitForSelector("table");
  const uploadLink = page.locator("table tbody tr:first-child td:first-child a");
  assert.equal(
    new URL(await uploadLink.getAttribute("href"), page.url()).searchParams.get("from"),
    "/team/projects/project/media-library/section/Events?view=list"
  );
  assert.equal(
    await page.locator("#cards").getByText("Event", { exact: true }).count(),
    2,
    "event source badge supplements the title"
  );
  assert.equal(
    await page.locator("#cards").getByText("Upload", { exact: true }).count(),
    2,
    "upload source badge supplements the title"
  );
  for (const selector of ["table tbody tr:first-child td:first-child a", "#cards a:first-child"]) {
    const link = page.locator(selector);
    assert.equal(await link.evaluate((el) => getComputedStyle(el).userSelect), "none");
    assert.equal(
      await link.evaluate((el) => {
        const e = new Event("dragstart", { bubbles: true, cancelable: true });
        el.querySelector("img").dispatchEvent(e);
        return e.defaultPrevented;
      }),
      true
    );
  }
  assert.notEqual(await page.locator("#selectable").evaluate((el) => getComputedStyle(el).userSelect), "none");
  console.log(
    "PASS Media Library existing row routes, event/upload source badges, and scoped selection/drag prevention"
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
