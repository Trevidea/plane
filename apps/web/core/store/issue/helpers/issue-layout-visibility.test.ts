import assert from "node:assert/strict";
import test from "node:test";

// Node's type-stripping test runner requires explicit TypeScript extensions.
// @ts-expect-error See comment above.
import { isIssueVisibleInLayout } from "./issue-layout-visibility.ts";

test("Service Gateway issues are visible only in calendar", () => {
  const eventIssue = { sg_event_id: 1234 };

  assert.equal(isIssueVisibleInLayout(eventIssue, "calendar"), true);
  assert.equal(isIssueVisibleInLayout(eventIssue, "kanban"), false);
  assert.equal(isIssueVisibleInLayout(eventIssue, "list"), false);
  assert.equal(isIssueVisibleInLayout(eventIssue, "spreadsheet"), false);
  assert.equal(isIssueVisibleInLayout(eventIssue, "gantt_chart"), false);
});

test("regular issues are excluded from calendar and retained in other layouts", () => {
  for (const sgEventId of [null, undefined, ""]) {
    const regularIssue = { sg_event_id: sgEventId };

    assert.equal(isIssueVisibleInLayout(regularIssue, "calendar"), false);
    assert.equal(isIssueVisibleInLayout(regularIssue, "kanban"), true);
  }
});

test("issues remain visible while a layout has not been initialized", () => {
  assert.equal(isIssueVisibleInLayout({ sg_event_id: 1234 }, undefined), true);
});
