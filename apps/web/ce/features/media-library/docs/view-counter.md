# Media Library View Counter

## Previous Behavior

Before this change, media cards and detail views read `meta.views` from the media manifest, but no Media Library frontend code incremented it. Thumbnail display, page load, and playback start all left the counter unchanged unless another process had already written `meta.views`.

## Implemented Behavior

- A view is counted when video playback emits `playing`.
- Thumbnail rendering does not count as a view.
- Failed playback attempts do not count because `playing` is not emitted.
- Repeated play and pause actions in the same browser tab do not count again.
- Reloading the page uses a backend dedupe key and client session marker to avoid immediate duplicate counts for the same media item.
- Authenticated users are deduped by user id.
- Anonymous-capable sessions can send a generated session id; the backend falls back to a user-agent/address hash if no session id is provided.
- View events are stored in the media manifest under `meta.view_events`; the aggregate count is stored in `meta.views`.
- The UI tooltip says: "Views are counted when video playback starts."
