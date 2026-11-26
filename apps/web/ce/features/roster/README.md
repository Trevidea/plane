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

The Player App's **Join a team** action previews school/program and supports
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
  account links reject the import. All included rows must be valid before any players or
  invitations are committed. For an existing roster player, use **Actions → Edit → Email address** instead
  of reimporting: imports create new rows and duplicate jerseys/emails are rejected.
- The importer needs program roster-management permission and workspace Member
  or Admin permission when the file includes emails. Invited players do not
  receive program coaching permissions automatically.

Run backend migrations before using this feature, including
`db.0144_roster_invitation_delivery`. Deploy the API and Celery worker together
so the worker recognizes the tracked roster email task. Delivery requires a
configured SMTP relay and broker.

The roster distinguishes account status from invitation email status. In player
details, authorized roster managers can refresh the status and resend an open
player invitation after its retry window. Repeated clicks during the window
do not send another email. An SMTP acceptance is not proof of inbox delivery;
older sends have no tracked outcome, and interrupted attempts can be
unconfirmed. Use **Team join link** when email is missing or delivery cannot
be confirmed.

**Team join link** opens the QR, link and eight-character short code for this
team season. New invitations expire after seven days. Replace QR or Close
registration revokes all three forms; closing the dialog does not. Existing
15-minute sessions have no short code until replaced. Apply migration
`db.0145_team_join_credentials` before deploying this flow. Set
`PLAYER_APP_WEB_URL` to the approved Player web gateway HTTPS origin to offer
browser registration from the join page. Keep Plane's deployment `SECRET_KEY`
stable and shared across API workers; rotating it invalidates current team
links and codes. The coach dialog uses a session version to avoid overwriting
an invitation created in another window.

**Reset password** in Player Details lets authorized program and school staff
issue a one-time code for an active, linked athlete. Accounts with staff rights
or access in another school must go through school IT. A new code replaces the
previous one and expires after 24 hours. Attempts are temporarily rate-limited
per account and network; a wrong attempt does not permanently invalidate a code.
The code is shown only in the issuance dialog; share it privately with the
athlete. Using it signs out the athlete's existing sessions. Apply
`db.0146_player_password_reset` before enabling the updated UI.

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
No reason is requested. Workspace admins can preview deletion impact while the
destructive action remains disabled by default. The preview lists affected
membership, roster, card, and account data, and separates what stays. When enabled,
confirmation is tied to the same admin, account, roster entry, and reviewed impact
for ten minutes. The server
rejects accounts with records linked outside the current workspace and protects
staff/admin/owner accounts. Roster removal never calls account deletion.

Apply `db.0140_roster_lifecycle` before using lifecycle controls. The UI uses PATCH
`roster/<id>/` for status, DELETE `roster/<id>/` for removal, GET `roster/events/`
for history, and GET/DELETE `roster/<id>/account/` for preview and confirmation.

### Team-season migration

`db.0142_team_season_foundation` and `db.0143_backfill_team_seasons` add one
compatibility season per existing sports Program (or Program with a roster).
The Program remains the roster and event boundary; its rules and IDs do not
change. The migration snapshots the current season label, sport, division and
level without inventing calendar boundaries. It never groups Varsity/JV or
matches Programs to a Team by name. Newly created rosters receive a season record
on their first write. Changing a Program's default season does not relabel an
existing roster.

The current Active jersey is known only from the migration observation onward.
Subsequent roster edits, approvals, and removals open or close dated intervals.
An older jersey-only tag remains unresolved when its time has no verified owner;
tags with a saved roster ID continue using that ID. No tag or coaching card is
rewritten.

Live tagging verifies the selected roster member and jersey against the active
assignment at the time Plane accepts the tag preflight, not against a video
timecode. If an assignment changed or is missing, refresh and reselect the player.
Number-only live state cannot select an unknown member automatically. Tags without
a selected player and accountless members without a jersey can still be tagged.
The wire format keeps the previous ID fields for older clients; deploy the Plane
API with the backfill applied before updating Plane Coach.

