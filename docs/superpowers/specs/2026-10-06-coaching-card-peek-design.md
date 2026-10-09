# Kanavio Coaching Card Detail Peek

Status: frontend implementation authorized and completed. The user's later instruction restricts this work to UI changes. Backend additions described below remain outside this implementation; additional clips can be previewed but cannot be saved with the current read-only evidence API.

## Intent and scope

Implement the requested coaching card detail experience inside Plane. A normal coaching card click opens the existing work item side peek while the Coaching Board stays mounted. Preserve board filters, sport, grouping, swimlanes, loaded data, and scroll. Use the supplied prototype for information architecture only; retain Plane typography, tokens, interaction primitives, and responsive layout.

The feature includes editable card properties and coaching notes, existing and additional video evidence, discussion, lifecycle history, configured workflow actions, URL selection/history, and accessible loading/error/empty states. No new global state library, drawer system, editor, or video player.

## Findings from the repository

- Coaching cards are already Plane issues (`category === "Coaching Card"`, `coaching_card_data.kind === "coaching_card"`). Keep their issue identity, permissions, comments, and detail fetch/store infrastructure.
- `IssueView` already owns the side-peek/modal/full-screen container, portal, independent scrolling, outside-click behavior, Escape handling, and header. Its side peek uses full width below the existing `md` breakpoint and 50% width above it. Reuse these sizes.
- Kanban cards already open a peek on desktop and indicate selection. The existing redirection hook navigates mobile users to the full issue page; coaching cards must instead remain in the existing responsive peek.
- `IssueDetailStore.setPeekIssue` currently sets MobX selection without updating the URL. There is no URL-backed work item peek strategy in the inspected flow to copy verbatim. Add a narrow URL adapter feeding the same store.
- The existing coaching properties in `PeekOverviewProperties` are read-only and arranged as event details. Coaching details need a dedicated composition of existing selectors.
- `CoachingCardClips` and `CoachingCardClipPlayer` already resolve saved coaching media and play HLS with clip boundaries. Add Clip is currently disabled.
- `CoachingCardDetailEndpoint.patch` explicitly rejects playlists and evidence mutation. Additional evidence requires an append endpoint, rather than replacing saved playlists through a generic issue update.
- Coaching priorities are currently `Game Plan Critical`, `Standard`, and `Developmental`. Preserve these persisted choices rather than inventing a second priority schema based on the illustrative High example.
- Roster players and position groups are different entities from Plane workspace assignees. Reuse the existing roster picker and assignment dialog; do not store roster IDs in member/assignee fields.

## Components and files to reuse

Paths below are relative to `plane/`.

