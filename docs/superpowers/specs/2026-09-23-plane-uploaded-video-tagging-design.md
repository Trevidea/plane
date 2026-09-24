# Plane Uploaded-Video Tagging Design

## Purpose

Add the Plane Coach tagging experience to Plane for videos that have already been uploaded to the Plane Media Library or attached to event media. The workspace must preserve Plane Coach's configuration-driven actions, pinned context, roster selection, radial interaction, and tag display behavior while using Plane's existing video playback, navigation, permissions, and media identity.

This feature is for coaches and project members reviewing recorded video on desktop and tablet. It succeeds when a user can open an uploaded video, enter tagging mode, create action tags at the exact playback position with a snapshot of persistent context, and later reopen, seek, edit, delete, undo, and redo those tags.

## Scope

### Included

- A `Tag Video` entry point on supported uploaded-video detail pages.
- A focused tagging workspace built around Plane's existing Media Library video element and Video.js player.
- Dynamic sport configuration loaded through Plane and normalized with the Plane Coach domain model.
- Persistent pinned context with select, player, number, text, score/team, and toggle inputs as described by the sport configuration.
- The Plane Coach Kando-style radial action menu, including nested quick-input menus and viewport clamping.
- Project roster selection using stable roster-player IDs and immutable display snapshots.
- Timestamped action-tag creation using the media element's `currentTime`.
- Native Plane persistence keyed primarily by the uploaded media artifact.
- Optimistic creation, visible save status, retry/removal after failed creates, and rollback after failed updates or deletes.
- Tag markers, tag list, seeking, selection, metadata viewing, editing, and confirmed deletion.
- Undo and redo for create, update, delete, and pin changes.
- Keyboard controls that do not activate while the user is editing an input.
- Desktop, laptop, and iPad-sized responsive layouts.

### Explicitly excluded

- RTMP ingest or encoder setup.
- Live streams, LL-HLS camera previews, HLS dump initiation, or live event timing.
- Camera validation, claiming, joining, selection, or device lifecycle state.
- Streaming-device sockets or tag synchronization through service-gateway sessions.
- `CLAIMED`, `VALIDATED`, `DUMPING`, or `CLOSED` device workflows.
- Setup-before-event screens.

## Existing Implementations to Reuse

### Plane Coach source material

The following Plane Coach areas are the behavioral reference and should be ported where they are independent of live streams:

- `lib/domain/sport-config/`: sport types, normalization, initial state, HUD descriptors, expressions, AutoCarry, quick inputs, and radial-menu construction.
- `lib/event-detail/kando/`: menu types, geometry, runtime tree, visual resolution, surface constants, icons, and pointer helpers.
- `components/event-detail/live-tagging/kando/`: radial surface and overlay interaction.
- `components/event-detail/live-tagging/pinned-tags/`: generic and sport-specific pinned HUD controls, player selectors, and responsive popovers.
- `lib/domain/events/sport-pinned-slot-config.ts`: sport-specific roster slot definitions.
- `lib/domain/events/coach-project-roster.ts` and `hooks/event-detail/live-tagging/use-project-roster.ts`: roster normalization and recent-player behavior.
- `lib/domain/events/coach-live-tags/`: display normalization and optimistic reconciliation patterns, adapted to Plane's native tag model.
- `lib/event-detail/live-tagging/live-tagging-layout.ts` and `stage-interactions.ts`: responsive layout and pointer/keyboard behavior where they do not assume live streams.

The following Plane Coach areas must not be ported: `use-live-stream-stage`, socket synchronization, stream/device selection, dump/session lifecycle, live clock endpoints, and service-gateway tag-session persistence.

### Plane integration points

- `apps/web/ce/features/media-library/components/media-detail-page.tsx` owns the existing uploaded-video player and focused-workspace state.
- `apps/web/ce/features/media-library/components/media-detail-preview.tsx` owns the video surface, player controls, and responsive player sizing.
- `apps/web/ce/features/media-library/components/player-ui.tsx` and Video.js remain responsible for playback.
- `apps/web/core/services/media-library.service.ts` establishes Media Library API conventions.
- `apps/web/core/services/roster.service.ts` supplies stable project roster records.
- `apps/web/core/components/issues/issue-detail/sg-event-detail-page/` supplies compatible tag-list, edit, timeline, formatting, and player-seeking patterns where those components can be reused without service-gateway coupling.
- `apps/api/plane/app/views/media_library.py` and `apps/api/plane/app/urls/media_library.py` establish nested Media Library resource and permission conventions.
- Plane's project `sport` field is the primary sport source. Media and issue/event sport metadata are fallbacks.

