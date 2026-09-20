# Engine verification

Verified with an eight-second 320×180, 30 fps H.264/AAC test-pattern fixture in headless Chromium on Linux.

- `npm run test:engine`: 7 passing tests for deterministic edit state, atomic validation, source identity, revision/retry safety, and timeline math.
- `npm run build`: passed (existing bundle-size advisory remains).
- `npm run test:agent`: MCP discovery/pairing, source-bound JSON, live editor edits, undo/redo, invalid/stale requests, repeat export decoding, cancellation, WebM/mute, and mobile overflow checks passed. See `report.json`.
- `npm run test:keyboard`: existing inline controls, presets, custom speed/zoom, keyboard, reorder timing, reset trim, mobile layout, default export, and project roundtrip checks passed. Updated its obsolete watermark-text assertion to match the current UI.

Two fixed-profile MP4 exports decoded to identical video and audio frame hashes. Output duration was exactly 5 seconds, with expected dimensions and audio. An independent decode of source second 1 matched the first exported frame with mean absolute RGB error 0.551 after encoding. WebM mute produced VP8 with no audio stream and the expected duration. Bundled FFmpeg WASM SHA-256 matches the pinned `@ffmpeg/core` 0.12.10 package.

Reproduction and environment variables are documented in `docs/editing-engine.md`. Video fixtures and export binaries are intentionally not committed.
