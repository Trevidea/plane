import assert from "node:assert/strict";
import test from "node:test";
import type { IRosterPlayer } from "@plane/types";
import type { TCustomPlaylist, TCustomPlaylistClip } from "@/services/media-library.service";
// Node's type-stripping test runner requires explicit TypeScript extensions.
// @ts-expect-error See comment above.
import * as cardModel from "../create-card-model.ts";
import type { SgTagRow } from "../types";

const { buildCardPlaylists, buildCoachingCardPlaylists, getLinkedCardPlayers, getPositionGroups } = cardModel;

const playlist = (id: string, clips: TCustomPlaylistClip[]): TCustomPlaylist => ({
  id,
  name: id,
  clips,
  clip: clips.length,
  event_id: "event",
  url: "",
  thumbnail: "playlist.jpg",
});
const row = (id: string, overrides: Partial<SgTagRow> = {}): SgTagRow => ({
  id,
  action: "Run",
  clipId: id,
  clipEndSeconds: 18,
  clipStartSeconds: 10,
  context: {},
  groupValue: "Quarter 1",
  matrixParticipant: null,
  matrixPeriod: null,
  player: "12",
  playlistFallbackTimestamp: null,
  playlistTimestamp: "00:10-00:18",
  primaryDetail: "1st & 10",
  result: "Complete",
  secondaryDetail: "+10 yard",
  sourceTagId: id,
  sourceUrl: "",
  team: "home",
  thumbnailUrl: "current.jpg",
  timecode: "00:10-00:18",
  ...overrides,
});

test("card groups keep saved clip order and use exact event rows before source aliases", () => {
  const groups = buildCardPlaylists(
    [
      playlist("Selected playlist", [
        { id: "second", title: "Saved action", sourceTagId: "shared", startSeconds: 20, endSeconds: 24 },
        { id: "saved-first", title: "Saved first", sourceTagId: "first" },
      ]),
    ],
    [
      row("first", { sourceTagId: "shared" }),
      row("second", { action: "Kick off", sourceTagId: "shared" }),
      row("unrelated"),
    ]
  );
  assert.equal(groups.length, 1);
  assert.deepEqual(
    groups[0].clips.map((clip) => clip.title),
    ["Kick off", "Run"]
  );
  assert.deepEqual(
    groups[0].clips.map((clip) => clip.durationSeconds),
    [4, 8]
  );
  assert.equal(groups[0].clips[0].thumbnail, "current.jpg");
});

test("saved playlists can populate the card without matching event tags", () => {
  const [group] = buildCardPlaylists(
    [
      playlist("Saved playlist", [
        {
          id: "archived",
          title: "Penalty",
          durationSeconds: 4,
          team: "home",
          primaryDetail: "1st & 10",
          result: "Holding",
          tags: ["Holding", "1st & 10", "-10 yard"],
        },
      ]),
    ],
    []
  );
  assert.equal(group.clips[0].title, "Penalty");
  assert.equal(group.clips[0].durationSeconds, 4);
  assert.equal(group.clips[0].secondaryDetail, "-10 yard");
  assert.equal(group.clips[0].thumbnail, "playlist.jpg");
  assert.deepEqual(buildCardPlaylists([playlist("Empty playlist", [])], []), [
    { id: "Empty playlist", name: "Empty playlist", clips: [] },
  ]);
});

test("the same clip in two playlists keeps separate context keys", () => {
  const groups = buildCardPlaylists(
    [playlist("One", [{ id: "shared", title: "Run" }]), playlist("Two", [{ id: "shared", title: "Run" }])],
    []
  );
  const [one, two] = groups.map((group) => group.clips[0].key);
  assert.notEqual(one, two);
});

test("coaching card payload includes only selected playlists and clips", () => {
  const groups = buildCardPlaylists(
    [
      playlist("One", [
        { id: "first", title: "First" },
        { id: "second", title: "Second" },
      ]),
      playlist("Two", [{ id: "third", title: "Third" }]),
    ],
    []
  );

  const payload = buildCoachingCardPlaylists(groups, [{ id: "One", clipIds: ["second"] }]);

  assert.equal(payload.length, 1);
  assert.equal(payload[0].id, "One");
  assert.deepEqual(
    payload[0].clips.map((clip) => clip.id),
    ["second"]
  );
  assert.equal(payload[0].clips[0].duration_seconds, null);
  assert.equal(payload[0].clips[0].secondary_detail, "");
});

test("position groups come from distinct roster positions", () => {
  const players = [{ position: " Guard " }, { position: "guard" }, { position: "Forward" }, { position: null }];
  assert.deepEqual(getPositionGroups(players), ["Forward", "Guard"]);
});

test("card recipients include only linked active players, including legacy injured players", () => {
  const players: (Pick<IRosterPlayer, "status" | "user"> & { id: string; account_status?: string })[] = [
    { id: "linked", user: "account-1", account_status: "linked", status: "active" },
    { id: "missing-email", user: null, account_status: "email_missing", status: "active" },
    { id: "email-only", user: null, account_status: "not_linked", status: "active" },
    { id: "invited", user: null, account_status: "invitation_pending", status: "active" },
    { id: "legacy", user: "account-2", status: "injured" },
    { id: "inactive", user: "account-3", status: "inactive" },
    { id: "pending", user: "account-4", status: "pending" },
    { id: "removed", user: "account-5", status: "removed" },
    { id: "missing-link", account_status: "linked", status: "active" },
  ];
  assert.deepEqual(
    getLinkedCardPlayers(players).map((player) => player.id),
    ["linked", "legacy"]
  );
});

test("removing an account link removes the player from card recipients", () => {
  assert.deepEqual(getLinkedCardPlayers([{ id: "removed", user: null, status: "removed" }]), []);
  assert.deepEqual(getLinkedCardPlayers([]), []);
});