The two repositories are independent workspaces, so this change will not create a cross-repository package dependency. Generic Coach code will be ported into a focused Plane feature boundary with attribution in the implementation history. A future shared package can be created only after both applications can consume a separately versioned package without circular repository coupling.

## Architecture

### Frontend feature boundary

Create `apps/web/ce/features/video-tagging/` with focused subdirectories for components, domain logic, hooks, state, types, and tests. Export only the workspace entry point and public types from the feature index.

The Media Library detail page continues to own video creation and disposal. Tagging receives an adapter around the current player with these capabilities:

```ts
interface TaggingPlayerAdapter {
  getCurrentTime(): number;
  getDuration(): number | null;
  isPaused(): boolean;
  pause(): void;
  play(): Promise<void>;
  seek(seconds: number): void;
  subscribe(listener: (state: TaggingPlaybackState) => void): () => void;
}
```

This prevents a second timing source. Every marker, displayed time, seek operation, and created tag is based on the same underlying HTML media element/Video.js player.

The feature owns a workspace-scoped state container rather than application-global state. It tracks configuration, pins, tags, selected tag, save status, pause-on-tag preference, and bounded history. State is discarded when the media identity changes and rehydrated from the API on entry.

### Backend ownership

Tags are native Plane records. They do not depend on Kanavio game IDs, stream names, event devices, or tag sessions. Sport configurations may still be fetched from the configured Kanavio tagging service through authenticated Plane Next.js proxy routes, but tag persistence always goes to the Plane API.

### Sport configuration

Plane will expose proxy routes for sport discovery and sport configuration using the existing `getKanavioTaggingServiceBaseUrl` and header helpers. The client normalizes untrusted configuration before rendering it. An invalid or unavailable configuration produces a retryable tagging error without breaking ordinary video playback.

The selected sport is resolved in this order:

1. Project sport.
2. Media artifact metadata sport.
3. Associated issue or event sport.

If none is present, the entry flow asks the user to select from configured sports before the workspace initializes. The selection is workspace context; it does not silently rewrite the project.

## Data Model

Add a `MediaVideoTag` model following Plane's project-scoped model and soft-delete conventions.

Required fields:

- `workspace`: foreign key used for permission and tenant scoping.
- `project`: foreign key and roster/media scope.
- `package_id`: validated Media Library package identifier.
- `media_id`: validated Media Library artifact identifier and primary media relationship.
- `timestamp`: finite non-negative decimal/float seconds.
- `sport`: normalized sport identifier.
- `action`: JSON object containing at least stable `id` and display `label` strings.
- `pins`: JSON object containing the complete pin snapshot at creation/update time.
- `metadata`: JSON object for additional configuration-derived values.
- `created_by`: Plane user relation following existing audit conventions.
- inherited `created_at`, `updated_at`, and soft-deletion fields.

Optional fields:

- `roster_player`: nullable foreign key using `SET_NULL` so roster removal does not destroy tag history.
- `player_name` and `jersey_number`: immutable display snapshots updated only when the user explicitly changes the tag's player.
- `issue`: nullable issue foreign key constrained to the same project/workspace.
- `event_id`: optional string for external or imported event context; it is not required for CRUD.
- `notes`: text.

Index list queries by `(project, package_id, media_id, timestamp)` and validate all tenant/project relationships in the serializer or view before saving.

## API

Use Plane's nested Media Library route conventions:

```text
GET    /api/workspaces/:slug/projects/:projectId/media-library/packages/:packageId/artifacts/:mediaId/tags/
POST   /api/workspaces/:slug/projects/:projectId/media-library/packages/:packageId/artifacts/:mediaId/tags/
PATCH  /api/workspaces/:slug/projects/:projectId/media-library/packages/:packageId/artifacts/:mediaId/tags/:tagId/
DELETE /api/workspaces/:slug/projects/:projectId/media-library/packages/:packageId/artifacts/:mediaId/tags/:tagId/
```

`GET` uses current project-view permissions. Mutations use the same admin/member roles as Media Library edits. Before every operation, the API validates the project, package manifest, and target video artifact. A tag ID can only resolve within the path's project/package/media scope.

Create requests include timestamp, sport, action, pins, optional player ID, optional issue/event context, notes, and metadata. The server supplies identity, creator, timestamps, and player display snapshots. Patch mutates the existing record rather than creating a replacement. Delete uses Plane's soft-deletion behavior and returns a successful empty or confirmation response consistent with existing APIs.

## Workspace Behavior

### Entry and loading

Supported uploaded-video detail pages show `Tag Video`. The action is hidden for non-video artifacts and unavailable to users without mutation permission, while existing tags remain viewable according to project permissions.

Entering tagging mode performs these independent reads in parallel:

