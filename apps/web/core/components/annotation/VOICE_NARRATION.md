# Voice Narration

## Scope and Original Architecture

This evolves the existing annotation feature. It does not replace Video.js, introduce a second save API, or change production backend code.

The existing component hierarchy remains:

```text
MediaDetailPage (Video.js, media identity, custom-playlist clock, save)
  MediaDetailPreview (player, toolbar/properties/timeline portal hosts)
    VideoAnnotationEditor (annotations, selection, tools, saved baseline)
      Toolbar / properties / shared annotation timeline
      Visual annotation overlay
      Audio playback
```

The original narration hook began recording from the microphone button, added audio directly to the annotation collection, and rendered it in generic timeline moments. Feedback was limited; there was no microphone preparation, review stage, dedicated waveform track, non-destructive trimming, or audio inspector.

## Current Architecture

`VideoAnnotationEditor` composes three existing responsibilities with focused additions:

- `VoiceRecorder` owns browser recording resources and explicit lifecycle transitions. Its injected environment makes MediaRecorder and Web Audio testable without hardware.
- `useVideoAnnotationVoiceNarration` connects the recorder to the actual player clock, microphone devices, permissions, and recording preferences.
- `useNarrationWorkflow` owns draft review, safe replacement, overlap resolution, selection, shortcuts, and commit into the existing annotation array.
- `VoiceNarrationPanel`, `VideoAnnotationRecordingIndicator`, `VoiceNarrationClip`, the waveform, and the input meter provide isolated UI surfaces.
- `useNarrationPreview`, `VideoAnnotationAudioPlayback`, and `useNarrationDucking` handle trimmed preview, synchronized playback, and restoring video volume.

Buttons and inputs reuse `@plane/propel`; menus, microphone selection, and checkboxes reuse `@plane/ui`. Sliders are accessible native ranges, following the annotation editor's existing controls. Icons come from Lucide. Existing tool handlers and `useKeypress` are reused.

## Recording Lifecycle

```text
idle -> preparing -> ready -> countdown -> starting -> recording
recording -> paused -> starting -> recording
recording/paused -> processing -> review -> idle (Done)
active states -> idle (Cancel) or error -> preparing (Check microphone)
```

Selecting the microphone opens preparation and requests microphone access; it does not start MediaRecorder. Device selection and the live input meter establish that the microphone works. Permission, missing/busy/disconnected microphone, silence, and clipping states have explicit feedback.

Start freezes the intended playhead during the optional countdown. At 1x playback, it resumes the video, captures the player timestamp after `play()` settles, and begins recording. Active duration uses `AudioContext.currentTime`, excluding paused periods. Pausing narration also pauses the video; buffering pauses narration and requires an explicit resume. The paused-video recording option keeps the video still while audio continues.

Stop or video-end finalizes the audio, releases microphone tracks, decodes duration/peaks, and opens review. Done commits the draft. Re-recording keeps the original clip until a new take is processed and accepted; cancel/error leaves the original untouched.

Toolbar, timeline seek/zoom, native player controls, save, and editor-close controls are locked during countdown/recording/pause/processing. Unexpected significant seeks abort the take rather than retain misaligned audio. Session changes cancel recording/preview and clear pending overlap decisions. Refreshes of saved annotations do not overwrite local dirty edits or a review draft.

## Data and Saving

Narrations remain `TCustomPlaylistAnnotation` entries with `type: "audio"`, `content`, `mimeType`, `fileSize`, `startTime`, and `endTime`. Optional audio metadata is added:

```ts
audio: {
  sourceDuration: number;
  trimStart: number; // seconds removed from the beginning
  trimEnd: number; // seconds removed from the end, not an absolute endpoint
  volume: number; // 0..1
  ducking: number | null; // multiplier of the user's video volume; null disables
  fadeIn: number; // seconds
  fadeOut: number; // seconds
  peaks?: number[]; // at most 512 normalized peaks for the full source
}
```

Rendered duration is `sourceDuration - trimStart - trimEnd`. Left trim keeps the retained source aligned by moving `startTime`; right trim changes `endTime`. Moving a clip preserves its duration. Handles and numeric controls retain at least 0.1 seconds and constrain the clip to the video. Trimming never rewrites the original audio.

Legacy narrations default to full volume, no ducking, no fades, and their existing duration. The existing normalizer preserves and bounds new metadata. All accepted edits participate in the editor's saved-baseline comparison: create, replace, rename, delete, move, trim, volume, ducking, and fades.

New audio stays in memory as a data URL until the existing Save workflow externalizes it through the media-library API. Save failure retains local audio and dirty state for retry. The API test confirms metadata retention, immutable input, and idempotent repeated externalization. There is no new upload endpoint, schema migration, or separate narration save button.

## Timeline and Playback

