# Plane Uploaded-Video Tagging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Plane user open an uploaded Media Library video and create, persist, revisit, seek, edit, delete, undo, and redo sport-configured timestamp tags using Plane Coach's pinned-HUD and radial-menu interaction patterns.

**Architecture:** Plane's existing Media Library page and Video.js instance remain the only playback owner. A focused `video-tagging` frontend feature ports Plane Coach's generic sport configuration, Kando radial menu, and pinned-HUD behavior while a native project-scoped Django model and nested Media Library API persist action tags by package and media artifact. Workspace-local state coordinates immutable pin snapshots, optimistic mutations, selection, and bounded history without importing live stream, device, socket, or tagging-session behavior.

**Tech Stack:** Django/DRF/PostgreSQL, Next.js 14, React 18, TypeScript, Video.js, SWR, Plane UI/toasts, Node test runner, pytest.

**Spec:** `docs/superpowers/specs/2026-09-23-plane-uploaded-video-tagging-design.md`

## Global Constraints

- Tagging applies only to videos already uploaded to Plane Media Library or event media resolved to an uploaded artifact.
- `video.currentTime` through Plane's existing Video.js player is the sole timing source.
- Media artifact identity (`project_id`, `package_id`, `media_id`) is the primary tag relationship; issue/event context is optional.
- Pin changes never create action tags; action creation deep-snapshots current pins and player context.
- Store stable roster-player IDs plus immutable player name and jersey snapshots.
- Reuse/port Plane Coach's configuration, AutoCarry, pinned HUD, Kando geometry, pointer, gesture, nesting, icon, and labeling behavior where it is independent of live streams.
- Do not add RTMP, cameras, device claiming/validation/status, LL-HLS live preview, dump/session lifecycle, streaming sockets, or setup-before-event behavior.
- Preserve Media Library, playlists, staging clips, annotations, event/issue detail, roster, navigation, permissions, and the video's natural aspect ratio.
- No new global Zustand store or new timing system; state is scoped to the active tagging workspace.
- Do not add a cross-repository runtime dependency on `plane-coach`; port generic code into Plane with imports adapted to Plane conventions.

## Review Focus

- A tag request for a valid ID under the wrong project/package/media path must return 404 and never leak or mutate the tag; covered in Task 2 API isolation tests.
- A configuration or tag-list request that resolves after navigating to another media item must not initialize or mutate the new workspace; covered in Task 5 operation/media-key tests.
- A create undone while its request is in flight must not reappear after the response; covered in Task 5 optimistic-history tests.
- Keyboard shortcuts must be ignored in text/select/contenteditable/dialog controls; covered in Task 9 shortcut tests.
- Unknown/zero duration must not produce invalid marker positions or timestamps beyond a later-known duration; covered in Tasks 5 and 8 domain tests.

## File Structure

### Backend

- `apps/api/plane/db/models/media_video_tag.py`: project-scoped persistent tag entity.
- `apps/api/plane/db/migrations/0126_mediavideotag.py`: schema, indexes, and foreign keys.
- `apps/api/plane/app/serializers/media_video_tag.py`: payload validation and roster/issue snapshots.
- `apps/api/plane/app/views/media_video_tag.py`: artifact validation and scoped CRUD view set.
- `apps/api/plane/app/urls/media_video_tag.py`: nested Media Library tag routes.
- Existing package `__init__.py` files: register model, serializer, view, and URLs.
- `apps/api/plane/tests/contract/app/test_media_video_tags.py`: API behavior, authorization, isolation, and persistence.

### Frontend server/service

- `apps/web/app/api/kanavio/tagging/sports/route.ts`: configured sport discovery proxy.
- `apps/web/app/api/kanavio/tagging/sports/[sport]/config/route.ts`: sport configuration proxy.
- `apps/web/core/services/media-video-tag.service.ts`: native Plane tag CRUD client.
- `apps/web/ce/features/video-tagging/types.ts`: persisted/UI tag, player, config, playback, and history types.

### Frontend domain/state

- `apps/web/ce/features/video-tagging/domain/sport-config/*`: ported Coach normalization, expression, AutoCarry, state, quick-input, and radial builders.
- `apps/web/ce/features/video-tagging/domain/kando/*`: ported Coach menu types, math, runtime tree, constants, visuals, icon renderers, and helpers.
- `apps/web/ce/features/video-tagging/domain/tagging-state.ts`: reducer transitions, pin snapshots, optimistic reconciliation, selection, and sort rules.
- `apps/web/ce/features/video-tagging/domain/tagging-history.ts`: bounded reversible intentions and inverse API commands.
- `apps/web/ce/features/video-tagging/domain/shortcuts.ts`: editable-target guard and shortcut resolution.
- `apps/web/ce/features/video-tagging/hooks/use-video-tagging.ts`: hydration, service mutations, stale-operation guards, history orchestration.
- `apps/web/ce/features/video-tagging/hooks/use-tagging-player.ts`: adapter for the existing Video.js player.
- `apps/web/ce/features/video-tagging/hooks/use-tagging-roster.ts`: SWR wrapper and roster-to-tag-player mapping.

### Frontend UI

