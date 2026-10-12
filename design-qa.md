# Coaching Card Menu QA

## Scope

Remove the footer stage-picker icon and replace the coaching Kanban three-dot menu with the stage-aware menu shown in the three supplied references. No new entity or backend lifecycle is introduced.

## Visual Evidence

- Source: `/home/aryan-hussain/Downloads/Screenshot 2026-10-12 at 12.31.38 PM.png` (Identified / Film Tagged reference).
- Source: `/home/aryan-hussain/Downloads/Screenshot 2026-10-12 at 12.32.14 PM.png` (Assigned reference).
- Source: `/home/aryan-hussain/Downloads/Screenshot 2026-10-12 at 12.32.36 PM.png` (In Work / Player Reviewed reference).
- The actual source filenames contain a narrow non-breaking space before `PM`. All three images were opened and inspected.
- Implementation screenshot: unavailable. Browser inventory is empty and the in-app browser reports unavailable. Permission for an isolated headless-browser test was requested separately.
- Viewport, density normalization, full-view comparison and focused comparison: not verified without a rendered capture. No pixel-fidelity claim is made.

## Checks

- Menu model tests cover the three reference stages, current project names, final/missing stages, transition restrictions, priority boundaries and card age.
- Component tests render the actual menu/footer with mocked design-system and store boundaries, and verify action order, stage labels, disabled permissions, API payloads, reopen reasons, cancellation, duplicate-submission prevention and the existing board refresh event.
- Existing coaching stage, swimlane, source, peek and optimistic board-update tests are retained.
- These tests do not replace browser checks for popup positioning, keyboard focus, responsive wrapping, typography, spacing, colors or visual icon alignment.

## Intentional Differences

- Stage names come from the current project configuration, not hardcoded prototype names.
- Archive keeps Plane's existing completed/cancelled-state restriction and confirmation modal. The prototype's active-stage archive-with-reason flow is not implemented by the existing API and has not been introduced here.
- Delete is enabled only for project admins in this menu. Existing backend authorization is unchanged.
- Existing recipients and next-stage footer actions remain; only the separate stage-picker icon/dialog is removed.

## Remaining Verification

Open the local board, inspect menus in Identified, Assigned, In Work and Ready for Coach Review, verify icon/title alignment and section spacing at desktop and narrow viewport sizes, and confirm keyboard opening, navigation, Escape and focus restoration. Test follow-up submission, assignment, reason-required reopening and confirmed archive/delete using disposable local cards.

final result: blocked

Blocker: browser-rendered visual and interactive verification is unavailable in this session. This is not a passing visual QA report.
