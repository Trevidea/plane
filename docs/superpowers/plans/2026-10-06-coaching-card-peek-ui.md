# Coaching Card Peek UI Implementation Plan

> Execute inline using superpowers:executing-plans. User explicitly requested implementation, restricted to UI changes.

**Goal:** Extend Plane's native peek with Kanavio card content while preserving the board.
**Architecture:** Retain the existing issue detail store, shell, API, editor, comments, and HLS player. Add coaching-specific content and a URL adapter; change no backend files.
**Tech Stack:** Next.js, React, MobX, SWR, @plane/ui, @plane/propel.
**Spec:** ../specs/2026-10-06-coaching-card-peek-design.md, superseded by the user's UI-only scope.

## Global Constraints

- UI changes only. Existing APIs are authoritative.
- Do not fake persistence for additional clips; expose the existing API limitation explicitly.
- Preserve native issue behavior and board scroll/filter state.
- No new dependencies or global state library.

## Review Focus

- Drag release and nested controls cannot activate peek.
- Direct links, Back, Forward, and close preserve other URL parameters.
- Missing workflow configuration does not permit invalid transitions.
- Failed saves retain edited notes; read-only roles cannot edit.
- Modal Escape/outside interaction does not close the underlying peek.

## Task 1: Selection and workflow model

Files: create peek-overview/coaching-card/model.ts and __tests__/model.test.ts; modify kanban/block.tsx and peek-overview/root.tsx; create coaching-card/use-coaching-peek-url.ts.

- [x] Write and run failing tests for URL preservation, UUID parsing, drag/control suppression, and sport-configured progress.
- [x] Implement pure helpers, card click guard, responsive coaching selection, and URL synchronization through the existing peek store.
- [x] Run the model tests.

## Task 2: Coaching content inside Plane peek

Files: create coaching-card/{root,properties,note,discussion}.tsx; modify peek-overview/{view,header,error}.tsx and frontend issue.service.ts types.

- [x] Compose title, roster summary, configured progress, editable properties, note editor, existing clip component, discussion and activity tabs.
- [x] Reuse assignment/stage dialogs, permission handling, native header and loading/error states.
- [x] Preserve explicit save/cancel and modal coordination; expose Add Clip limitation without a pretend saved clip.

## Task 3: Verification

- [x] Run new model tests and existing coaching workflow/clip model tests: 35 passed.
- [x] Run frontend typecheck and lint on affected files: typecheck passed; lint reports no errors and existing warnings.
- [x] Review changed files for UI-only scope, routing loops, focus restoration, responsive layout, and API compatibility.
- [x] Leave changes uncommitted for review.

## Review and regression results

- Preserved coaching metadata and roster fields in the existing frontend detail store; tested real `IssueStore.addIssueToStore` hydration.
- Kept the editor's editable state stable during note submission; browser regression reproduced the failed-save draft reset before the fix and verified draft retention afterward.
- Added optional `isClearable` to existing context selectors, disabled it for coaching fields that cannot be cleared through the current API, and protected portal interactions from peek outside-click dismissal.
- Browser fixture verified the real selection adapter, Back/Forward, direct links, refresh, close, board scroll, filters changed behind an open peek, clip dialog validation/Escape, and note save/cancel/failure. Stores/router and the note editor dependency are fixtures; this is not a full authenticated application walkthrough.
- No backend files or project dependencies changed. Additional clips remain preview-only because the existing API rejects evidence updates.