- `apps/web/ce/features/video-tagging/components/video-tagging-workspace.tsx`: responsive shell and loading/failure states.
- `apps/web/ce/features/video-tagging/components/tagging-header.tsx`: back/title/sport/sync/history controls.
- `apps/web/ce/features/video-tagging/components/tagging-player-controls.tsx`: explicit play/pause and five-second actions using the adapter.
- `apps/web/ce/features/video-tagging/components/pinned-hud/*`: ported generic/sport/player controls with live dependencies removed.
- `apps/web/ce/features/video-tagging/components/radial-menu/*`: ported Kando surface and accessible action fallback.
- `apps/web/ce/features/video-tagging/components/tag-timeline.tsx`: marker rail synchronized with duration and selection.
- `apps/web/ce/features/video-tagging/components/tag-list.tsx`: sortable tag table/cards and save/error state.
- `apps/web/ce/features/video-tagging/components/edit-tag-dialog.tsx`: edit form.
- `apps/web/ce/features/video-tagging/components/delete-tag-dialog.tsx`: confirmation.
- `apps/web/ce/features/video-tagging/video-tagging.module.css`: scoped layout, responsive, reduced-motion, and radial styles.
- `apps/web/ce/features/video-tagging/index.ts`: public feature exports.
- Existing Media Library detail/preview files: entry button, exclusive focused mode, player adapter wiring, and workspace hosts.

---

### Task 1: Persistent Media Video Tag Model and Validation

**Files:**
- Create: `apps/api/plane/db/models/media_video_tag.py`
- Create: `apps/api/plane/db/migrations/0126_mediavideotag.py`
- Create: `apps/api/plane/app/serializers/media_video_tag.py`
- Modify: `apps/api/plane/db/models/__init__.py`
- Modify: `apps/api/plane/app/serializers/__init__.py`
- Test: `apps/api/plane/tests/contract/app/test_media_video_tags.py`

**Interfaces:**
- Produces: `MediaVideoTag`, `MediaVideoTagSerializer`, and serialized fields consumed by Task 2.
- Model identity: UUID `id`; scope is `workspace_id`, `project_id`, `package_id`, `media_id`.

- [ ] **Step 1: Write failing model/serializer tests**

Add tests that instantiate a project, issue, and roster player, validate this request, and assert the player snapshot and audit-compatible fields:

```python
payload = {
    "timestamp": 42.53,
    "sport": "basketball",
    "action": {"id": "three_point_made", "label": "3PT Made"},
    "pins": {"quarter": 2, "score_home": 31, "score_away": 28},
    "player_id": str(player.id),
    "issue_id": str(issue.id),
    "notes": "Corner three",
    "metadata": {"source": "radial"},
}
serializer = MediaVideoTagSerializer(
    data=payload,
    context={"project": project, "package_id": "package-1", "media_id": "clip-1"},
)
assert serializer.is_valid(), serializer.errors
tag = serializer.save(project=project, package_id="package-1", media_id="clip-1")
assert tag.roster_player_id == player.id
assert tag.player_name == player.player_name
assert tag.jersey_number == player.jersey_number
```

Also assert rejection for negative, infinite, and NaN timestamps; missing action ID/label; non-object pins/metadata; and roster/issue IDs belonging to another project.

- [ ] **Step 2: Run the test and verify it fails**

Run from `apps/api`:

```bash
pytest plane/tests/contract/app/test_media_video_tags.py -q
```

Expected: collection/import failure because `MediaVideoTag` and its serializer do not exist.

- [ ] **Step 3: Add the model and migration**

Implement the entity with this public shape:

```python
class MediaVideoTag(ProjectBaseModel):
    package_id = models.CharField(max_length=255, db_index=True)
    media_id = models.CharField(max_length=255, db_index=True)
    timestamp = models.FloatField()
    sport = models.CharField(max_length=100)
    action = models.JSONField(default=dict)
    pins = models.JSONField(default=dict)
    roster_player = models.ForeignKey(
        "db.RosterPlayer", on_delete=models.SET_NULL, null=True, blank=True, related_name="video_tags"
    )
    player_name = models.CharField(max_length=255, null=True, blank=True)
    jersey_number = models.CharField(max_length=20, null=True, blank=True)
    issue = models.ForeignKey("db.Issue", on_delete=models.SET_NULL, null=True, blank=True, related_name="video_tags")
    event_id = models.CharField(max_length=255, null=True, blank=True)
    notes = models.TextField(blank=True, default="")
    metadata = models.JSONField(default=dict)

    class Meta:
        db_table = "media_video_tags"
        ordering = ("timestamp", "created_at")
        indexes = [models.Index(fields=["project", "package_id", "media_id", "timestamp"])]
```

Generate/check migration `0126_mediavideotag.py` and import the model from `plane.db.models`.

- [ ] **Step 4: Implement serializer validation and snapshots**

Expose `player_id` and `issue_id` as write-only UUID fields; validate related rows using the project from serializer context. Use `math.isfinite(timestamp) and timestamp >= 0`, require non-empty string action `id` and `label`, normalize sport with `.strip().lower()`, and copy player display fields when `player_id` is explicitly supplied. Do not clear an existing snapshot on unrelated patches.

- [ ] **Step 5: Run focused backend tests and migration checks**