- Sport configuration.
- Project roster.
- Existing tags for the media artifact.

The workspace initializes its pin state from normalized configuration defaults after configuration succeeds. Existing tags never redefine the current pins. Roster failure is non-blocking and permits playerless tagging. Tag-load failure is retryable and blocks mutation until the existing state is known, preventing accidental overwrites or misleading history.

### Layout

- Header: Back, video title, sport, synchronization status, undo, and redo.
- Video: existing Plane media player, natural aspect ratio, and `object-contain` behavior.
- Controls: existing scrubbing plus play/pause and five-second seek actions.
- Marker layer: action markers positioned by `timestamp / duration`, keyboard accessible, and synchronized with list selection.
- Pinned HUD: compact, editable, and horizontally scrollable when it cannot wrap safely.
- Tagging surface: viewport-clamped radial menu and an accessible action-control fallback.
- Tag list: below the player on narrow/tablet layouts and alongside it when desktop width can preserve a useful video size.

The pinned HUD and controls stay outside the video surface. Popovers and the radial menu clamp to their owning workspace rather than the browser document.

### Pin behavior

Pin changes immediately update workspace state and history but never create a timestamped tag. Pin values support configuration-driven pickers, numbers, text, booleans, increment/decrement controls, team/score fields, and roster slots.

Every action tag receives a deep snapshot of the current pins. Later pin changes cannot mutate older tags. A selected roster player contributes its stable ID plus current name and jersey snapshot.

Coach AutoCarry rules that are deterministic from configuration and action context are retained. Live-clock commands and server-authoritative live-state hydration are removed; clock-shaped values are ordinary pinned fields for recorded video.

### Action creation

Selecting a leaf action:

1. Reads and clamps the existing video player's current time.
2. Deep-copies current pins and selected-player state.
3. Resolves sport and media/project context.
4. Adds a client tag with a collision-resistant temporary ID and `saving` status.
5. Renders the list row and marker immediately.
6. Sends the create request.
7. Reconciles the server identity and audit fields without changing the rendered row identity.

Pause-on-tag is a local workspace preference. Its initial value matches Plane Coach's current action-tag behavior. Toggling the preference does not affect stored tag data.

### Selection, editing, and deletion

Selecting a row or marker seeks the existing player to the tag timestamp and synchronizes selected styling across both views.

The edit dialog permits action, timestamp, player, pin snapshot, notes, and metadata changes. Timestamp is clamped to zero and, when known, video duration. Saving patches the same record.

Deletion always uses a confirmation dialog. Confirmed deletion removes the tag optimistically from the list and marker layer and sends a delete request. A failed delete restores the tag and selection.

### Undo and redo

History entries represent user intentions for create, update, delete, and pin change. Consecutive automatic playback ticks and API status changes never enter history. The bounded stack keeps the most recent 100 intentions.

- Undoing an unpersisted create removes it locally and ignores a late successful response by deleting the server record after reconciliation.
- Undoing a persisted create sends delete.
- Undoing an update sends a patch with the prior snapshot.
- Undoing a delete recreates the tag and accepts a new server ID while preserving UI selection identity.
- Pin undo/redo is local because pins are workspace context, not persisted action events.

Redo applies the inverse transition. While a history mutation is in flight, additional undo/redo commands are disabled. Failure restores the last confirmed state and leaves the history cursor unchanged.

### Keyboard and pointer interaction

- `Space`: play/pause.
- `Left Arrow`: seek backward five seconds.
- `Right Arrow`: seek forward five seconds.
- `Ctrl/Cmd + Z`: undo.
- `Ctrl/Cmd + Shift + Z`: redo.
- `Escape`: close the radial menu or active non-destructive popover.

Shortcuts are ignored when focus is in an input, textarea, select, contenteditable element, dialog requiring its own keyboard behavior, or a control using the same key. Pointer capture, drag thresholds, gesture navigation, nested menu behavior, and safe-center calculations come from Plane Coach's Kando implementation.

## Optimistic State and Failure Handling

Each tag exposes `saved`, `saving`, `unsaved`, `updating`, or `deleting` UI state without placing transport-only fields in the persisted model.

- Failed creation leaves the tag visible as `unsaved` with retry and remove actions and shows an error toast.
- Failed update restores the last confirmed snapshot and shows an error toast.
- Failed deletion restores the record at its prior sorted position and shows an error toast.
- Refresh always loads the server as authoritative; local unsaved tags are not represented as saved.
- Duplicate submit protection disables a radial leaf until its current pointer/click activation finishes, without preventing the same action at a later time.
- Late responses are guarded by media identity and operation IDs so navigating to another video cannot mutate its state.

