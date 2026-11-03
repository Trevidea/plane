# Coaching card conversations

The coach Thread tab and the player API share `IssueComment` records. EXTERNAL
comments are visible to every assigned recipient and authorized coaching staff.
INTERNAL comments remain staff-only. Multi-recipient cards have one shared thread.

## Authentication and eligibility

Use the existing session cookie on the same API host. Obtain a CSRF token from
`GET /auth/get-csrf-token/`, then sign in with form fields `email` and `password`
at `POST /auth/sign-in/` and header `X-CSRFToken`. Keep the cookie jar enabled.
Use local environment secrets for credentials; do not export them with a collection.
The REST endpoints use the existing BaseSessionAuthentication.

Players must have a linked, active or injured roster entry, an active workspace
membership, and assignment to the card. Project membership is not required.
Archived/deleted projects, archived cards, and removed recipients are inaccessible.
A present `recipient_ids` list is authoritative; legacy cards without that list
use `roster_player_id`. An empty recipient list grants no player access.

## Routes

All paths below start with `/api/`.

| Caller | Method             | Path                                                                              | Result                            |
| ------ | ------------------ | --------------------------------------------------------------------------------- | --------------------------------- |
| Player | GET                | `player/workspaces/{slug}/projects/{project_id}/coaching-cards/{card_id}/thread/` | Paginated shared messages         |
| Player | POST               | same thread path                                                                  | Create shared message (201)       |
| Player | GET                | thread path + `{comment_id}/`                                                     | Read one shared message           |
| Player | PATCH              | thread path + `{comment_id}/`                                                     | Edit own shared message           |
| Player | DELETE             | thread path + `{comment_id}/`                                                     | Delete own shared message (204)   |
| Coach  | GET, POST          | `workspaces/{slug}/projects/{project_id}/issues/{card_id}/comments/`              | Existing coach comments API       |
| Coach  | GET, PATCH, DELETE | coach comments path + `{comment_id}/`                                             | Existing coach comment detail API |

Coaches must set `access: "EXTERNAL"` when posting a shared reply. The Thread
composer defaults to EXTERNAL and offers an access selector for internal notes.
It refreshes every ten seconds and on focus; failed submissions retain their draft.

## Player payloads

POST and PATCH accept only `comment_html`, at most 20,000 characters before
sanitization. HTML must contain nonblank text after sanitization. Unknown fields
(including `actor`, `access`, and `issue`) are rejected. The server sets the actor
from the session and always creates EXTERNAL comments.

```json
{ "comment_html": "<p>Much better today.</p>" }
```

GET list accepts `limit` (1–100, default 50) and `offset` (nonnegative, default 0).
Messages sort oldest first by `created_at`, then `id`. An illustrative response:

```json
{
  "total_count": 1,
  "limit": 50,
  "offset": 0,
  "results": [
    {
      "id": "<comment UUID>",
      "issue": "<card UUID>",
      "actor": "<user UUID>",
      "actor_detail": {
        "id": "<user UUID>",
        "first_name": "A",
        "last_name": "Player",
        "display_name": "A Player",
        "avatar": "",
        "avatar_url": "",
        "is_bot": false
      },
      "comment_html": "<p>Much better today.</p>",
      "comment_stripped": "Much better today.",
      "access": "EXTERNAL",
      "created_at": "2026-10-30T10:00:00Z",
      "updated_at": "2026-10-30T10:00:00Z",
      "edited_at": null
    }
  ]
}
```

POST, GET detail, and PATCH return the message object directly. Successful
player responses use `Cache-Control: private, no-store`. Invalid payloads or
pagination return 400; unauthenticated requests return 403 with this session
authenticator; inaccessible cards and internal messages return 404; changing
another author's shared message returns 403. A deleted message returns 404.
Preserve unsent text after an error, reauthenticate when necessary, and fetch the
thread again before retrying an uncertain POST to avoid duplicate messages.

## Postman and automated checks

Import `coaching-card-thread.postman_collection.json`. Set `baseUrl`,
`workspaceSlug`, `projectId`, and `cardId`; provide `playerEmail` and
`playerPassword` as local secrets. Use a disposable card assigned to that player.
Run in order: sign in, list, create, read, edit, delete. The collection creates
and deletes its own test message. Run the coach request separately with a coach
session; it creates a real shared reply.

```sh
docker compose -f docker-compose-local.yml exec -T api python manage.py test plane.tests.contract.app.test_player_thread --settings=plane.settings.test --noinput --keepdb
node apps/web/core/components/issues/peek-overview/coaching-card/__tests__/thread-store.test.mjs
node apps/web/core/components/issues/peek-overview/coaching-card/__tests__/thread-composer-browser.mjs
```