```bash
pytest plane/tests/contract/app/test_media_video_tags.py -q
python manage.py makemigrations --check --dry-run
```

Expected: serializer/model tests pass and Django reports no pending migration changes.

- [ ] **Step 6: Commit**

```bash
git add apps/api/plane/db/models/media_video_tag.py apps/api/plane/db/models/__init__.py apps/api/plane/db/migrations/0126_mediavideotag.py apps/api/plane/app/serializers/media_video_tag.py apps/api/plane/app/serializers/__init__.py apps/api/plane/tests/contract/app/test_media_video_tags.py
git commit -m "feat(api): add uploaded video tag model"
```

### Task 2: Nested Plane Tag CRUD API

**Files:**
- Create: `apps/api/plane/app/views/media_video_tag.py`
- Create: `apps/api/plane/app/urls/media_video_tag.py`
- Modify: `apps/api/plane/app/views/__init__.py`
- Modify: `apps/api/plane/app/urls/__init__.py`
- Modify: `apps/api/plane/tests/contract/app/test_media_video_tags.py`

**Interfaces:**
- Consumes: `MediaVideoTagSerializer` from Task 1.
- Produces: collection/detail endpoints with list/create/patch/delete responses consumed by Task 5's service.

- [ ] **Step 1: Write failing API contract tests**

Create a Media Library manifest fixture containing one `mp4` artifact and test:

```python
list_url = (
    f"/api/workspaces/{workspace.slug}/projects/{project.id}/media-library/"
    "packages/package-1/artifacts/clip-1/tags/"
)
created = session_client.post(list_url, payload, format="json")
assert created.status_code == status.HTTP_201_CREATED
tag_id = created.json()["id"]
assert session_client.get(list_url).json()[0]["timestamp"] == 42.53
assert session_client.patch(f"{list_url}{tag_id}/", {"notes": "Updated"}, format="json").status_code == 200
assert session_client.delete(f"{list_url}{tag_id}/").status_code == 200
assert session_client.get(list_url).json() == []
```

Add the Review Focus isolation matrix: wrong workspace/project/package/media/tag ID returns 404; cross-project player/issue returns 400; a non-video artifact returns 400; guest list succeeds while guest create/patch/delete returns 403; admin/member mutations succeed.

- [ ] **Step 2: Run the API tests and verify route failures**

```bash
pytest plane/tests/contract/app/test_media_video_tags.py -q
```

Expected: requests return 404 because routes are not registered.

- [ ] **Step 3: Implement artifact resolution and scoped view set**

Add a helper that validates path segments, loads the manifest through `manifest_path/read_manifest`, finds exactly `media_id`, and accepts video formats/actions already recognized by Media Library. Implement:

```python
class MediaVideoTagViewSet(BaseViewSet):
    permission_classes = [ProjectEntityPermission]
    model = MediaVideoTag
    serializer_class = MediaVideoTagSerializer

    def get_queryset(self):
        return MediaVideoTag.objects.filter(
            workspace__slug=self.kwargs["slug"],
            project_id=self.kwargs["project_id"],
            package_id=self.kwargs["package_id"],
            media_id=self.kwargs["media_id"],
        ).order_by("timestamp", "created_at")
```

Use `@allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])` for list/retrieve and admin/member for create/partial-update/destroy. Set project/package/media from the path, never from request data. Use the model's soft-delete method/convention for destroy and return `{"success": True}`.

- [ ] **Step 4: Register collection and detail routes**

Register exact trailing-slash routes under the existing Media Library artifact hierarchy and include `media_video_tag_urls` from `plane.app.urls.__init__`.

- [ ] **Step 5: Run focused and neighboring API tests**

```bash
pytest plane/tests/contract/app/test_media_video_tags.py plane/tests/contract/app/test_roster_app.py plane/tests/unit/app/test_media_library_view_counter.py -q
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/plane/app/views/media_video_tag.py apps/api/plane/app/views/__init__.py apps/api/plane/app/urls/media_video_tag.py apps/api/plane/app/urls/__init__.py apps/api/plane/tests/contract/app/test_media_video_tags.py
git commit -m "feat(api): expose media video tag CRUD"
```

### Task 3: Sport Configuration Proxies and Ported Domain

**Files:**
- Create: `apps/web/app/api/kanavio/tagging/sports/route.ts`
- Create: `apps/web/app/api/kanavio/tagging/sports/[sport]/config/route.ts`
- Create: `apps/web/ce/features/video-tagging/types.ts`
- Create: `apps/web/ce/features/video-tagging/domain/sport-config/{types,config-normalization,expression,autocarry-engine,quick-input,radial-menu,sport-id,index}.ts`
- Create: `apps/web/ce/features/video-tagging/domain/__tests__/sport-config.test.ts`

**Interfaces:**
- Produces: `SportConfig`, `SportState`, `normalizeSportConfig`, `createInitialSportState`, `processSportEvent`, `getHudDescriptor`, and `buildPhase1RadialMenuRoot`.
- Proxy output is passed through from Kanavio; normalization is always client-side before use.

- [ ] **Step 1: Port the Coach domain tests before implementation**

Adapt Coach fixtures/tests to Plane imports and add malformed-config coverage:

```ts
const config = normalizeSportConfig(rawBasketballConfig);
assert.ok(config);
assert.equal(config.sport, "basketball");
assert.deepEqual(buildPhase1RadialMenuRoot(config).children.map((item) => item.name), expectedClockwiseLabels);
assert.equal(normalizeSportConfig({ sport: "basketball" }), null);
```

Test quick-input children, deterministic AutoCarry, immutable prior/current state, unknown event codes, and initial values.

- [ ] **Step 2: Run the domain test and verify missing-module failure**

From `apps/web`:

```bash
node --experimental-strip-types --test --experimental-test-isolation=none ce/features/video-tagging/domain/__tests__/sport-config.test.ts
```

- [ ] **Step 3: Port the generic sport domain**

Copy the relevant Plane Coach implementations, change aliases to `@/plane-web/features/video-tagging/...`, preserve public types and normalizers, and exclude live-game-state storage, clock transport, and server event APIs. `processSportEvent` must accept a recorded-video timestamp through `videoTimecodeClipStart` and return updated pin state plus an action payload without performing I/O.

- [ ] **Step 4: Add sport proxy routes**

Mirror Plane's existing event proxy error parsing and headers. `GET /api/kanavio/tagging/sports` forwards to `${baseUrl}/v1/sports`; `GET /api/kanavio/tagging/sports/:sport/config` forwards to `${baseUrl}/v1/sports/:sport/config`; both use `cache: "no-store"`, encoded path values, and return 503 when not configured.

- [ ] **Step 5: Run domain tests and frontend type checking**

```bash
node --experimental-strip-types --test --experimental-test-isolation=none ce/features/video-tagging/domain/__tests__/sport-config.test.ts
pnpm check:types
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/api/kanavio/tagging/sports apps/web/ce/features/video-tagging/types.ts apps/web/ce/features/video-tagging/domain/sport-config apps/web/ce/features/video-tagging/domain/__tests__/sport-config.test.ts
git commit -m "feat(web): port sport tagging configuration"
```

### Task 4: Port the Kando Radial Menu Engine

**Files:**
- Create: `apps/web/ce/features/video-tagging/domain/kando/*`
- Create: `apps/web/ce/features/video-tagging/components/radial-menu/kando-menu-surface.tsx`
- Create: `apps/web/ce/features/video-tagging/components/radial-menu/radial-tag-menu.tsx`
- Create: `apps/web/ce/features/video-tagging/components/radial-menu/radial-tag-menu.module.css`
- Create: `apps/web/ce/features/video-tagging/domain/__tests__/kando.test.ts`

**Interfaces:**
- Consumes: `MenuItemV1` trees from Task 3.
- Produces: `RadialTagMenuHandle` external-pointer methods and `onLeafSelect(actionId, context)`.

- [ ] **Step 1: Write geometry/runtime tests**

Port Coach math and runtime-tree cases and add viewport safety:

```ts
assert.deepEqual(clampToMonitor({ x: 4, y: 796 }, 120, { x: 1024, y: 800 }), { x: 120, y: 680 });
const runtime = createRuntimeTree(menuRoot);
assert.equal(getNodeByPath(runtime, [1, 0])?.item.name, "Left Corner");
assert.deepEqual(toNodePath("1.0"), [1, 0]);
```

Test zero-size layout fallback, nested paths, ring centers, drag thresholds, and deterministic angle ordering.

- [ ] **Step 2: Verify tests fail before the port**

```bash
node --experimental-strip-types --test --experimental-test-isolation=none ce/features/video-tagging/domain/__tests__/kando.test.ts
```

- [ ] **Step 3: Port Kando domain, icons, and surface**

Port Coach `math.ts`, `runtime-tree.ts`, `surface-constants.ts`, `surface-helpers.tsx`, `types.ts`, `visuals.ts`, icon renderers/assets, and quick-input icons. Port `KandoMenuSurface` and overlay CSS with Plane theme variables. Keep pointer capture, external pointer commands, nested selection chains, clamping, gesture selection, labels, and theme modes. Remove references to event devices or live stage state.

- [ ] **Step 4: Add an accessible action fallback**

`RadialTagMenu` renders the radial surface for pointer-capable layouts and a list/grid of the same leaf actions for keyboard/screen-reader activation. Both call one callback:

```ts
onLeafSelect: (actionId: string, context: AutoCarryContext | null) => void;
```

Escape calls the exposed cancel method and closes the overlay.

- [ ] **Step 5: Run Kando tests, type checking, and lint on the feature**

```bash
node --experimental-strip-types --test --experimental-test-isolation=none ce/features/video-tagging/domain/__tests__/kando.test.ts
pnpm check:types
pnpm exec eslint ce/features/video-tagging/domain/kando ce/features/video-tagging/components/radial-menu --max-warnings 0
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/ce/features/video-tagging/domain/kando apps/web/ce/features/video-tagging/domain/__tests__/kando.test.ts apps/web/ce/features/video-tagging/components/radial-menu
git commit -m "feat(web): port radial tagging menu"
```

### Task 5: Native Tag Service, Workspace State, Optimism, and History

