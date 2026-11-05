import assert from "node:assert/strict";
import { test } from "node:test";
import { privateRecipients, privateMessage, privatePage, privateReply } from "../private-thread-model.ts";
const audience = { visibility: "private", issue: "card", coach_id: "coach", recipient_id: "player" };
const message = {
  ...audience,
  id: "message",
  actor: "player",
  actor_detail: { id: "player", display_name: "Player" },
  access: "PRIVATE",
  comment_stripped: "Private text",
  created_at: "2026-11-03T00:00:00Z",
};
test("coach decoder rejects shared, foreign recipient and foreign coach messages", () => {
  assert.equal(privateMessage(message, "card", "coach", "player").text, "Private text");
  for (const change of [
    { visibility: "shared" },
    { recipient_id: "other" },
    { coach_id: "other" },
    { actor: "other" },
    { issue: "other" },
    { access: "EXTERNAL" },
  ])
    assert.throws(() => privateMessage({ ...message, ...change }, "card", "coach", "player"));
});
test("coach selector requires its own verified private card audience", () => {
  const value = { ...audience, recipients: [{ id: "player", name: "Player" }] };
  assert.equal(privateRecipients(value, "card", "coach").length, 1);
  assert.throws(() => privateRecipients(value, "card", "another-coach"));
});
test("private message pages enforce participant identity, count and offset", () => {
  const value = { ...audience, limit: 50, offset: 0, total_count: 1, results: [message] };
  assert.equal(privatePage(value, "card", "coach", "player", 0).total, 1);
  assert.throws(() => privatePage(value, "card", "coach", "other", 0));
  assert.throws(() => privatePage({ ...value, total_count: 0 }, "card", "coach", "player", 0));
});
test("coach replies carry private visibility and escape markup", () => {
  assert.deepEqual(privateReply("<b> & coach"), {
    visibility: "private",
    comment_html: "<p>&lt;b&gt; &amp; coach</p>",
  });
  assert.throws(() => privateReply(" "));
  assert.throws(() => privateReply("a".repeat(301)));
});