Narrations are removed from generic annotation moments and placed in a dedicated horizontal Voice narration track. Non-overlapping clips share a lane; explicitly accepted overlaps use additional lanes. Coordinates, snapping candidates, duration, scrolling, ruler, and zoom reuse the current timeline implementation.

Clips expose selection, waveform, name, duration, trim handles, preview, rename, replace, duplicate, original-audio download, and deletion. Dragging commits once on release. Keyboard trim changes use 0.1 seconds, or 1 second with Shift. The inspector supplies numeric controls when a clip is too narrow to manipulate comfortably.

Overlap comparison uses half-open intervals rounded to milliseconds. Touching endpoints are not overlaps. A conflicting create/move/trim/duplicate requires Replace existing, Add another narration, or Cancel. Concurrent playback is supported; overlap decisions never silently remove another clip.

Playback uses the supplied logical playlist clock rather than raw HLS source timestamps. Each audio element applies source trim, narration volume, fades, and playback rate. It corrects drift greater than 80 ms. A single ducking controller uses the strongest requested reduction among audible, actually playing clips, ramps over 150 ms, and restores the user's video volume on pause, seek, failure, or cleanup. Manual volume changes update the restoration baseline. Manual audio preview pauses the video.

## Performance and Resource Ownership

- Recorder state publishes lifecycle changes, not amplitude or animation frames.
- The input meter draws on an isolated canvas at up to 20 Hz. Silence/clipping labels update only when their status changes.
- The elapsed timer updates its DOM ref every 200 ms without rerendering the editor.
- New audio is decoded once after recording and stores up to 512 peaks. Legacy peak lookup uses a bounded 24-entry cache. Canvas sizing responds to timeline resize/zoom without decoding again.
- Dirty comparison is memoized so base64 audio is not rescanned on every playhead update.
- Recorder generation tokens ignore late permission, playback, decode, and stop callbacks after cancellation/unmount.
- Microphone tracks, Web Audio resources, timers, recorder input listeners, playback RAF loops, resize observers, and navigation listeners are released. Temporary download object URLs are revoked.

## Verification

Verified locally on 2026-09-10 using Node 25.8.1, Chrome, and the existing local Plane API container. No production deployment or production media upload was performed.

- 26 narration unit tests pass: transitions, start/stop, pause/resume, cancel, countdown, errors, delayed callbacks, limits, waveforms, overlap, trims, moves, placement, metadata/dirty comparison, fades, and ducking restoration.
- 10 existing annotation-creation and custom-playlist-clock regression tests pass.
- 7 API media annotation storage tests pass. Ruff lint and format checks pass for the affected Python test.
- The browser integration suite mounts the real editor in React StrictMode and uses actual Chrome MediaRecorder/Web Audio with a synthetic microphone. It verifies countdown timing, pause/resume, processing/review, microphone cleanup, waveform canvas pixels, selection/inspector, failed/successful save, dirty-edit preservation on refresh, trim controls, playback/ducking restoration, replacement cancel/failure, overlaps/lanes/zoom, mobile bounds, permission failure, seek interruption, video-end, and session isolation.
- Desktop 1440x1000 and mobile 390x844 screenshots are written under `/tmp/kanavio-narration-browser`. A representative recorded take started at 4.000 seconds, lasted 4.2 seconds excluding pauses, and produced 512 peaks. These are fixture measurements, not a production latency benchmark.
- Web TypeScript checking passes. Annotation-directory ESLint passes with zero warnings. Prettier is run on changed frontend files.
- Full-web lint remains blocked by five existing errors in opposition-team-property, edition-badge, base-calendar-root, day-view, and use-webhook-video-player, plus a warning count above the existing 821-warning budget. The five errors were reproduced by linting the corresponding unchanged HEAD contents. They are not suppressed or modified here.
- The existing local media-detail route returns HTTP 200. Authenticated production recording/save, physical devices, and cross-browser testing remain separate acceptance checks.

### Commands

From `apps/web`, with workspace dependencies installed:

```bash
pnpm test:narration
pnpm check:types
pnpm exec eslint core/components/annotation --max-warnings 0
node --experimental-strip-types --test core/components/annotation/utils/__tests__/playlist-annotation-creation-time.test.ts ce/features/media-library/utils/__tests__/custom-playlist-timeline.test.mjs
```

The Node tests use native TypeScript stripping and `registerHooks`; use a recent Node 22 release or Node 24+ (the verified version above is 25.8.1).

The browser runner needs Playwright, esbuild, Chrome/Chromium, and a 30-second playable MP4 fixture. Test-only dependencies can be installed outside the workspace without changing runtime dependencies:

```bash
npm install --prefix /tmp/kanavio-browser-tools --no-save esbuild@0.25.0 playwright@1.57.0
ffmpeg -f lavfi -i testsrc2=size=640x360:rate=25 -f lavfi -i sine=frequency=200:sample_rate=48000 -t 30 -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac -movflags +faststart /tmp/kanavio-narration-test.mp4
ESBUILD_PACKAGE_PATH=/tmp/kanavio-browser-tools/node_modules/esbuild PLAYWRIGHT_PACKAGE_PATH=/tmp/kanavio-browser-tools/node_modules/playwright CHROME_PATH=/opt/google/chrome/chrome pnpm test:narration:browser
```

Adjust `CHROME_PATH` for your installation, or omit it when Playwright's Chromium is installed. `NARRATION_TEST_VIDEO` and `NARRATION_SCREENSHOTS` override the fixture and output paths. The runner binds only to loopback, uses fake test microphone input, and closes its browser/server on completion.

From `apps/api` in a configured Python test environment:

```bash
python -m pytest plane/tests/unit/app/test_media_library_annotation_images.py -q
ruff check plane/tests/unit/app/test_media_library_annotation_images.py
ruff format --check plane/tests/unit/app/test_media_library_annotation_images.py
```

## File Inventory

Paths below are relative to `apps/web/core/components/annotation` unless explicitly qualified.

Created:

- `utils/voice-recorder.ts`, `utils/voice-narration.ts`, `utils/narration-ducking.ts`
- `hooks/use-narration-workflow.ts`, `hooks/use-narration-preview.ts`, `hooks/use-narration-ducking.ts`
- `components/voice-narration-panel.tsx`, `components/voice-narration-clip.tsx`, `components/voice-narration-waveform.tsx`
- `components/microphone-input-meter.tsx`, `components/video-annotation-recording-indicator.tsx`
- `components/__tests__/narration-browser-fixture.tsx`
- `utils/__tests__/voice-narration.test.mjs`, `utils/__tests__/voice-recorder.test.mjs`, `utils/__tests__/register-types.mjs`, `utils/__tests__/narration-browser.mjs`
- `VOICE_NARRATION.md`

Modified:

- `components/video-annotation-editor.tsx`, `components/video-annotation-audio-playback.tsx`
- `components/video-annotation-toolbar.tsx`, `components/video-annotation-inline-toolbar.tsx`, `components/video-annotation-timeline-panel.tsx`
- `hooks/use-video-annotation-voice-narration.ts`, `hooks/use-video-annotation-timeline.ts`
- `types/video-annotation-editor.types.ts`, `utils/playlist-annotation-model.ts`
- `apps/web/ce/features/media-library/components/media-detail-page.tsx`, `media-detail-preview.tsx`
- `apps/web/core/components/issues/issue-detail/sg-event-detail-page/sg-event-video-player.tsx`
- `apps/web/core/services/media-library.service.ts`, `apps/web/package.json`
- `apps/api/plane/tests/unit/app/test_media_library_annotation_images.py` (test only)

## Limits and Manual Release Checklist

1. Recording requires a secure context: HTTPS or localhost. HTTP on `plane.local` or a LAN IP cannot prompt for microphone permission. This change does not bypass browser security or alter CORS/CSRF settings.
2. Takes are capped at 30 minutes and 100 MiB. Audio stays in memory until Save; full-page reload discards unsaved takes despite unload warnings. Long-take decoding/peak generation and many simultaneous narrations still need memory/performance profiling. The 30-minute limit is unit-tested with a simulated clock, not a real 30-minute hardware recording.
3. Timing is browser-media synchronized, not sample-accurate studio synchronization. Capture startup/resume and device latency remain platform-dependent. Recording requires 1x speed and a loaded finite video duration. Live streams without a finite editable timeline are not supported.
4. Logical HLS timestamp jumps are unit-tested, but real multi-segment/discontinuous HLS, slow-network buffering, and seek recovery need an authenticated end-to-end manual pass with the actual Video.js player.
5. Verify Chrome/Edge/Firefox/Safari, physical microphone selection/disconnection, denied permission recovery, and real silence/clipping. Safari/iOS volume-control behavior and microphone codec differences are not certified by the Chrome fixture.
6. Verify authenticated Save, reload, and playback from externalized audio URLs. Confirm reverse-proxy request limits for long takes. API helper tests do not replace a real authenticated upload/save test.
7. Original-audio download intentionally includes untrimmed source audio. Server-rendered exports or external consumers must explicitly support the new trim/volume/fade metadata; this work does not add an audio-render export pipeline.
8. Perform a manual regression pass on drawing/text/image annotations, fullscreen/player portals, timeline scrolling, navigation guards, and keyboard use with assistive technology. Anchor-click and browser-unload guards are implemented; arbitrary programmatic navigation still depends on the existing page guard.
9. No database migration or API/worker rebuild is required by these changes. After release checks, build/deploy the `plane-web` image through the existing release process. Nothing has been deployed to production here.