**Files:**
- Create: `apps/web/core/services/media-video-tag.service.ts`
- Create: `apps/web/ce/features/video-tagging/domain/tagging-state.ts`
- Create: `apps/web/ce/features/video-tagging/domain/tagging-history.ts`
- Create: `apps/web/ce/features/video-tagging/hooks/use-video-tagging.ts`
- Create: `apps/web/ce/features/video-tagging/hooks/use-tagging-player.ts`
- Create: `apps/web/ce/features/video-tagging/domain/__tests__/tagging-state.test.ts`
- Create: `apps/web/ce/features/video-tagging/domain/__tests__/tagging-history.test.ts`

**Interfaces:**
- Produces: `MediaVideoTagService`, `TaggingPlayerAdapter`, and `useVideoTagging({ mediaKey, config, player, ... })`.
- State commands: `setPin`, `createAction`, `retryCreate`, `removeUnsaved`, `updateTag`, `deleteTag`, `selectTag`, `undo`, `redo`.

- [ ] **Step 1: Write failing reducer and history tests**

Pin snapshot and current-time case:

```ts
const state1 = reduceTaggingState(initialState, { type: "pin.set", id: "quarter", value: 2 });
const state2 = reduceTaggingState(state1, createOptimisticAction({ now: 42.53, action, player }));
assert.equal(state2.tags[0].timestamp, 42.53);
assert.deepEqual(state2.tags[0].pins, { quarter: 2 });
assert.notEqual(state2.tags[0].pins, state2.pins);
```

Cover temporary-to-server ID replacement, create failure staying visible as `unsaved`, update/delete rollback, timestamp clamping with null/zero/known duration, stable time ordering, media-key reset, late response rejection, the 100-entry bound, every inverse transition, and the in-flight create/undo Review Focus case.

- [ ] **Step 2: Verify tests fail**

```bash
node --experimental-strip-types --test --experimental-test-isolation=none ce/features/video-tagging/domain/__tests__/tagging-state.test.ts ce/features/video-tagging/domain/__tests__/tagging-history.test.ts
```

- [ ] **Step 3: Implement API service and pure state transitions**

Use the nested URL in one builder and typed methods:

```ts
list(context): Promise<VideoTag[]>;
create(context, payload): Promise<VideoTag>;
update(context, tagId, payload): Promise<VideoTag>;
delete(context, tagId): Promise<void>;
```

Define `VideoTag.transportStatus` only in UI types. Deep-clone pins/metadata at transition boundaries. Use operation IDs plus the complete media key to reject late responses.

- [ ] **Step 4: Implement the existing-player adapter**

Wrap the current `videojs.Player` without owning or disposing it. `getCurrentTime` calls `player.currentTime()`, `getDuration` returns a finite positive duration or null, `seek` clamps, and `subscribe` listens to `timeupdate`, `durationchange`, `play`, `pause`, `ended`, and `seeking` and removes exactly those listeners on cleanup.

- [ ] **Step 5: Implement hydration and optimistic orchestration hook**

Load tags with SWR keyed by workspace/project/package/media. Hydrate only if the captured media key still matches. On create, render before awaiting the service; reconcile or mark unsaved. On update/delete, preserve confirmed snapshots for rollback. Serialize undo/redo network operations and keep the history cursor unchanged on failure. Use Plane error toasts.

- [ ] **Step 6: Run tests and type checking**

```bash
node --experimental-strip-types --test --experimental-test-isolation=none ce/features/video-tagging/domain/__tests__/tagging-state.test.ts ce/features/video-tagging/domain/__tests__/tagging-history.test.ts
pnpm check:types
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/core/services/media-video-tag.service.ts apps/web/ce/features/video-tagging/domain/tagging-state.ts apps/web/ce/features/video-tagging/domain/tagging-history.ts apps/web/ce/features/video-tagging/hooks apps/web/ce/features/video-tagging/domain/__tests__/tagging-state.test.ts apps/web/ce/features/video-tagging/domain/__tests__/tagging-history.test.ts
git commit -m "feat(web): add video tagging state and persistence"
```

### Task 6: Media Library Entry Point and Focused Workspace Shell

**Files:**
- Create: `apps/web/ce/features/video-tagging/components/video-tagging-workspace.tsx`
- Create: `apps/web/ce/features/video-tagging/components/tagging-header.tsx`
- Create: `apps/web/ce/features/video-tagging/components/tagging-player-controls.tsx`
- Create: `apps/web/ce/features/video-tagging/video-tagging.module.css`
- Create: `apps/web/ce/features/video-tagging/index.ts`
- Modify: `apps/web/ce/features/media-library/components/media-detail-page.tsx`
- Modify: `apps/web/ce/features/media-library/components/media-detail-preview.tsx`

**Interfaces:**
- Consumes: player adapter and workspace hook from Task 5.
- Produces: `VideoTaggingWorkspace` plus Media Library `Tag Video` mode.

- [ ] **Step 1: Add a pure focused-mode test seam**

Extract a small mode reducer (`normal | annotation | tagging`) into `domain/workspace-mode.ts` and test mutual exclusion:

```ts
assert.equal(transitionWorkspaceMode("annotation", { type: "open-tagging" }), "tagging");
assert.equal(transitionWorkspaceMode("tagging", { type: "close" }), "normal");
```

Also assert `canEnterTagging` only for video items with `packageId` and `id`.

