import assert from "node:assert/strict";
import test from "node:test";

// The Node test bundle preserves explicit TypeScript extensions.
// @ts-expect-error The production module is imported with its source extension for the test runner.
import { getCalendarCardTextLayout } from "../card-layout.ts";

test("calendar cards keep the work item ID on one line while truncating the title", () => {
  assert.deepEqual(getCalendarCardTextLayout(), {
    identifier: "flex-shrink-0 whitespace-nowrap",
    title: "min-w-0 flex-1 truncate",
  });
});
