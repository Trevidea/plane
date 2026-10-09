# Coaching Card Clips Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persist and manage all Coaching Card clip evidence through one native Plane section and selected HLS player.

**Architecture:** Extend the existing playlist snapshot with association identities and metadata. Dedicated transactional endpoints preserve unrelated card state. Existing Plane components and HlsVideo remain the UI/playback foundations.

**Tech Stack:** Django REST Framework, React, TypeScript, Plane UI, hls.js.

**Spec:** `docs/superpowers/specs/2026-10-06-coaching-card-clips-design.md`

## Global Constraints

- One active video; no new player library or transcoding.
- Plane components/theme tokens; preserve existing uncommitted work.
- Clip mutations preserve stage, review, and original media.
- Native execution in the current workspace, as requested by the user.

## Review Focus

- Legacy duplicate upstream IDs require distinct stable association identities.
- A generated playlist uses local playback coordinates rather than original-video timestamps.
- A failed save must retain user input and a retry identity.
- Deleting the primary association must not resurrect it through primary metadata.
- Changing sources must not leave old range/metadata or extra HLS instances.

### Task 1: Durable clip contract and API

Files: `apps/api/plane/utils/coaching_card_clips.py`, `apps/api/plane/app/views/issue/coaching_card.py`, `apps/api/plane/app/urls/issue.py`, `packages/types/src/issues/issue.ts`, unit and contract tests.

Interfaces: `mutate_card_clips(data, operation, values, actor, created_at, association_id=None) -> dict`; POST/PATCH/DELETE under `coaching-cards/{card_id}/clips/` returns the current card response.

- [x] Write/run failing unit tests for preserved lifecycle, idempotent append, metadata edits, primary removal, and invalid intervals.
- [x] Implement isolated snapshot mutation and validation helpers, serializer, permission checks and locked endpoints.
- [x] Add API contract tests for durable operations, stage preservation, authorization, and missing associations.
- [x] Run unit tests and available backend checks; record environmental limits.

### Task 2: Native persisted section and add/edit dialog

Files: existing `coaching-card-clips-model.ts`, `coaching-card-clips.tsx`, `coaching-card-add-clip.tsx`, `core/services/issue/issue.service.ts`, frontend model tests.

Interfaces: `saveCoachingCardClip` and `removeCoachingCardClip`; API normalization maps durable snake_case metadata into the existing detail model.

- [x] Write/run failing tests for metadata normalization, stable IDs and explicit playback coordinates.
- [x] Replace local drafts with server mutation state and store refresh; keep confirmation/input on failure.
- [x] Reuse project media library queries and source resolution in the modal; retain existing-source and URL options.
- [x] Add contextual metadata, notes/tags, native empty/loading states and compact rows.
- [x] Verify focused model tests and frontend lint/types.

### Task 3: Player integration and fast range capture

Files: existing `coaching-card-clip-player.tsx`, `ce/features/media-library/components/hls-video.tsx`, browser tests.

Interfaces: player reports source-coordinate playback position and exposes Set start/end callbacks; optional timeline markers are data only.

- [x] Add browser tests using the actual section/dialog/player with isolated API/media fixtures.
- [x] Keep one HLS instance, explicit HLS source detection, correct range boundaries, source switching and preserved settings.
- [x] Integrate fast range capture, retry, fullscreen, speed, precision seek and optional PiP.
- [x] Verify browser controls, selection, error/retry, persistence, confirmation, keyboard, narrow layouts and themes.
- [x] Review the final diff and report completed behavior and verification limits.

## Execution ledger

User requested implementation directly after the specification. Proceed inline without another approval gate. Existing dirty changes are required context, so work in place and do not commit unrelated edits.


Task 1: complete — 11 clip snapshot tests and 7 Django/PostgreSQL API tests passed. API tests loaded the workspace code into an isolated process in the existing API container and created/dropped a temporary test database; deployed source was not changed.
Task 2: complete — 39 related Node model tests passed; full web TypeScript check and focused lint verification recorded below after the final pass.
Task 3: complete — real generated HLS playback browser checks passed for one instance, clip switching, speed, seek, volume/mute, fullscreen menu, precision steps, range capture, save failure/retry, persisted reopen, confirmed removal, clean video error/retry and empty state. Existing peek browser regression also passed.
Final review: independent clips_review agent identified four important issues. Fixed all four with failing-to-passing regressions: explicit source identity clearing, legacy primary source/range preservation, stale duration removal, and rejection of out-of-bounds explicit source ranges. A subsequent duplicate-upstream association regression also passed.
Final: Ruling: source-backed associations extend the current card snapshot rather than introducing a database model — keeps existing consumers compatible; independent querying would require a later migration.
Final: Ruling: existing user work requires in-place execution — no unrelated changes were reverted or committed. Product changes remain reviewable in the current workspace.

Final verification: full web `tsc --noEmit --incremental` passed with no diagnostics; focused frontend lint passed with no warnings/errors; types and UI packages built successfully. Python syntax checks and `git diff --check` passed. Related suites: 39 Node tests, 25 Python unit tests, 6 lifecycle utility tests, 7 isolated PostgreSQL API tests, and both Clips/peek browser harnesses passed.

Broader check limitation: the standalone `packages/ui` type check reports existing TS7016/TS7006/TS7031 errors in `src/sortable/draggable.tsx` and `src/sortable/sortable.tsx` due to missing Atlaskit CJS declarations. Those files were not changed. No diagnostics concern the fullscreen selector change.

Activation: the API container has no source bind mount; rebuild the API image through the normal deployment workflow to activate the new endpoints. No deployed source was modified during testing.