- [ ] **Step 2: Run the mode test and verify failure**

```bash
node --experimental-strip-types --test --experimental-test-isolation=none ce/features/video-tagging/domain/__tests__/workspace-mode.test.ts
```

- [ ] **Step 3: Add exclusive tagging mode without remounting video**

Replace separate annotation booleans only where necessary with the focused-mode reducer. Keep the existing `<video ref={videoRef}>` and Video.js setup in place. Pass the live `playerRef.current` through the adapter to `VideoTaggingWorkspace`. Opening tagging closes annotation UI state; leaving returns to normal detail without disposing/recreating the player solely because mode changed.

- [ ] **Step 4: Build loading/header/control shell**

Use `useProject().getProjectById(projectId)?.sport` first, then `item.meta.sport`, then event metadata. Fetch configuration, roster, and tags concurrently. Header shows Back, title, sport, `Saved/Saving/Unsaved` status, and history controls. Explicit controls call adapter play/pause/seek while Video.js scrubber remains enabled.

- [ ] **Step 5: Add the entry action and query restoration**

Add `Tag Video` beside the existing annotation action for eligible uploaded videos. Support `?tagging=1` for reopening/bookmarking, but validate eligibility before entry. Preserve the existing safe `from` back URL. Do not show the action on image/document/collection artifacts.

- [ ] **Step 6: Verify type/lint and existing media tests**

```bash
node --experimental-strip-types --test --experimental-test-isolation=none ce/features/video-tagging/domain/__tests__/workspace-mode.test.ts ce/features/media-library/utils/__tests__/*.test.mjs
pnpm check:types
pnpm exec eslint ce/features/video-tagging ce/features/media-library/components/media-detail-page.tsx ce/features/media-library/components/media-detail-preview.tsx --max-warnings 0
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/ce/features/video-tagging apps/web/ce/features/media-library/components/media-detail-page.tsx apps/web/ce/features/media-library/components/media-detail-preview.tsx
git commit -m "feat(web): add uploaded video tagging workspace"
```

### Task 7: Pinned HUD, Roster, and Action Creation

**Files:**
- Create: `apps/web/ce/features/video-tagging/components/pinned-hud/*`
- Create: `apps/web/ce/features/video-tagging/hooks/use-tagging-roster.ts`
- Modify: `apps/web/ce/features/video-tagging/components/video-tagging-workspace.tsx`
- Modify: `apps/web/ce/features/video-tagging/domain/tagging-state.ts`
- Test: `apps/web/ce/features/video-tagging/domain/__tests__/tagging-actions.test.ts`

**Interfaces:**
- Consumes: normalized `SportConfig`, `IRosterPlayer[]`, `TaggingPlayerAdapter`, state commands.
- Produces: configuration-driven pins and radial action commits with stable player snapshots.

- [ ] **Step 1: Write behavior tests for pins and actions**

```ts
const afterPin = applyPin(initial, "quarter", 2);
assert.equal(afterPin.tags.length, 0);
const request = buildActionCreateRequest(afterPin, {
  action: { id: "three_point_made", label: "3PT Made" },
  currentTime: 125.2,
  player: { id: "player-123", name: "John Smith", jerseyNumber: "7" },
});
assert.deepEqual(request.pins, { quarter: 2 });
assert.equal(request.player_id, "player-123");
```

Cover select, numeric, text, boolean, team/score, and player values; changing pins after creation cannot mutate the request/tag; roster failure produces `player: null`; AutoCarry changes apply only after the action snapshot rules defined by Coach.

- [ ] **Step 2: Verify tests fail**

```bash
node --experimental-strip-types --test --experimental-test-isolation=none ce/features/video-tagging/domain/__tests__/tagging-actions.test.ts
```

- [ ] **Step 3: Port and adapt the pinned HUD**

Port Coach's generic HUD, basketball/cricket/football specializations, pin button, popovers, slot types, utilities, and styles. Replace live-state/clock service props with controlled `pins` and `setPin`. Preserve score/team controls, select/number/text/boolean handling, recent player lists, and popover edge clamping. Treat clock values as ordinary pins; remove clock commands and intervals tied to live games.

- [ ] **Step 4: Integrate Plane roster records**

Fetch with `RosterService.getRoster(workspaceSlug, projectId)` and map:

```ts
type TaggingPlayer = {
  id: string;
  name: string;
  jerseyNumber: string;
  position?: string;
};
```

Use player ID for stored identity. Show jersey/name/position in the selector. Roster load failure renders a retry action and keeps a clear-player/playerless path available.

- [ ] **Step 5: Connect radial leaves to one action commit**

Resolve the action label from config, read `adapter.getCurrentTime()` at activation (not render time), snapshot state/player, create optimistically, then run deterministic AutoCarry for the next pin state. Honor pause-on-tag only after capturing the timestamp.

- [ ] **Step 6: Run tests, type checking, and lint**

```bash
node --experimental-strip-types --test --experimental-test-isolation=none ce/features/video-tagging/domain/__tests__/tagging-actions.test.ts
pnpm check:types
pnpm exec eslint ce/features/video-tagging --max-warnings 0
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/ce/features/video-tagging
git commit -m "feat(web): add pinned HUD and roster tagging"
```