Rehearse on an isolated copy before rollout. Pause roster/API writers while
applying the migrations and switching all writers to the new API version. Run
`python manage.py audit_team_seasons --workspace <slug>` for a read-only JSON
report of unresolved team links, changed/missing season labels and untracked
jerseys. Resolve team mappings with the school before enabling workflows that
depend on them. If rolling back after live roster writes, roll back the API first
and retain the additive tables; reversing `0142` discards newly recorded jersey
history. Do not drop those tables on a live installation without a backup and a
recovery plan.

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

## Roster updates

Apply `db.0150_roster_notice` before releasing the notice clients. Plane **Inbox → Roster updates**
and Plane Coach **Profile → Notifications → Roster updates** share read state for the same account.
Join requests go only to staff who can approve them for that Program. The link opens the Plane
roster on the **Join requests** tab, where the existing permissions still apply.

Players see approvals, direct additions, and status changes under **Roster updates** in Activity
or the team picker. A QR approval creates one approval notice; a direct link to a returning
account creates a team-added notice. Retrying the same operation does not create another notice.
Notices contain no student names or contact details. They are in-app only and do not change
email invitation dispatch or send push notifications.

### Diagnostic evidence

`roster.api.completed` records a fixed action, outcome and (where known) channel,
using the same operation ID as the initiating UI. Join response `pending` means
the app immediately stopped measuring the request; coach approval is a separate
action. `roster.ui.completed` distinguishes confirmation, rejection, interrupted
navigation, and outcomes the client could not verify. For spreadsheet export it
only confirms that the browser started the download, not that a file was saved.

`roster.invitation.*` also carries a separate delivery-attempt ID through queueing,
retries and SMTP. SMTP acceptance is not proof of inbox delivery. These records
exclude form data, student names, contact details, links, join or reset credentials,
file content and raw mail responses. This step records evidence; analyzer rules,
timing policies and support delivery are separate work.

## Adding an email to an existing player

Use **Actions → Edit**, enter an optional email address, and save. The same field
is available when adding a player. Saving normalizes the email without linking
an account automatically. If there is no current workspace account or invitation,
it creates an Athlete invitation.
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

For a returning athlete, enter their full name and four-digit graduation year
and select **Find matching accounts**. The backend searches previously linked
rosters in the same school, including archived seasons. Verify the athlete's
login email before choosing an account and selecting **Add and link player**.
The confirmation creates membership in the target Program without an invitation
or another join request. It leaves the old roster, tags and cards unchanged.
If there is no reliable match, keep the player unlinked; coaches still approve
player-submitted join requests.

**Import roster** also checks active rows with a four-digit graduation year for
returning accounts. In **Review and import**, explicitly select a suggested
account or keep the row unlinked. Candidates are scoped to the same school; a
previous program name appears only when the coach can see that program. Changing
a player's name, grad year, email, or status clears the selection. A returning
account confirmed and saved through import gets program membership without an
invitation or a second approval request. Historical roster entries, tags, and
cards are unchanged. Unlinked rows still use the existing email and QR flows.

Apply `db.0147_roster_import_receipt` before serving the updated import UI.
If an import is not confirmed, use **Retry import** from the same roster page.
It sends the exact same batch ID, even after closing and reopening the dialog.
The server returns the completed batch without writing rows, memberships, or
invitation attempts again. The receipt stores only row IDs and a keyed request
fingerprint; it does not retain spreadsheet contents. Retry data is held in
memory on the roster page and does not survive a page reload.

Workspace admins with Program roster access can open **Player details → Correct
account link** to fix an unused mistaken link. Choose a verified returning-account
match or leave the entry unlinked. The correction clears the suspect contact
email, revokes the previous Athlete-role membership for that Program, and writes
an event with the actor and old/new account IDs. It does not send mail, delete an
account, or rewrite tag and jersey history. If there are join records, assigned
cards, or activity, use **Revoke access and leave unlinked**. The roster identity
is held so ordinary claims and account relinking cannot transfer its history.
The underlying history is kept. Use the event log to revoke a mistaken link on a
removed roster entry. Releasing a held identity is not part of this workflow.
Apply `db.0149_roster_account_link_hold` before releasing the updated UI.