| Concern | Existing implementation |
| --- | --- |
| Peek data fetch and operations | `apps/web/core/components/issues/peek-overview/root.tsx` |
| Container, sizing, scrolling, Escape, portal | `apps/web/core/components/issues/peek-overview/view.tsx` |
| Header menus and peek modes | `apps/web/core/components/issues/peek-overview/header.tsx` |
| Loading and error layout | `apps/web/core/components/issues/peek-overview/loader.tsx`, `error.tsx` |
| Selection store | `apps/web/core/store/issue/issue-details/root.store.ts` |
| Board card interaction and selected styling | `apps/web/core/components/issues/issue-layouts/kanban/block.tsx` |
| Existing opening hook | `apps/web/core/hooks/use-issue-peek-overview-redirection.tsx` |
| Title and rich text | `apps/web/core/components/issues/title-input.tsx`, `description-input.tsx` |
| State and date selectors | `apps/web/core/components/dropdowns/state/`, `date.tsx` |
| Program, level, season selectors | `apps/web/core/components/dropdowns/program-property.tsx`, `level-property.tsx`, `year-property.tsx` |
| Member display patterns | `apps/web/core/components/dropdowns/member/` |
| Labels | `apps/web/core/components/issues/issue-detail/label/` |
| Roster and group assignment | `apps/web/core/components/issues/issue-layouts/kanban/coaching-card-actions.tsx`, `apps/web/core/components/issues/issue-detail/sg-event-detail-page/create-card-roster-picker.tsx` |
| Sport workflow configuration and validation | `apps/web/core/components/issues/issue-layouts/kanban/coaching-card-stage-model.ts`, `use-coaching-card-stage-request.tsx`, `apps/api/plane/utils/coaching_card_lifecycle.py` |
| Comments, editor, avatars, timestamps, actions | `apps/web/core/components/comments/comment-create.tsx`, `comments/card/root.tsx`, `apps/web/core/components/issues/issue-detail/issue-activity/helper.tsx` |
| Activity rendering and loading | `apps/web/core/components/issues/issue-detail/issue-activity/activity-comment-root.tsx`, `activity/activity-list.tsx`, `loader.tsx` |
| Clips and existing HLS player | `apps/web/core/components/issues/issue-detail/coaching-card-clips.tsx`, `coaching-card-clips-model.ts`, `coaching-card-clip-player.tsx` |
| API and shared card types | `apps/web/core/services/issue/issue.service.ts`, `packages/types/src/issues/issue.ts` |
| Backend card and lifecycle endpoints | `apps/api/plane/app/views/issue/coaching_card.py`, `apps/api/plane/app/urls/issue.py` |
| Buttons, menus, badges, popovers, dialogs, tabs, avatars | Existing exports from `@plane/ui` |
| Tooltips, skeletons, notifications | Existing `@plane/propel/tooltip`, `@plane/propel/skeleton`, `@plane/propel/toast` exports |

## Architecture and alternatives

Recommended: specialize the contents of the existing issue peek when the fetched issue is a coaching card. Share header infrastructure and reuse the responsive shell. Add small coaching-specific components for assignment summary, stage progress, property composition, tab content, and adding evidence. Keep ordinary issue rendering unchanged.

An independent coaching drawer would duplicate focus, sizing, Escape, and modal coordination and does not satisfy the requested reuse. Rendering the existing generic issue content unchanged would preserve infrastructure but would not provide the requested workflow, editable coaching fields, or lifecycle clip additions.

## Detail composition

The existing header gains coaching context: issue identifier, card type badge, current stage badge, existing actions, and close. Keep header outside the scroll region. Use Plane primitives and semantic theme tokens rather than prototype color values.

Below it, show the existing editable title plus a roster/group summary. Individual assignment shows jersey, name, and position; group assignment shows the group and Position Group; unassigned cards offer assignment. The overview uses ordered stages from `getCoachingCardConfig`, marking completed/current/future and handling missing configuration without presenting transitions.

Use Plane tabs for Overview, Discussion, and Activity. Overview includes coaching note, properties, clips, and valid workflow controls. Keep active tab local to the selected card; reset it when card identity changes.

The property rows compose existing date, labels, context selectors, and roster assignment UI. Card type and coaching priority use existing select primitives with the server's allowed choices. The stage selector exposes only valid configured transitions through the existing request/confirmation flow. Created by/date and roster position are display properties; position changes belong to roster management. Sport follows project configuration. Editable program/level/season use the dedicated coaching update endpoint so issue fields and card snapshots stay synchronized.

The coaching note reuses Plane's editor with explicit edit/save/cancel. Ensure the displayed description and coaching `feedback` remain synchronized: the save path persists the note's plain text to the coaching endpoint, which already writes the issue description. Do not silently lose unsaved edits on mutation failure. Title edits similarly update both issue name and coaching title through the coaching endpoint.

Discussion composes Plane's existing comment operations, composer, and comment cards. Activity composes its existing issue activity rendering with coaching stage history. Show real recorded lifecycle events and actor origin using the existing activity presentation. Backend mutations must record actor/time for assignment, coaching-field changes, and appended evidence; player review and system advancement use existing lifecycle sources. Do not fabricate player views or practice evidence events.

