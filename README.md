# snip.

A browser-only video editor for small demos. A quiet editing workspace inspired by shft.page and Emil Kowalski’s design engineering principles.

## Run

```sh
npm install
npm run dev
```

For offline support, use the production build:

```sh
npm run build
npm run preview -- --port 5186 --strictPort
```

Deploy `dist/` to an HTTPS static host. No server API, accounts, cookies, analytics, or video uploads are used. Processing runs in a Web Worker using the locally bundled FFmpeg WebAssembly engine. The first load caches the app and approximately 32 MB of engine files. Offline readiness is available in the header save-status tooltip once the cache is installed. Inter is bundled and cached locally as well.

## Editing

- **Timeline:** actual video thumbnails, a scrubbable playhead, time ruler, and zoom. Split at the playhead, delete middle sections, and drag either edge of each clip. Remaining clips close together automatically. Preview and export both skip removed footage.
- **Undo/redo:** splits, trims, filters, canvas changes, and annotations. Each pointer drag is one undo step. Undo history lasts for the current session.
- **Frame:** original, landscape, portrait, square, social, classic, wide, or a custom aspect ratio. Fit the entire video with a background color and an optional inset, or fill the frame. The inset reveals a border even when the video matches the frame ratio. Choose the edit/export resolution.
- **Crop:** free crop and aspect presets, with draggable selection and corners.
- **Filters:** monochrome, warm, cool, soft, vivid, and original. Intensity, brightness, and contrast controls. Export uses a color lookup table derived from the same transformation as the preview.
- **Annotate:** text, arrows, rectangles, and freehand drawing. Change color and text/stroke size, select and drag to reposition, or delete. Annotations are visible for the entire sequence and are rendered into the export.
- **Playback:** jump to the start or end, play/pause, seek, adjust speed, and toggle audio beside the preview.
- **Speed:** 0.25×–4×, with pitch-preserving audio. The playback selector and Speed panel control the same edit; both speed and mute apply to export.
- **Theme:** flat neutral light/dark surfaces with restrained green accents and locally bundled Inter. The choice initially follows the system preference and persists locally.

The source video and all edit settings are stored in IndexedDB on this browser and origin. Refresh restores the project; saved projects from the original version migrate without re-uploading. “New video” replaces the current project. The trash button clears the saved project. Browser storage clearing, private browsing, or storage eviction can remove saved work.

## Export

MP4 (H.264/AAC) or WebM (VP8/Opus), maximum quality by default. Original canvas resolution and smaller 2160p, 1440p, 1080p, 720p, 480p, and 360p options are offered where applicable. Resolution refers to the short edge; encoded dimensions are even. Exports are re-encoded, not lossless copies. MP4 maximum quality uses CRF 14. No watermark is added.

Input playback depends on browser codec support. MP4 with H.264 and WebM work in current Chromium. The editor is intended for short demos, with a 500 MB input limit. Large or high-resolution projects may exceed available browser memory. Keep the tab open during export; cancellation preserves edits. A frame boundary can create a small rounding difference in exported duration.

## Keyboard

- Space: play/pause. Left/right: step the playhead; Shift steps one second.
- S: split at the playhead. Delete/Backspace: remove the selected clip or annotation.
- Ctrl/⌘ Z: undo. Ctrl/⌘ Shift Z: redo.
- Focus a clip edge and use left/right to trim by 0.1 seconds; Shift trims by one second.
- Focus the crop and use arrow keys to move it; Shift moves it further.

## Verification

Agent Browser is used for visual and interaction checks. `scripts/verify.mjs` exercises migration, clip editing, preview playback, annotations, dark mode, offline refresh/export, and automatic downloads. FFprobe independently checks exported files. See [verification/README.md](verification/README.md) and [verification/report.json](verification/report.json).

Against a Chromium instance with a CDP port:

```sh
VIDEO_SAMPLE=/path/to/8-second-720p-with-audio.mp4 \
VIDEO_4K_SAMPLE=/path/to/half-second-silent-4k.mp4 \
FFPROBE_PATH=/path/to/ffprobe \
FFMPEG_PATH=/path/to/ffmpeg \
CDP_URL=http://127.0.0.1:19376 \
APP_URL=http://127.0.0.1:5186 \
node scripts/verify.mjs
```

The automated suite uses a separate browser context. Native FFmpeg/FFprobe are only test tools for generating input and inspecting downloads; the app itself runs entirely in the browser.
