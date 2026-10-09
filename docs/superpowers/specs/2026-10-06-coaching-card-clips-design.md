# Coaching Card Clips

Status: implemented in the workspace on October 6, 2026. See the implementation plan ledger for validation evidence. The running API image requires a rebuild to activate the new endpoints.

## Intent

Coaches need all video evidence for one Coaching Card in a single native Plane section: original film, practice checks, verification, teaching, references, and other footage. Video is the centerpiece, with one active preview and compact selectable rows. Additions and edits must survive closing and reopening the card. Changes must work at every lifecycle stage without advancing that stage.

This feature extends the existing Coaching Card peek and full detail integrations. It includes durable clip management, reusable types, source selection, notes, contextual metadata, professional playback controls, loading/error/empty states, and responsive behavior. It does not implement drawing, voice annotation, transcoding, or new playback libraries.

## Existing implementation and boundaries

- `apps/web/core/components/issues/issue-detail/coaching-card-clips.tsx` already renders a selected player, compact rows, filters, sorting, and a removal dialog. Its mutations only modify local drafts.
- `coaching-card-add-clip.tsx` currently selects from clips already attached to the card and accepts video URLs. Its current playback buttons sample a paused player, so they do not support marking a moving range effectively.
- `coaching-card-clip-player.tsx` wraps `ce/features/media-library/components/hls-video.tsx`, which owns hls.js creation and destruction. Keep this single playback implementation.
- `packages/types/src/issues/issue.ts` defines Coaching Card playlists and clips. Existing snapshots lack the richer metadata contract.
- `apps/api/plane/app/views/issue/coaching_card.py` validates initial clips, but its detail PATCH rejects playlist/evidence mutations. Use dedicated clip endpoints rather than replacing the entire snapshot through issue updates.
- `peek-overview/coaching-card/root.tsx` integrates the Clips component with issue fetch, modal coordination, and lifecycle operations.
- Existing uncommitted changes are user work. Preserve them and make targeted changes in place; do not reset or stage unrelated files.

The earlier peek specification describes a frontend-only implementation. This new specification covers the newly requested durable Clips feature; it does not reopen unrelated peek work.

## Architecture choice

Extend the existing card playlist snapshot with validated clip metadata and dedicated transactional mutations. This preserves current evidence rendering and avoids a parallel clip store. A standalone database clip model would support independent querying, but would require a migration and synchronization with existing snapshots without a current product need.

Separate responsibilities into shared clip types/configuration, a normalization/model module, a durable mutation service, section composition, add/edit dialog, and the existing selected-player wrapper. Do not create a second drawer, editor, notification system, or HLS loader.

## Durable clip contract

Retain existing snake_case API fields and playlist containers. Add optional metadata to `TCoachingCardClip` and its server serializer:

- `clip_type`, `source_type`, `source_name`, `event_name`, `period`, `game_clock`.
- `stream_id`, `start_segment`, `end_segment`, and an explicit playback coordinate mode.
- Server-owned `created_by` (identity/name snapshot) and `created_at`.
- `note`, `player_ids`, `position_group_ids`, and `tags`.
- A stable card association identity distinct from upstream clip/media identity.

Existing `source_url`, `event_id`, `start_seconds`, `end_seconds`, `duration_seconds`, and `thumbnail` remain compatible. Normalize these into the existing frontend detail model at one boundary; remove ad hoc casts that read nonexistent camelCase properties from API clips. Legacy clips receive display defaults without destructive rewriting. Unknown future clip types render a readable neutral label in the Other group.

The shared registry contains original, game_film, practice_check, verified_on_film, coach_added, player_submitted, reference, teaching, scout, and comparison. Each entry has a label and group; optional icons/descriptions use existing icon exports and Plane semantic theme tokens. Adding a type changes the registry and serializer validation rather than scattered presentation conditions.

Stored source coordinates and playback coordinates are distinct. A full source video uses the stored start/end boundaries; a generated clipped playlist starts playback at zero and uses the clip duration. Preserve this explicitly rather than guessing from media duration. Resolve stream/segment references through Kanavio's existing dynamic playlist facilities; never generate media copies. Existing uploaded-media file resolution stays scoped to the matching artifact.

## Mutation API

Add endpoints beneath the existing project Coaching Card resource:

- POST clips: append one association, returning the updated card.
- PATCH clips/{association_id}: update details, type, note, or replacement source.
- DELETE clips/{association_id}: detach evidence from this card only.

Use existing project permission conventions, reject archived/deleted/non-coaching cards, and allow authorized coaches to mutate clips at any configured stage. Validate same-project referenced sources and roster IDs. Accept external HTTP/HTTPS video URLs without server-side fetching; reject unsupported schemes and malformed intervals. Require finite nonnegative timestamps and an end after start when a bounded interval is supplied. Derive bounded duration on the server. Stream-based ranges must use the existing valid segment contract.

Lock the card row transactionally, read its latest snapshot, mutate only the identified association, and preserve all unrelated card fields. Use a client request identity to make append retries idempotent. Creation identity/time come from the authenticated server context and remain unchanged by edits. Reject missing association IDs cleanly.

