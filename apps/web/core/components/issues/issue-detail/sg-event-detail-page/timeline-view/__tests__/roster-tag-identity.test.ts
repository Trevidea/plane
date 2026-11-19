import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's type stripping requires an explicit extension.
import { getTagRosterMembers, getRosterMemberLabel, getNestedRosterContext } from "../../roster-tag-identity.ts";
const member = { id: "11111111-1111-4111-8111-111111111111", jersey: "7" };
test("account deletion resolves the retained UUID to Former player and the historical jersey", () => {
  assert.equal(getRosterMemberLabel(member, new Map([[member.id, "Former player"]])), "Former player, #7");
});
test("unknown historical UUID never borrows a replacement jersey owner name", () => {
  assert.equal(
    getRosterMemberLabel(member, new Map([["22222222-2222-4222-8222-222222222222", "Replacement"]])),
    "Player, #7"
  );
});
test("malformed references cannot manufacture named historical players", () => {
  assert.deepEqual(getTagRosterMembers({ roster_members: "{oops" }), []);
  assert.deepEqual(
    getTagRosterMembers({ roster_members: JSON.stringify({ rosters: { id: "not-a-uuid", jersey: "7" } }) }),
    []
  );
});

test("Phase1 object context retains the same stable roster references as gateway string pins", () => {
  const references = { rosters: member };
  assert.equal(getNestedRosterContext({ context: { roster_members: references } }), JSON.stringify(references));
});
