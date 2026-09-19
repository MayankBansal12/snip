# snip.

A browser-only video editor for small demos, built with [coss UI](https://coss.com/ui), Base UI, and Tailwind CSS. A minimal preview and clip timeline, using the original neutral palette and yellow accent.

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

Deploy `dist/` to an HTTPS static host. No server API, accounts, cookies, analytics, or video uploads are used. Processing runs in a Web Worker using the locally bundled FFmpeg WebAssembly engine. The first load caches the app and approximately 32 MB of engine files. Inter is bundled and cached locally as well.

## Editing

Start by choosing **Open a video**, dropping a video onto the page, or pasting a copied video file with **Mod V** when the browser provides it as a clipboard file. Pasting text leaves the page unchanged, and pasting files during editing does not replace the active project. The start screen keeps only the theme toggle in the corner.

- **Timeline:** real thumbnails, a scrubbable playhead, and a compact timeline zoom menu. Split at the playhead and drag either clip edge to trim, with the preview following the edge. Preview and export skip removed footage.
- **Clip controls:** split, merge, speed, and zoom are visible in one row. Merge and delete the selected clip at the right. Timeline zoom sits below the timeline; reset trim and the trimmed duration appear only when footage has been removed.
- **Speed:** presets from 0.25×–4×, including 1.75×, or choose **Custom…** and enter any speed within that range. Enter or Apply commits it; Cancel or Escape discards the draft. Invalid values show an inline error. Audio keeps its pitch.
- **Zoom:** choose a zoom level (1×–4×), then drag the selection over the original video frame to choose what stays in view. Click elsewhere to move the box there, or use arrow keys (Shift for larger steps; Home to center). The main preview updates immediately and output dimensions stay unchanged. Different clip zooms and positions ease into one another over 0.55 seconds in playback and export, capped at half the incoming clip’s duration. Exported camera motion runs at least at 60 fps, even with low-frame-rate recordings. While actions are open, the preview shows the selected framing directly.
- **Merge:** joins adjoining clips with matching speed and zoom. It never restores footage removed between them or discards different clip adjustments. Merge is hidden for a single clip. When pieces cannot be joined, its disabled control explains speed, zoom, zoom-position, or source-gap mismatches on hover and keyboard focus. Splitting preserves the original piece’s adjustments.
- **Undo/redo:** splits, merges, deletion, trims, clip adjustments, and audio/export settings. Each pointer drag is one undo step. History controls stay in the timeline between merge and delete, disabled when unavailable; history lasts for the current session.
- **Playback:** play/pause, scrub the timeline, mute audio, or expand the preview. The displayed time follows the edited sequence, including each clip’s speed. Adjoining clips continue decoding without seeking; trimmed gaps wait for their target frame, and media events keep playback moving if an animation-frame update is delayed.
- **Small screens:** the same preview and timeline, compact actions, larger trim handles, and native horizontal scrolling on a zoomed timeline. Clip actions work with touch as well as a mouse and keyboard.
- **Keyboard:** press `?` or use **Project menu → Keyboard shortcuts**. Typing, native form controls, and open popups retain their own behavior.
- **Theme:** neutral light/dark surfaces with amber accents (`#f0b100`) and bundled Inter. The choice initially follows the system and persists locally.

Frame, crop, filters, and annotations are deferred from the editing interface. Older projects retain these settings in their preview, export, and saved project files.

The source video and all edit settings are stored in IndexedDB on this browser and origin. Refresh restores the project; saved projects from the original version migrate without re-uploading. “New video” replaces the current project. The project menu can clear the saved project. Browser storage clearing, private browsing, or storage eviction can remove saved work.

## Project files

Choose **Project menu → Save project** (the three-dot button), or press **Mod S**, to download a `.snip` file to your device. It contains the original video and every edit: clips and trims, per-clip speed and zoom, audio and export settings, plus any legacy crop, frame, filter, or annotation settings. The video is not re-encoded or converted to base64; the file is roughly the source video’s size plus a small manifest.

Use **Open project** on the start screen or in the Project menu, press **Mod Shift O**, or drop a `.snip` file into the editor. The video is embedded, so the original video file is not needed separately. Opening a project replaces the current browser workspace after validation and a successful local save. Invalid, unsupported, and incomplete files leave the existing workspace intact. Imported projects autosave and restore after refresh like ordinary videos.

Project files are snapshots. Later edits continue to autosave in this browser; choose **Save project** again for an updated download. Saving does not overwrite a previously downloaded file automatically. Undo history, playhead position, and device-specific UI preferences are not included. `.snip` files are for reopening in snip; use **Export video** for a playable MP4 or WebM.

Once the production app’s offline cache has finished installing, project open/save, editing, refresh recovery, and video export work without a network connection. A new device still needs an initial online visit. Browser storage can be cleared or evicted; downloaded project files remain in the folder where you saved them.

The embedded source retains the existing 500 MB input limit. It includes footage removed from the timeline. See [the versioned file format](docs/project-format.md) for implementation details.

## Export

MP4 (H.264/AAC) or WebM (VP8/Opus), maximum quality by default. Original canvas resolution and smaller 2160p, 1440p, 1080p, 720p, 480p, and 360p options are offered where applicable. Resolution refers to the short edge; encoded dimensions are even. The export dialog shows a rough file-size range that updates with your settings and stays visible during processing. It uses the source file and retained footage as a guide; the completed download shows its actual size. The estimate is not a file-size limit and can vary with video content and encoding. Exports are re-encoded, not lossless copies. MP4 maximum quality uses CRF 14. No watermark is added.

Input playback depends on browser codec support. MP4 with H.264 and WebM work in current Chromium. The editor is intended for short demos, with a 500 MB input limit. Large or high-resolution projects may exceed available browser memory. Keep the tab open during export; cancellation preserves edits. A frame boundary can create a small rounding difference in exported duration.

## Keyboard

Press **?** to open the reference. `Mod` means ⌘ on Mac or Ctrl on Windows/Linux.

| Action | Shortcut |
| --- | --- |
| Play / pause | Space |
| Nudge playhead by 1/30 second | ← / → |
| Move by one second | Shift ← / → |
| Focus previous / next clip | ↑ / ↓ |
| Previous / next cut | Shift ↑ / ↓ |
| Start / end | Home / End |
| Split at playhead | S |
| Trim clip start / end to playhead | I / O |
| Delete selected clip | Delete / Backspace |
| Undo / redo | Mod Z / Mod Shift Z; Ctrl Y also redoes |
| Mute / unmute | K |
| Merge compatible neighbor | M |
| Cycle speed / zoom presets | X / Z; Shift reverses |
| Move selected clip earlier / later | Alt ↑ / ↓ |
| Nudge clip start / end by 0.1 seconds | Alt ← / → / Alt Shift ← / → |
| Export with default settings | Mod Shift E |
| Selected clip slower / faster | [ / ] |
| Zoom timeline out / in | − / + |
| Open focused clip actions | Enter or Shift F10 |
| Expand preview | F |
| Open a video / export settings | Mod O / Mod E |
| Save project / open project | Mod S / Mod Shift O |
| Close clip actions | Escape |

Text fields and selects keep their native keyboard behavior. Space plays or pauses when a clip is focused and activates native buttons when they are focused; K toggles sound. Editing shortcuts are suspended inside dialogs and during export. Holding a destructive key does not repeatedly modify the project. I/O trimming always preserves at least 0.1 seconds of the clip.

Focus a clip edge and use left/right to trim by 0.1 seconds; Shift trims by one second. Tab through the editor to reach all controls.

## Verification

The suites run in separate Chromium contexts through Playwright/CDP. Native FFmpeg and FFprobe are test tools only; app processing stays in the browser. The main suite checks selected-clip editing, history, playback boundaries, project recovery, responsive and touch controls, and offline MP4/WebM exports. It compares exported frame pixels to independent crops of the original video.

```sh
VIDEO_SAMPLE=/path/to/8-second-720p-with-audio.mp4 \
FFPROBE_PATH=/path/to/ffprobe \
FFMPEG_PATH=/path/to/ffmpeg \
CDP_URL=http://127.0.0.1:19384 \
APP_URL=http://127.0.0.1:5195 \
node scripts/verify.mjs
```

With the same environment, `scripts/verify-edited-playback.mjs` reproduces the full upload → split into four → change speed/zoom → trim → play/replay workflow through UI controls, including CPU slowdown and saved-project import; it monitors presented video frames as well as playback time. `scripts/verify-playback.mjs` exercises short clips with mixed speeds and zooms, trimmed gaps, replay, delayed frame updates, native source-end recovery, and pausing during a seek. `scripts/verify-zoom.mjs` checks right-click actions, custom speeds, direct zoom selection and undo, and independent frame comparisons during exported zoom and pan transitions. `scripts/verify-projects.mjs` checks legacy project compatibility, every persisted setting, invalid imports, storage failure recovery, offline exports, and mobile project controls. `scripts/verify-start-screen.mjs` checks the minimal start screen, themes, and file-picker, drop, and clipboard imports. Suites accept `VERIFY_OUTPUT` for their reports and screenshots. Run against a production preview for offline tests.

Reports for the current editor are in `verification/minimal-editor/`. Earlier integration reports remain in `verification/coss-ui/`.

## UI components

Application controls use the official [coss registry](https://coss.com/ui/docs/get-started): buttons, menus, popovers, dialogs, alert dialogs, selects, fields, sliders, tooltips, progress, and cards. The copied sources live in `src/components/ui`, with import aliases adapted to this Vite app. `components.json` configures the `@coss` registry for additional components.

`src/style.css` defines the existing light/dark palette as coss theme tokens and arranges the workspace. `src/media-canvas.css` contains only the video composition and clip-track rendering; these are editor-specific interactions rather than replacements for UI controls. Standard component styling stays in coss.

The browser suites use `scripts/ui.mjs` to interact with coss selects and menus by their accessible roles. All suites accept `APP_URL`, `CDP_URL`, and `VERIFY_OUTPUT`. Run them against a production preview for offline tests.

Start-screen layout and file-picker, drop, and clipboard imports can be checked with `VIDEO_SAMPLE=/path/to/8-second-video.mp4 node scripts/verify-start-screen.mjs`.

Run `VIDEO_SAMPLE=/path/to/video.mp4 npm run test:keyboard` against `APP_URL` (default port 5196) with a CDP browser at `CDP_URL` (default port 19384). The fixture must be at least six seconds long. This suite covers the inline toolbar, custom values, keyboard editing, reordering, project roundtrips, mobile layout, and default export.
