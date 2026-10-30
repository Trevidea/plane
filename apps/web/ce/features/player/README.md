# User role: player access

Select **User** in workspace/program member settings or invitations. Its numeric
value is 1; Admin (20), Member (15), and Guest (5) remain distinct. New roster
email invitations use User. Existing Guest memberships and pending invitations
are not converted automatically; an administrator can change their role.

Users enter `/player`, with only assigned programs and personal content. A
program is assigned through an active project membership or an active/injured
roster record linked to their account, plus active workspace membership. Public
program visibility does not count as assignment. Ordinary activities require
an IssueAssignee link. Coaching cards require the linked roster player to be
an explicit recipient; ordinary issue assignment cannot grant access to a
peer's coaching card.

Users can save personal progress/notes, complete their own activities, comment,
react, and edit/delete their own comments. Personal completion and mobile review
acknowledgements are stored in PlayerActivityProgress and do not change shared
work-item state or coaching-card lifecycle review markers. Coach-shared comments
must have EXTERNAL access; INTERNAL coach notes and other players' comments,
identities, and progress remain hidden. Uploaded media is scoped to artifacts
referenced by the assigned activity; HLS requests can read only manifest-listed
resources, not arbitrary neighboring files.

General issue editing/creation, coaching-plan editing, workspace/project settings,
rosters, member directories, searches, exports, and API-key routes are unavailable
to User accounts in the restricted scope. The API guard checks authoritative
workspace/project roles before cached responses or creator exceptions. Workspace
User is an access ceiling over stale higher project roles. A project User role
also restricts that program. Stale invitations cannot promote an existing User;
an admin must change membership explicitly. Guest and Member permissions are
not redefined as read-only.

The web player area is separate from the broad workspace interface. Workspaces
containing a User workspace or project assignment route that account to the player
area. Normal-role access in other workspaces remains available through their own
URLs. User-sensitive frontend caches are keyed by account ID.

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
