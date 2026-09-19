# Minimal editor verification

Production build and 36 editor, project, zoom, and playback browser checks passed on Chromium 152 (2026-09-19). The 8 start-screen checks from the preceding minimal-editor run remain recorded separately.

- 12 editor checks: clip actions via double-click, keyboard and touch; selected-clip speed and zoom; boundary playback; split/merge; mouse/keyboard trimming with live edge preview and history; deletion; portable clip adjustments; offline MP4/WebM exports; responsive layouts and touch scrolling.
- 13 project checks: version-1 compatibility and retained legacy effects, unchanged original video bytes, offline save/open/refresh/export, 14 invalid import cases, storage failure/retry, mobile project actions, and project drag-and-drop.
- 5 zoom checks: right-click/keyboard actions, 1.75× and custom-speed validation and persistence, original-frame selection with edge clamping and one-drag undo, deterministic preview easing, and offline export frame comparisons.
- 6 playback checks: short adjoining clips without unnecessary seeks, trimmed gaps, mixed speeds and zooms, replay, delayed animation frames, native source-end recovery, pause during a seek, and no browser errors.
- 8 earlier start-screen checks: minimal layout, theme persistence, 320/390px and landscape layouts, file picker, drag-and-drop, file paste, validation and refresh recovery.

Mixed-speed exports independently measured 8.000 seconds at 640×360 with audio. Native FFmpeg frame comparisons checked the zoomed middle clip and unchanged neighboring clips. A legacy portrait project exported offline at 360×640 with its original framing, filter and annotations. No browser errors, cookies, external requests, or uploads were observed.

The UI uses coss components; the inspector and advanced tool controls are deferred. Merge joins only adjoining clips with matching adjustments. New .snip saves use container version 2; imports accept versions 1 and 2.

Six exported frames during zoom-in, pan, and zoom-out matched independently cropped reference frames with mean RGB differences below 1 on a 0–255 scale. A project combining 1.75× and 1.37× clips exported at its original 640×360 dimensions with audio and a measured duration of 6.603 seconds.

The playback stall was reproduced by delaying animation frames until the source reached its end while the first clip was still selected. The regression now reaches every clip and the edited end, including when timeupdate events are suppressed. Explicitly pausing during a gap seek keeps playback paused until the user presses Play.

The earlier keyboard and touch scripts were consolidated into `scripts/verify-minimal-editor.mjs`, which is also the `npm run test:browser` entry point. Run it along with `scripts/verify-projects.mjs`, `scripts/verify-start-screen.mjs`, `scripts/verify-zoom.mjs`, and `scripts/verify-playback.mjs`; see the root README for fixture and CDP environment variables.

Clipboard checks dispatch browser clipboard events containing real video bytes. Touch checks use Chromium touch emulation; physical-device testing is not claimed.

The UX review shortened the clip popup, made reset/merge contextual, moved timeline zoom into one menu, and delayed history controls until the first edit while retaining stable button positions. The project menu shows the filename; its duplicate theme entry is visible only on small screens. Keyboard navigation through the compact menus was checked separately.


A separate reproduction run (`scripts/verify-edited-playback.mjs`, `four-clip-report.json`) uploaded an 8-second video through the file picker, split at 2/4/6 seconds, and used the visible clip controls for 1.75×, 0.5×, custom 1.37× speeds and 2×/3×/1.5× zoom. Zoom positions were dragged; clip handles trimmed three source gaps. All six playthroughs completed: adjoining clips, replay, trimmed gaps, 6× CPU slowdown, offline refresh, and saved-project import. The monitor tracked both media time and presented video frames. There were no permanent stalls or browser errors. Trimmed jumps did show brief pauses, with the largest presented-frame gap about 0.38 seconds; this test does not claim seamless gap playback.


The export-size update passed the build, 8 start-screen checks, and 4 focused browser checks recorded in `export-estimate-report.json`. Estimates changed with quality, resolution and format, stayed visible during offline export, and were replaced with the real size on completion. The 360p compact MP4 measured 560,458 bytes within its displayed 0.31–2.4 MB range; WebM measured 860,642 bytes within 0.2–1.6 MB. Both the export dialog and the exact home-page tagline were checked at 320px. These ranges are heuristic guidance, not guaranteed bounds for other videos.