Update playlist counts, clip counts, and primary summary references consistently. If the primary association is removed, select the earliest remaining association as primary; clear primary metadata when none remain. Removing or replacing an association never deletes its original media, changes review state, or advances lifecycle stage. Record real clip mutations using the existing issue activity infrastructure.

On successful mutation, refresh/update the selected issue through the existing store and notify existing board summary refresh infrastructure. Keep the dialog open with entered values on failure and show Plane toast/inline error feedback. Disable duplicate submissions and destructive confirmation while pending. Do not claim success until the server responds.

## Section and interactions

Following the user's placement correction, put all card clips in a dedicated Clips tab beside Overview, Discussion, and Activity. Overview retains workflow, coaching note, and properties. A direct clip link opens the Clips tab. Preserve title/assignment. The section uses Plane buttons, tooltips, menus, badges, selectors, dialogs, loading primitives, editor patterns, and text/background/border tokens.

Show the Clips header with Add clip, selected title and type/source/period/clock, one responsive 16:9 player, compact property-row details, optional note/tags, and the clip list. Rows contain a lazy thumbnail/play affordance, title, type/source, period/clock, source range and duration, author/date, tags, and overflow actions. Selection uses Plane selected/focus styling and keyboard activation. Switching rows only updates active player state and metadata, without fetching or remounting the entire detail view.

Default ordering is oldest first with stable ordering for equal/missing legacy dates. Provide newest, type, and source sorting. Show group filters only above two clips; groups are All, Game Film, Practice, Verification, Reference, and Other. Keep selection stable during filtering and mutations; if the selected association is removed, select the next available item or show the empty state.

Overflow actions include Open clip, Edit details, Change clip type, Copy link, Replace clip, and Remove from card. Reuse the editing dialog for type changes and replacement. Copy a link representing the selected bounded clip, not an unbounded full source where that would lose the evidence range. Show Download only if an existing supported download source/action is available. Open full player uses the current player fullscreen capability.

Removal uses Plane's danger confirmation with: “This clip will be removed from this coaching card. The original video will not be deleted.” Keep the row until deletion succeeds.

## Add/edit and fast marking

The Plane modal has type, source selection, start, end, title, optional metadata, and coach note. Reuse the existing project media/event source picker patterns to select footage beyond clips already attached to this card. Existing attached sources and external URL entry remain available. Use source identities consistently as select values and reset inherited source metadata/range when switching sources.

Add a small Set start / Set end action pair beside the active player controls, with an optional captured-range summary. These capture the moving video's current source coordinate without opening or pausing a dialog. Add clip opens with the captured range/source. Retain captured inputs on a failed save, clear after a successful append or explicit cancellation, and reset them when switching sources. The dialog also supports Use current playback position. For generated clipped playlists, translate local playback time into original source coordinates explicitly.

Use Plane's existing editor integration for coach notes, including edit/save/cancel behavior and plain-text normalization consistent with current coaching notes. Notes belong to individual clip associations, independently of the card's coaching note.

## Player behavior

Reuse `HlsVideo`, with a stable error callback and exactly one mounted selected video. Destroy the previous HLS instance on source switch, retry, and unmount. Preserve user volume/mute/speed across clip switches while resetting playback position to the selected clip start. Use HLS/LL-HLS handling from the existing implementation; do not add libraries. Retain native supported fallback.

Controls include play/pause, seek, volume/mute, elapsed/duration, replay, ±5 seconds, fullscreen, supported picture-in-picture, and 0.25x/0.5x/0.75x/1x/1.25x/1.5x/2x speed. Precision controls seek ±0.1 seconds and are labeled as time steps, never frames. Bound seeking and playback to the selected range. Do not autoplay on initial detail open; explicit row activation plays its selected clip.

Keep a stable aspect-ratio area with Plane loader and Loading video text during manifest loading. Show clean error messaging and Retry, avoiding raw HLS errors. Design the timeline with an optional marker collection interface for future annotation renderers, without shipping annotation tools. Disable unusable controls until ready. Support keyboard focus and accessible labels for all controls.

## Responsive and theme behavior

Use the existing full-width Card Detail layout at narrow breakpoints. Inside the section use full-width aspect-video media, wrapping controls, reduced secondary metadata, and overflow actions. Keep the drawer's existing scroll/focus/modal coordination. Menus opened in fullscreen must remain accessible within its presentation. Use Plane tokens in both light and dark themes, with no custom palette.

## Verification and completion

Add meaningful API tests for append/edit/remove persistence, idempotency, concurrent preservation, permissions/project boundaries, interval validation, primary removal, and unchanged lifecycle/review/media. Add model tests for legacy normalization, all/future types, stable identities, filtering/sorting, and full-source versus clipped-playlist coordinates.

Use the existing browser harness for selection, single HLS lifecycle, speed/play/pause/seek/volume/replay, loading/retry/error, start/end capture, mutation failure retention, confirmation, and reopen persistence. Exercise keyboard access, modal/peek coordination, narrow/fullscreen layouts, and both themes. Verify real playable HLS footage when available; mocked control tests alone cannot establish real manifest playback.

Run focused tests, affected frontend lint/type checks, and backend checks. Report unavailable services or pre-existing failures explicitly. Completion requires durable clip management, one selected preview, the requested controls and metadata, native Plane states/actions, and verified responsive/theme behavior. No product implementation is claimed by this specification.
