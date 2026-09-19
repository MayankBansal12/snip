# coss UI revamp verification

Verified on 2026-09-19 in Chromium against the production build. `npm run build` and `git diff --check` passed.

- 19 media checks: thumbnails, legacy-project migration, playback, split/trim/delete, undo/redo, frame/background, all four annotation types, local fonts, theme persistence, offline MP4 and WebM, cancel/retry, silent 4K export, and playback of downloaded output.
- 12 project checks: exact source-byte preservation, every edit preserved, save/open in a fresh offline context, refresh recovery, malformed-file rejection, storage-failure recovery, offline video export, clearing/restoring, mobile open/save, and drag/drop.
- 18 interaction checks: keyboard controls, text-field protection, focus containment/return, fullscreen, coss project menu, responsive layout at 320/390/768/844 px, touch trim, timeline swipe, and clear/new-video controls.
- 3 touch-layout checks: crop corners, releasing the sticky preview when typing, and preview beside scrollable settings in phone landscape.

No browser errors, external requests, uploads, or cookies were observed. FFprobe independently validated downloaded video codecs, dimensions, duration, and audio. Native FFmpeg checked exported background pixels.

Run the suites with the variables documented in the root README. With Snap Chromium, set `TMPDIR` to a Chromium-readable directory under the user's non-hidden home folders when testing downloads; Snap's private `/tmp` differs from the test runner's `/tmp`.

The media-specific canvas, crop, and timeline interactions retain their own geometry. Standard UI controls use the upstream coss registry sources with only local import paths adapted. Theme and layout live in `src/style.css`.