### Task 8: Timeline Markers, Tag List, Edit, Delete, and Recovery UI

**Files:**
- Create: `apps/web/ce/features/video-tagging/components/tag-timeline.tsx`
- Create: `apps/web/ce/features/video-tagging/components/tag-list.tsx`
- Create: `apps/web/ce/features/video-tagging/components/edit-tag-dialog.tsx`
- Create: `apps/web/ce/features/video-tagging/components/delete-tag-dialog.tsx`
- Create: `apps/web/ce/features/video-tagging/domain/tag-presentation.ts`
- Create: `apps/web/ce/features/video-tagging/domain/__tests__/tag-presentation.test.ts`
- Modify: `apps/web/ce/features/video-tagging/components/video-tagging-workspace.tsx`

**Interfaces:**
- Consumes: tags, duration/current time, selection, CRUD/retry commands.
- Produces: synchronized row/marker selection and complete tag lifecycle UI.

- [ ] **Step 1: Write presentation tests**

```ts
assert.equal(formatTagTime(12.4), "00:12.4");
assert.equal(getMarkerPercent(25, 100), 25);
assert.equal(getMarkerPercent(25, null), null);
assert.equal(getMarkerPercent(125, 100), 100);
assert.deepEqual(sortTagsByTime([later, earlier]).map((tag) => tag.id), [earlier.id, later.id]);
```

Test zero/unknown duration, equal timestamps with stable creation ordering, pin detail summaries, player display fallback after roster deletion, and status labels.

- [ ] **Step 2: Verify tests fail**

```bash
node --experimental-strip-types --test --experimental-test-isolation=none ce/features/video-tagging/domain/__tests__/tag-presentation.test.ts
```

- [ ] **Step 3: Build accessible markers and list**

Markers are buttons positioned only when duration is known and positive. Selecting a marker or row calls `adapter.seek(tag.timestamp)` and `selectTag(tag.id)`. The list exposes time, action, player snapshot, pin summary, sync state, view metadata, edit, retry/remove unsaved, and delete controls. Use compact cards below desktop breakpoint and table semantics when space permits.

- [ ] **Step 4: Implement edit and delete dialogs**

Edit initializes a draft from the existing tag and patches its ID with action/timestamp/player/pins/notes/metadata. It clamps timestamp at submit and never calls create. Delete names the action/time, requires explicit confirmation, and invokes optimistic delete. Disable duplicate submissions while the operation is pending.

- [ ] **Step 5: Display recoverable transport states**

Show unsaved tags in both marker and list with text/icon distinction, expose Retry and Remove, and keep the workspace sync summary accurate. Update/delete failures restore confirmed values and preserve selection. Existing saved tags stay usable during later failures.

- [ ] **Step 6: Run tests, type checking, and lint**

```bash
node --experimental-strip-types --test --experimental-test-isolation=none ce/features/video-tagging/domain/__tests__/tag-presentation.test.ts
pnpm check:types
pnpm exec eslint ce/features/video-tagging --max-warnings 0
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/ce/features/video-tagging
git commit -m "feat(web): add video tag timeline and management"
```

### Task 9: Keyboard, Responsive, Accessibility, and Full Verification

**Files:**
- Create: `apps/web/ce/features/video-tagging/domain/shortcuts.ts`
- Create: `apps/web/ce/features/video-tagging/domain/__tests__/shortcuts.test.ts`
- Modify: `apps/web/ce/features/video-tagging/components/video-tagging-workspace.tsx`
- Modify: `apps/web/ce/features/video-tagging/video-tagging.module.css`
- Modify: `apps/web/ce/features/media-library/components/media-detail-preview.tsx`
- Modify: `docs/superpowers/specs/2026-09-23-plane-uploaded-video-tagging-design.md` only if implementation reveals a user-approved design correction.

**Interfaces:**
- Consumes: player/history/radial commands from earlier tasks.
- Produces: final shippable interaction and verification evidence.

- [ ] **Step 1: Write shortcut guard tests**

```ts
for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) {
  assert.equal(resolveTaggingShortcut(keyEvent({ key: " ", targetTag: tagName })), null);
}
assert.equal(resolveTaggingShortcut(keyEvent({ key: "ArrowLeft", targetTag: "DIV" })), "seek-backward");
assert.equal(resolveTaggingShortcut(keyEvent({ key: "z", metaKey: true, shiftKey: true })), "redo");
```

Cover contenteditable targets, active dialogs, Space, arrows, Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, and Escape.

- [ ] **Step 2: Verify shortcut tests fail**

```bash
node --experimental-strip-types --test --experimental-test-isolation=none ce/features/video-tagging/domain/__tests__/shortcuts.test.ts
```

- [ ] **Step 3: Wire keyboard behavior and focus management**

Install one workspace keydown listener while tagging is active. Call `preventDefault` only for a resolved shortcut. Restore focus to the invoking control after popover/dialog/radial close. Add labels, pressed/selected states, error announcements, and visible focus rings.

- [ ] **Step 4: Complete responsive and reduced-motion styling**

