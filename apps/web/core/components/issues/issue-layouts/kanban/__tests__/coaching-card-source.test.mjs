import assert from "node:assert/strict";
import test from "node:test";
import { getCoachingCardSource } from "../coaching-card-source.ts";

test("uploaded cards link to media even without a source event", () => {
  const card = { source_issue: null, source_media: { artifact_id: "video 1", title: "Practice" } };
  assert.deepEqual(getCoachingCardSource(card, "team", "project", "BALL"), {
    label: "Uploaded video",
    title: "Practice",
    href: "/team/projects/project/media-library/video%201",
  });
  assert.equal(
    getCoachingCardSource({ ...card, source_issue: { sequence_id: 12, name: "Event" } }, "team", "project").title,
    "Practice"
  );
});

test("event cards retain their source label and missing sources do not crash", () => {
  assert.deepEqual(
    getCoachingCardSource({ source_issue: { sequence_id: 12, name: "Event" } }, "team", "project", "BALL"),
    {
      label: "Source BALL-12",
      title: "Event",
      href: null,
    }
  );
  assert.equal(getCoachingCardSource({ source_issue: null }, "team", "project").href, null);
});
