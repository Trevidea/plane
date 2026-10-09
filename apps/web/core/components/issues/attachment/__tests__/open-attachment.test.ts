import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's type-stripping runner requires explicit extensions.
import { openAttachment } from "../open-attachment.ts";

test("an accessible attachment opens the resolved storage URL", async () => {
  const tab = { location: { href: "about:blank" }, opener: {}, close() {} };
  await openAttachment(
    "/api/asset/",
    () => tab,
    async () => "https://storage.example/video.mp4"
  );
  assert.equal(tab.location.href, "https://storage.example/video.mp4");
  assert.equal(tab.opener, null);
});

test("an unfinished upload closes its tab and reports the error without opening the API error page", async () => {
  let closed = false;
  const tab = {
    location: { href: "about:blank" },
    opener: {},
    close() {
      closed = true;
    },
  };
  await assert.rejects(
    openAttachment(
      "/api/asset/",
      () => tab,
      async () => {
        throw new Error("The asset is not uploaded.");
      }
    )
  );
  assert.equal(closed, true);
  assert.equal(tab.location.href, "about:blank");
});

test("a blocked popup reports an error instead of claiming the attachment opened", async () => {
  await assert.rejects(
    openAttachment(
      "/api/asset/",
      () => null,
      async () => "https://storage.example/file"
    ),
    /pop-ups/
  );
});