Use a desktop grid only when the video column remains at least 640px; otherwise stack the tag list. Keep `object-fit: contain`, HUD horizontal overflow, 44px touch targets where practical, and clamped overlay bounds. Under `prefers-reduced-motion: reduce`, remove radial/marker transform animations. Check 1440x900, 1024x768, 1180x820 iPad landscape, and 820x1180 iPad portrait.

- [ ] **Step 5: Run all focused frontend tests**

```bash
node --experimental-strip-types --test --experimental-test-isolation=none ce/features/video-tagging/domain/__tests__/*.test.ts ce/features/media-library/utils/__tests__/*.test.mjs core/components/issues/issue-detail/sg-event-detail-page/__tests__/*.test.ts core/components/issues/issue-detail/sg-event-detail-page/timeline-view/__tests__/*.test.ts
pnpm check:types
pnpm exec eslint ce/features/video-tagging ce/features/media-library/components/media-detail-page.tsx ce/features/media-library/components/media-detail-preview.tsx core/services/media-video-tag.service.ts app/api/kanavio/tagging/sports --max-warnings 0
```

- [ ] **Step 6: Run backend regression tests**

From `apps/api`:

```bash
pytest plane/tests/contract/app/test_media_video_tags.py plane/tests/contract/app/test_roster_app.py plane/tests/unit/app/test_media_library_annotation_images.py plane/tests/unit/app/test_media_library_upload_logging.py plane/tests/unit/app/test_media_library_view_counter.py plane/tests/unit/utils/test_media_library.py -q
python manage.py makemigrations --check --dry-run
```

- [ ] **Step 7: Perform browser workflow verification**

Using an uploaded MP4/HLS item and a project with sport plus roster:

1. Open the video, play, pause, scrub, and use ±5 seconds.
2. Enter Tag Video and verify the same player/time continues.
3. Change several pins and verify no tag appears.
4. Select a roster player and radial action while paused and while playing.
5. Verify exact timestamps, copied pin/player snapshots, markers, and list rows.
6. Click a marker and row and verify seeking/selection.
7. Edit action/time/player/pins/notes and verify one record remains.
8. Delete with cancel then confirm; undo and redo create/update/delete/pin transitions.
9. Reload and reopen the video and verify server tags persist.
10. Simulate API failure and verify visible unsaved/rollback/retry behavior.
11. Repeat layout checks at the four target viewport sizes and verify the video is never cropped and controls remain unobstructed.
12. Open annotations, playlists, event detail, and roster pages to verify their existing workflows still operate.

- [ ] **Step 8: Run final diff and repository checks**

```bash
git diff --check
git status --short
pnpm --dir apps/web check:types
```

Expected: no whitespace errors, only intended files changed, type checking passes, and every focused test above passes.

- [ ] **Step 9: Commit**

```bash
git add apps/web/ce/features/video-tagging apps/web/ce/features/media-library/components/media-detail-page.tsx apps/web/ce/features/media-library/components/media-detail-preview.tsx
git commit -m "feat(web): finish uploaded video tagging interactions"
```

### Task 10: Whole-Branch Review and Acceptance Audit

**Files:**
- Review all files changed by Tasks 1-9.
- Modify only files necessary to resolve verified review findings.

**Interfaces:**
- Consumes: complete backend/frontend implementation.
- Produces: acceptance evidence and a clean handoff.

- [ ] **Step 1: Audit the diff against every specification acceptance criterion**

Create a temporary checklist outside the repository and map each acceptance criterion to implementation plus test evidence. Pay special attention to media-primary persistence, immutable pin/player snapshots, same-player timing, undo durability, failure recovery, iPad layout, and all explicit live-video exclusions.

- [ ] **Step 2: Search for prohibited live dependencies**

```bash
rg -n -i '(rtmp|claimed|validated|dumping|streaming-device|start-dump|ll-hls|camera|device claim|tagging-session)' apps/web/ce/features/video-tagging apps/api/plane/app/views/media_video_tag.py apps/api/plane/db/models/media_video_tag.py
```

Expected: no functional live/device/session dependencies; acceptable matches are only explicit comments explaining exclusions, which should be removed if unnecessary.

- [ ] **Step 3: Re-run the complete verification commands from Task 9 after review fixes**

Expected: all focused frontend tests, backend tests, lint, types, migration check, and diff checks pass with fresh output.

- [ ] **Step 4: Commit any review fixes separately**

```bash
git add apps/api/plane/db/models/media_video_tag.py apps/api/plane/app/serializers/media_video_tag.py apps/api/plane/app/views/media_video_tag.py apps/api/plane/app/urls/media_video_tag.py apps/api/plane/tests/contract/app/test_media_video_tags.py apps/web/ce/features/video-tagging apps/web/ce/features/media-library/components/media-detail-page.tsx apps/web/ce/features/media-library/components/media-detail-preview.tsx apps/web/core/services/media-video-tag.service.ts apps/web/app/api/kanavio/tagging/sports
git commit -m "fix: address uploaded video tagging review"
```

Skip this commit when the audit finds no required fixes.

- [ ] **Step 5: Prepare the handoff**

Report the entry path, persistence API, migration name, tests run with results, manual viewport/workflow checks, known environment requirements (`KANAVIO_TAGGING_SERVICE_URL` for dynamic configs), and explicitly confirm that no live camera/device workflow was added.
