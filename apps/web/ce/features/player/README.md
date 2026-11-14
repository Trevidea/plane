# User role: player access

Select **User** in workspace/program member settings or invitations. Its numeric
value is 1; Admin (20), Member (15), and Guest (5) remain distinct. New roster
email invitations use User. Existing Guest memberships and pending invitations
are not converted automatically; an administrator can change their role.

User accounts sign in to the normal Plane workspace and program interface.
There is no automatic redirect to `/player`. A User can read all shared items in
an eligible program, including items assigned to other players. Eligibility
requires active workspace membership and active program membership or an
active/injured linked roster record. Public visibility alone does not grant
program access.

Users may save their own work-item layout, grouping, filter and display-property
preferences. These preferences do not change cards or other users’ views.

Shared content is read-only: Users cannot create, edit, delete, move cards,
manage members or rosters, change settings, upload files, or edit annotations.
Private pages, internal comments, account emails, private player conversations,
and individual review records are not exposed by shared-content reads. Member
and Guest permissions remain distinct. Workspace User is a ceiling over stale
higher program roles; a program User role restricts only that program.

The explicit `/player` route and the mobile app still provide personal player
activities. Ordinary activities require an IssueAssignee link. Coaching cards
require the linked roster player to be an explicit recipient. These personal
endpoints allow participants to record their own progress, reviews and comments;
they do not grant general shared-content editing. Coaching-card review completion
records the player's acknowledgement and advances the shared lifecycle when its
configured recipient-review requirements are met.

The API checks authoritative role and program eligibility before response caches
or creator exceptions. Approved read-only responses bypass shared caches and use
private, no-store headers. API-key routes do not inherit these read permissions.
User-sensitive frontend caches are keyed by account ID, and restricted program
reads bypass the local issue database.

## APIs

- `GET /api/player/role/`: the caller's own restricted workspace/project IDs.
- `GET /api/player/assignments/`: assigned programs.
- `GET /api/player/activities/?project_id=...&limit=50&offset=0`: personal content.
- `GET /api/player/workspaces/{slug}/projects/{project}/activities/{issue}/`.
- `PATCH .../{issue}/progress/`: `{ "percent": 0..100, "note": "optional" }`.
- `GET/POST .../{issue}/comments/`: create with `{ "text": "..." }`.
- `PATCH/DELETE .../{issue}/comments/{comment}/`: own comments only.
- `GET/POST/DELETE .../{issue}/reactions/`, and the same under
  `comments/{comment}/reactions/`: mutate with `{ "reaction": "👍" }`.
- `GET .../{issue}/media/{package}/{artifact}/[manifest-resource]`: assigned files.

Run migration `db.0135_user_player_role` after the roster-email migration. No
existing roles or work-item states are rewritten by the migration. Build shared
`@plane/types`, `@plane/constants`, and `@plane/i18n` packages before rebuilding
web. SMTP and workers are still required to deliver invitations.

Tests: Django `test_user_player_role`, `test_player_programs`, and
`test_roster_email_import`; `__tests__/player-area-browser.mjs` checks actual UI
interactions with a fixture API. Set ESBUILD_PACKAGE_PATH, PLAYWRIGHT_PACKAGE_PATH,
and CHROME_PATH as needed for local browser tools.
