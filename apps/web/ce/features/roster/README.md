# Roster Feature

Community Edition roster UI lives here so the Next.js route folder only defines the URL.

- `components/` contains page, header, table, card, dropdown, and modal UI.
- `store/` contains the React context provider and feature-level state transitions.
- `constants/` contains display, filter, and import mapping constants.
- `utils/` contains formatting and import helpers.

Routes import this feature through `@/plane-web/features/roster`, which keeps the CE alias intact.

## Import players with email

Download the updated Excel template in Import roster, or use
`public/templates/roster-template.csv`. Add an optional `Email` column (`Email
Address`, `Player Email`, and `E-mail` also work). Addresses are trimmed and
lowercased. Existing files without Email work as before.

- An existing active workspace member is linked immediately to the player.
- Other emails receive a workspace invitation with User role. Importing never
  creates an account or password. Once the recipient accepts (and signs up when
  needed), their account links to the imported player in that workspace.
- Existing pending workspace invitations are reused, keeping their original
  role, without sending duplicate invitations.
- Invalid addresses, repeated emails within a program, and conflicting existing
  account links reject the import. All rows must be valid before any players or
  invitations are committed. Do not reimport existing players to link them: the
  current import creates new rows, and duplicate jerseys/emails are rejected.
- The importer needs program roster-management permission and workspace Member
  or Admin permission when the file includes emails. Invited players do not
  receive program coaching permissions automatically.

Run backend migrations before using this feature (`db.0134_roster_player_email`).
Invitation delivery requires configured SMTP, the Celery worker, and its broker.
If sending fails, use the existing workspace invitation settings to resend.
Pending players remain unlinked until workspace membership is active.

## Removing linked players

Roster managers can use **Actions → Delete** for players marked **Email missing**
who have neither an email address nor a linked account. A confirmation dialog
names the player before deletion. There is no bulk delete action. Linked players are
protected from direct API deletion. Remove the member from workspace settings instead. This
soft-deletes their linked roster records across all programs in that workspace,
alongside deactivating workspace and project memberships. Unlinked players and
records in other workspaces are preserved. Coaching work items are retained with
their optional roster reference cleared.

## Account status

The default **Account status** column is separate from player availability
(Active/Injured/Inactive/Pending). It is calculated from current server records:

- **Email missing**: no roster email and no account link.
- **Not linked**: an email exists, but the roster has no account link or pending invitation.
- **Invitation pending**: an unanswered workspace invitation exists for that email in this workspace.
- **Linked**: the roster's user field identifies its Plane account, including manually linked players without a roster email.

This indicates invitation/account linkage, not SMTP delivery. Refresh the roster
after a player accepts an invitation to see the updated link. The column can be
hidden through Display settings; player availability remains editable separately.
