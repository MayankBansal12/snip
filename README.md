# snip.

A browser-only video editor for small demos, built with [coss UI](https://coss.com/ui), Base UI, and Tailwind CSS. A preview-first workspace with a right-hand inspector and bottom timeline, using the original neutral palette and yellow accent.

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

Deploy `dist/` to an HTTPS static host. No server API, accounts, cookies, analytics, or video uploads are used. Processing runs in a Web Worker using the locally bundled FFmpeg WebAssembly engine. The first load caches the app and approximately 32 MB of engine files. Offline readiness appears in the workspace footer once the cache is installed. Inter is bundled and cached locally as well.

## Editing

- **Timeline:** actual video thumbnails, a scrubbable playhead, time ruler, and zoom. Split at the playhead, delete middle sections, and drag either edge of each clip. Remaining clips close together automatically. Preview and export both skip removed footage.
- **Undo/redo:** splits, trims, filters, canvas changes, and annotations. Each pointer drag is one undo step. Undo history lasts for the current session.
- **Frame:** original, landscape, portrait, square, social, classic, wide, or a custom aspect ratio. Fit the entire video with a background color and an optional inset, or fill the frame. The inset reveals a border even when the video matches the frame ratio. Choose the edit/export resolution.
- **Crop:** free crop and aspect presets, with draggable selection and corners.
- **Filters:** monochrome, warm, cool, soft, vivid, and original. Intensity, brightness, and contrast controls. Export uses a color lookup table derived from the same transformation as the preview.
- **Annotate:** text, arrows, rectangles, and freehand drawing. Change color and text/stroke size, select and drag to reposition, or delete. Annotations are visible for the entire sequence and are rendered into the export.
- **Playback:** jump to the start or end, play/pause, seek, adjust speed, and toggle audio beside the preview.
- **Speed:** 0.25×–4×, with pitch-preserving audio. The playback selector and Speed panel control the same edit; both speed and mute apply to export.
- **Small screens:** preview and timeline first, collapsible tools, and a preview that stays visible while changing settings. Larger trim handles, native swipe-to-scroll for a zoomed timeline, mobile undo/redo, a side-by-side layout on rotated phones, and a coss project menu for saving/opening projects, opening videos, or clearing the workspace.
- **Keyboard:** press `?` for the shortcut reference, or use the keyboard button. Typing, native form controls, and modal dialogs retain their own behavior.
- **Theme:** flat neutral light/dark surfaces with restrained amber accents (`#f0b100`) and locally bundled Inter. The choice initially follows the system preference and persists locally.

The source video and all edit settings are stored in IndexedDB on this browser and origin. Refresh restores the project; saved projects from the original version migrate without re-uploading. “New video” replaces the current project. The trash button clears the saved project. Browser storage clearing, private browsing, or storage eviction can remove saved work.

## Project files

Choose **Project → Save project** (the folder menu on mobile), or press **Mod S**, to download a `.snip` file to your device. It contains the original video and every edit: clips and trims, crop, frame/background, filters, all annotation types, speed/audio, and export settings. The video is not re-encoded or converted to base64; the file is roughly the source video’s size plus a small manifest.

Use **Open project** on the start screen or in the Project menu, press **Mod Shift O**, or drop a `.snip` file into the editor. The video is embedded, so the original video file is not needed separately. Opening a project replaces the current browser workspace after validation and a successful local save. Invalid, unsupported, and incomplete files leave the existing workspace intact. Imported projects autosave and restore after refresh like ordinary videos.

Project files are snapshots. Later edits continue to autosave in this browser; choose **Save project** again for an updated download. Saving does not overwrite a previously downloaded file automatically. Undo history, playhead position, and device-specific UI preferences are not included. `.snip` files are for reopening in snip; use **Export video** for a playable MP4 or WebM.

Once the production app’s offline cache has finished installing, project open/save, editing, refresh recovery, and video export work without a network connection. A new device still needs an initial online visit. Browser storage can be cleared or evicted; downloaded project files remain in the folder where you saved them.

The embedded source retains the existing 500 MB input limit. It includes footage removed from the timeline. See [the versioned file format](docs/project-format.md) for implementation details.

## Export

MP4 (H.264/AAC) or WebM (VP8/Opus), maximum quality by default. Original canvas resolution and smaller 2160p, 1440p, 1080p, 720p, 480p, and 360p options are offered where applicable. Resolution refers to the short edge; encoded dimensions are even. Exports are re-encoded, not lossless copies. MP4 maximum quality uses CRF 14. No watermark is added.

Input playback depends on browser codec support. MP4 with H.264 and WebM work in current Chromium. The editor is intended for short demos, with a 500 MB input limit. Large or high-resolution projects may exceed available browser memory. Keep the tab open during export; cancellation preserves edits. A frame boundary can create a small rounding difference in exported duration.

## Keyboard

Press **?** to open the reference. `Mod` means ⌘ on Mac or Ctrl on Windows/Linux.

| Action | Shortcut |
| --- | --- |
| Play / pause | Space or K |
| Nudge playhead by 1/30 second | ← / → |
| Move by one second | Shift ← / → |
| Previous / next cut | ↑ / ↓ |
| Start / end | Home / End |
| Split at playhead | S |
| Trim clip start / end to playhead | I / O |
| Delete selected clip or annotation | Delete / Backspace |
| Undo / redo | Mod Z / Mod Shift Z; Ctrl Y also redoes |
| Mute / unmute | M |
| Slower / faster | [ / ] |
| Zoom timeline out / in | − / + |
| Frame / Crop / Filters / Annotate / Speed | 1 / 2 / 3 / 4 / 5 |
| Expand preview | F |
| Open a video / export settings | Mod O / Mod E |
| Save project / open project | Mod S / Mod Shift O |
| Close mobile settings or deselect annotation | Escape |

Text fields and selects keep their native keyboard behavior. Space activates a focused button; K remains available for playback. Editing shortcuts are suspended inside dialogs and during export. Holding a destructive key does not repeatedly modify the project. I/O trimming always preserves at least 0.1 seconds of the clip.

Focus a clip edge and use left/right to trim by 0.1 seconds; Shift trims by one second. Focus the crop and use arrow keys to reposition it. Tab through the editor to reach all controls.

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

The keyboard and responsive suite uses real key events and emulated touch input, including native horizontal swipes and clip-edge dragging:

```sh
VIDEO_SAMPLE=/path/to/8-second-720p-with-audio.mp4 node scripts/verify-interactions.mjs
VIDEO_SAMPLE=/path/to/8-second-720p-with-audio.mp4 node scripts/verify-touch-layout.mjs
```

It checks 320px, 390px, 768px, and 844px layouts, including phone landscape, input/dialog focus protection, mobile project actions, and shortcuts for editing.

The automated suites use separate browser contexts. Native FFmpeg/FFprobe are only test tools for generating input and inspecting downloads; the app itself runs entirely in the browser.

Project portability and failure recovery are checked with:

```sh
VIDEO_SAMPLE=/path/to/8-second-720p-with-audio.mp4 \
FFPROBE_PATH=/path/to/ffprobe \
APP_URL=http://127.0.0.1:5187 \
node scripts/verify-projects.mjs
```

This suite compares the embedded source bytes and all edits, reopens in a fresh browser context offline, refreshes, exports/downloads MP4, tests invalid imports and failed storage writes, and verifies the project controls on small screens.

## UI components

Application controls use the official [coss registry](https://coss.com/ui/docs/get-started): buttons, menus, dialogs, alert dialogs, tabs, selects, fields, sliders, switches, tooltips, progress, badges, and cards. The copied sources live in `src/components/ui`, with import aliases adapted to this Vite app. `components.json` configures the `@coss` registry for additional components.

`src/style.css` defines the existing light/dark palette as coss theme tokens and arranges the workspace. `src/media-canvas.css` contains only the video composition, crop geometry, and clip-track rendering; these are editor-specific interactions rather than replacements for UI controls. Standard component styling stays in coss.

The browser suites use `scripts/ui.mjs` to interact with coss tabs, selects, and menus by their accessible roles. All suites accept `APP_URL`, `CDP_URL`, and `VERIFY_OUTPUT`. Run them against a production preview for offline tests.
