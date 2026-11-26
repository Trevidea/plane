# Programs Feature

Workspace administrators can open **Programs → Teams and seasons** to create a
stable team, create a new private Program for its season, or explicitly link an
existing Program with season metadata. Creating a season does not copy another
season's roster, staff, tags, or cards. Use roster export/import for returning
players. The school roster view includes unlinked Programs and can be filtered
by season or player name.

Season assignments select existing workspace staff. Coaches get the existing
Program Member role; operators join as Program Guests when they have no existing
membership. The separate roster grant allows adding and editing active roster
entries by name, jersey, position, and graduation year only. It does not grant
invitations, account linking, status changes, or deletions. Removing an assignment
revokes its grant and leaves the underlying Program membership in place. Use
Program member settings to revoke that separate membership.

Apply `db.0148_team_season_admin` before enabling these screens. Existing Program
creation and roster routes remain available. Legacy Programs are not assigned to
teams automatically.