Workflow controls reuse `getCardStageActions` and `useCoachingCardStageRequest`. Assignment, automatic player review, forward movement, and reopening keep their existing rules. Mount the existing confirmation dialogs with the peek's modal coordination so interacting with a dialog cannot close the peek. Use a footer action region only where it fits the existing flex shell, with no absolute overlay on content.

## Board interaction and routing

Use the current `ControlLink` and work item link behavior for modified clicks, while normal coaching-card activation selects the existing peek store. Track drag activation to suppress the click following a drop. Menu, clip, and selector controls stop card activation. Keyboard Enter opens the card; Escape/close restores focus to the originating card without changing board scroll.

Synchronize coaching selection with a `card` query parameter containing the stable issue UUID. Preserve all other query parameters and the board pathname. Push a history entry on opening a different card, use browser popstate to restore or clear selection, and resolve direct URL selection against the board's current project before fetching. Closing a session-opened selection returns to its board history entry; closing a direct link removes only selection using replacement. Avoid redundant entries and selection loops. Keep this adapter attached to the coaching board/peek flow and feed `setPeekIssue`; do not create another selected-card store.

On mobile, open the same full-width responsive peek instead of invoking the generic mobile page redirect. Board state remains mounted behind it. Respect Plane's existing mode controls and portal stacking.

## Data and additional clips

Open the shell immediately and use the existing detail fetch, cached issue data, and loader. Retrieve stage configuration only for the selected project and lifecycle data when its tab requires it. Do not fetch full detail for every board card. Use MobX observers around detail components and update only affected board summaries.

Add a coach-authorized POST endpoint under the existing coaching-card resource for appending clip evidence. Reuse `CoachingCardClipSerializer`, media validation, project permissions, and transactional row locking. Payload represents one additional clip and its playlist/source context. Persist server-generated identity and creation metadata, retain existing clips, primary source, review state, and stage, and return the updated card. Validate source/range, reject invalid or cross-project media, and prevent duplicate additions on retry. Adding evidence never implicitly advances the workflow.

The Add Clip dialog uses Plane modal/input/select primitives and existing media source selection patterns. Support saved film/practice evidence and a valid HLS source with title and optional start/end range. Resolve each clip's own source: uploaded-source cards must not force subsequent external evidence to use the original uploaded asset. Existing clips retain compatibility with current playlist and source-media shapes.

Render clip rows with title, range/duration, source, and actions. Lazy-load the existing player as needed. Opening a detail or switching tabs does not autoplay. Explicit clip play selects the inline player. Retain the existing retry/player controls and clip-boundary behavior.

## Errors, permissions, and accessibility

Show existing skeletons during fetch. Keep the shell open on fetch failure with Retry and close available. Show Plane toasts for mutation failures, retain user input, and refresh the selected issue and changed board summary after successful mutations. Disable editing for archived cards and users lacking current project permissions; server permission checks remain authoritative.

Use accessible tabs/menus/dialogs, labeled icon controls with tooltips, visible focus rings, and the existing focus behavior. Extend Escape handling to respect local assignment/clip dialogs and editor menus. Empty states explain unassigned cards, no clips, no discussion, and no activity. Theme tokens cover light and dark mode.

## Verification

Add meaningful tests for drag/click separation, routing open/close/back/forward/direct link behavior, configurable stage ordering/actions, clip append preservation/range/source validation/permissions, and coaching metadata synchronization. Reuse existing Node model-test conventions and API contract tests. Run affected type, lint, and API checks, reporting any unavailable services or existing failures.

Exercise the rendered board and peek at desktop/tablet/mobile sizes, light/dark themes, keyboard navigation, modal interactions, real clip playback, note cancellation/save failure, loading/retry/empty states, and unchanged board scroll/filter state after closing. Confirm ordinary issue peek behavior remains intact.