The synchronization indicator summarizes outstanding mutations and failed creates. There is no socket synchronization requirement for this uploaded-video workspace.

## Responsive and Accessibility Requirements

- Preserve the video's intrinsic aspect ratio; never crop to fill the tagging layout.
- Keep a useful minimum player width before moving the list beneath it.
- Support desktop, laptop, iPad landscape, and iPad portrait where practical.
- Prevent the HUD, radial menu, and properties UI from covering playback controls.
- Clamp radial-menu geometry and popovers within the visible tagging workspace.
- Make rows, markers, radial fallback actions, popover controls, dialogs, and toolbar buttons keyboard accessible with visible focus.
- Provide text labels/tooltips in addition to color for save status and selected state.
- Respect reduced-motion preferences in radial transitions and marker animation.

## Compatibility

Tagging is additive to Media Library detail. Existing media listing, uploads, playback formats, view counting, playlists, staging clips, event detail, annotations, issue navigation, roster management, permissions, and player disposal behavior must remain unchanged outside tagging mode.

The annotation workspace and tagging workspace are mutually exclusive focused modes on the same player. Exiting either restores the normal media detail layout. Existing event artifacts may enter uploaded-video tagging only when they resolve to a supported uploaded video artifact; the tag's media identity remains the primary relationship.

## Testing Strategy

### Backend

- Model and serializer tests for valid records, defaults, JSON shape, finite/non-negative timestamps, and player snapshots.
- API tests for list/create/update/delete, project roles, guest read-only behavior, soft deletion, and audit fields.
- Isolation tests for wrong workspace, wrong project, wrong package, wrong media artifact, cross-project issue/player IDs, and non-video artifacts.
- Persistence tests that reopen/list tags after creating, updating, and deleting them.

### Frontend domain and state

- Port and adapt Plane Coach tests for configuration normalization, initial sport state, AutoCarry, radial menu ordering/nesting, Kando math, and pinned roster slots.
- Test pin snapshots for deep immutability and stable player identifiers.
- Test timestamp capture/clamping, optimistic ID reconciliation, failed-create retention, update/delete rollback, late responses, and media changes.
- Test all undo/redo transition types, the 100-entry bound, and mutation failure behavior.

### Components and integration

- A pin change does not create a tag.
- An action uses the current value returned by the player adapter while paused and while playing.
- Rows and markers seek through the adapter and share selection.
- Editing patches a tag without duplication.
- Deletion requires confirmation.
- Shortcuts operate outside editors and are ignored inside editors.
- Roster failure still permits playerless tagging; configuration and initial tag-load failures expose retry states.
- The Media Library player is not remounted or duplicated when tagging mode changes.

### Responsive and regression checks

- Browser checks at representative desktop, laptop, iPad landscape, and iPad portrait viewports.
- Verify natural video aspect ratio, unobstructed controls, HUD overflow, radial clamping, popover positioning, and list reflow.
- Run focused Media Library, event detail/tag display, playlist, annotation, roster, frontend type-check/lint, API media-library, and API roster suites.

## Delivery Sequence

1. Add and test the native tag model, serializer, nested endpoints, and frontend service types.
2. Port the generic sport configuration and Kando domain code with tests.
3. Add the workspace state, player adapter, history, and optimistic mutation controller.
4. Add the Media Library entry point and focused workspace shell around the existing player.
5. Port the pinned HUD, roster selectors, and radial interaction without live dependencies.
6. Add markers, list, seek/select behavior, edit, delete, retry, and synchronization status.
7. Add keyboard behavior and responsive/accessibility refinements.
8. Run focused and regression verification and document any intentionally unsupported Coach-only live behavior.

## Acceptance Criteria

- A supported uploaded Plane video can enter and exit tagging mode without remounting a second player.
- Playback, pause, seek, five-second jumps, and scrubbing continue to use the existing player.
- Sport configuration is dynamic and normalized before use.
- Pinned values remain active until changed, and pin changes alone create no action tags.
- Every action captures the exact current playback timestamp plus immutable pin/player context.
- Tags persist natively in Plane by uploaded media artifact and reload after navigation, refresh, or login.
- Roster selections store stable player IDs and display snapshots.
- Optimistic tags appear immediately and failures are visible and recoverable.
- Rows and markers seek and select one another.
- Existing tags can be edited without duplication and deleted after confirmation.
- Undo/redo handles create, update, delete, and pin changes with durable inverse mutations where required.
- The layout works at desktop and iPad sizes without cropping video or covering playback controls.
- Existing Media Library, playlist, staging, annotation, event, issue, roster, and permission workflows keep working.
- No live-streaming, camera, device, RTMP, LL-HLS, or service-gateway session behavior is introduced.
