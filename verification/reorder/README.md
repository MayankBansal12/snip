# Clip reordering verification

Reproduce with an 8-second video containing audio, Chromium running with CDP, and the app running locally:

```sh
VIDEO_SAMPLE=/path/to/source.mp4 APP_URL=http://127.0.0.1:5199 CDP_URL=http://127.0.0.1:9223 npm run test:reorder
```

The suite generates screenshots, portable projects, exports, and a JSON report under `VERIFY_OUTPUT` (default `/tmp/snip-reorder`). Fixtures and recordings stay outside the repository. If Chromium uses a separate filesystem namespace, `DOWNLOAD_FS_ROOT` can point to that namespace's root for reading its downloaded files.

Checks cover multi-position insertion in both directions; effect preservation; selected-clip preview; one-step undo/redo; cancellation and unchanged drops without history entries; all four Move menu actions and their boundaries; existing Alt-arrow shortcuts; grip/playhead overlap; pausing playback when opening Move; zoomed-timeline autoscroll; 320/390/768px layouts; real Chromium touch events; autosave refresh and portable-project round trips; mixed-speed playback across backward source jumps; and downloaded MP4/WebM duration, audio and independently compared frames.

The export fixture orders source ranges 4–6, 0–2, 2–4 (1.25× speed and zoom), then 6–8 seconds. Its edited duration is 7.6 seconds. Frame comparisons include the final clip to catch animated FFmpeg branches repeating footage past the intended cut.

The production build, engine/chat unit tests, and existing keyboard/editor browser suite also pass. Touch verification uses Chromium events; physical-device testing is not claimed.
