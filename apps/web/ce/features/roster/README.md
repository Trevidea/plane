# Roster Feature

Community Edition roster UI lives here so the Next.js route folder only defines the URL.

- `components/` contains page, header, table, card, dropdown, and modal UI.
- `store/` contains the React context provider and feature-level state transitions.
- `constants/` contains display, filter, and import mapping constants.
- `utils/` contains formatting and import helpers.

Routes import this feature through `@/plane-web/features/roster`, which keeps the CE alias intact.

## Athlete QR signup

**Generate signup QR** opens a program-scoped registration dialog, including on an
empty roster. It requires active workspace and program roster-management
permissions. **Generate QR** opens a 15-minute session; **Replace QR** invalidates
the previous code. **Close registration** revokes it immediately. Closing the
dialog alone leaves the session open until expiry.

The Player App's **Scan team QR** action previews school/program and supports
signup, existing-account sign-in, and explicit joining by the current account.
Signup matches an existing eligible roster email in the program or creates a new
row. The row shows **Waiting for approval** before account linkage and memberships. One authorized coach/admin clicks **Approve**
in that row to atomically create/reuse Athlete workspace/program memberships and
activate/link the roster entry. Approver and time are recorded. Pending requests
can be approved after the QR expires. Existing active roles are retained. A shared QR
does not verify email ownership. Inactive or removed roster entries cannot be claimed.
Existing invitations cannot link a row while its QR approval is pending.

Players without a roster email can now sign up first, select an existing athlete,
and request approval. Authenticated QR previews expose only eligible athlete names,
jerseys, positions and class, with bounded search/pagination. Blank-email and
matching-email unlinked active entries are eligible; an existing exact-email entry
takes precedence. The roster email stays unchanged until approval. Coaches see the
requesting account's email beside the selected athlete. Decline uses the dedicated
registration action and retains coach-created roster identities; it no longer
removes those athletes. Active athletes remain available in All players and export
while their account claim is pending.

Apply migrations through `db.0139_player_registration_approval` before using this action. Configure
`PLAYER_APP_API_URL` to the same device-reachable origin selected in the Player
App. QR codes are rendered locally with `qrcode.react`.

## Import players with email

Download the updated Excel template in Import roster, or use
`public/templates/roster-template.csv`. Add an optional `Email` column (`Email
Address`, `Player Email`, and `E-mail` also work). Addresses are trimmed and
lowercased. Existing files without Email work as before.

- Matching an existing active workspace member does not grant player access. The
  player signs in through the team link, then an admin or coach approves the
  request for that program. Approval links the existing roster identity and creates
  any missing program membership together, without creating another account.
- Other emails receive a workspace invitation with User role. Importing never
  creates an account or password. Once the recipient accepts (and signs up when
  needed), they must still receive program approval before their account links
  to the imported player.
- Existing pending workspace invitations are reused, keeping their original
  role, without sending duplicate invitations.
- Invalid addresses, repeated emails within a program, and conflicting existing
  account links reject the import. All rows must be valid before any players or
  invitations are committed. For an existing roster player, use **Actions → Edit → Email address** instead
  of reimporting: imports create new rows and duplicate jerseys/emails are rejected.
- The importer needs program roster-management permission and workspace Member
  or Admin permission when the file includes emails. Invited players do not
  receive program coaching permissions automatically.

Run backend migrations before using this feature (`db.0134_roster_player_email`).
Invitation delivery requires configured SMTP, the Celery worker, and its broker.
If sending fails, use the existing workspace invitation settings to resend.
Pending players remain unlinked until program approval. Workspace invitation
acceptance alone does not link a roster account. Player-specific email invitations
also submit program approval requests. Existing approved links remain unchanged.

Program member settings refresh both memberships and workspace profiles on entry
and focus so a newly approved player can appear without reloading the application.

## Roster lifecycle

**All players** lists Active players (including injured athletes) and QR requests
waiting for approval. **Inactive** lists inactive players. Counts use the whole
roster, independent of search/filters; an empty tab retains the table, while an
entirely empty roster retains the Add player/import/QR empty state. Removed players
are excluded from the normal roster.

Coaches/Members and Admins can use **Set inactive**, **Set active**, or **Remove from
roster**. Removing asks for confirmation and preserves the athlete's account and
historical coaching cards with playback. Inactive/removal frees the current jersey
number and revokes shared team film/playlist access. Reactivation does not restore
a freed jersey number; use Edit to assign an available number. Normal status fields
and imports offer Active/Inactive. Legacy injured imports become Active. QR approval
remains a separate **Approve** action and cannot be bypassed by editing status.

The staff **Event log** shows the latest 100 lifecycle events with player/jersey
snapshots, actor, timestamp, and before/after statuses, including Removed players.
No reason is requested. Workspace Admins have a separate **Delete account** action
for linked accounts, including those in the event log. Its separate confirmation
explains that deletion globally removes login, profile photo, memberships, and
athlete-owned cards; shared cards remain for other athletes. Roster removal never
calls account deletion. Backend authorization protects staff/admin/owner accounts.

Apply `db.0140_roster_lifecycle` before using lifecycle controls. The UI uses PATCH
`roster/<id>/` for status, DELETE `roster/<id>/` for removal, GET `roster/events/`
for history, and DELETE `roster/<id>/account/` only after account confirmation.

## Account status

The default **Account status** column is separate from player availability
(Active/Inactive). It is calculated from current server records:

- **Email missing**: no roster email and no account link.
- **Not linked**: an email exists, but the roster has no account link or pending invitation.
- **Invitation pending**: an unanswered workspace invitation exists for that email in this workspace.
- **Linked**: the roster's user field identifies its Plane account, including manually linked players without a roster email.

This indicates invitation/account linkage, not SMTP delivery. Refresh the roster
after a player accepts an invitation to see the updated link. The column can be
hidden through Display settings; player availability remains editable separately.

## Adding an email to an existing player

Use **Actions → Edit**, enter an optional email address, and save. The same field
is available when adding a player. Saving normalizes the email and links an
existing active workspace member; otherwise it creates a User-role invitation.
Existing pending invitations are reused without another email. This requires
workspace invitation permission in addition to roster-management permission.

An already linked player's roster email is read-only, so editing roster details
cannot silently move their account or private feedback to another person.
The edit form displays the linked account's current email using the read-only
`account_email` API field, including manually linked players whose separate
roster email is blank. Account email visibility requires active workspace Member
or Admin access, matching workspace account-email permissions. This display does not copy the account email into the
roster record or send another invitation when other details are saved.
Players without an email remain editable and do not receive an invitation.

## Add one player

Coaches and admins can select **Add player** in the roster header or empty state.
Enter the required player name and optionally email, jersey number, position,
height, weight, class/year, status, and notes, then select **Save player**.
The form uses the existing program roster endpoint and refreshes the roster after
saving. Existing email linking/invitation rules apply when an email is supplied.
