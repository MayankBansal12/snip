# Verification — snip. editor

Tested in Chromium using Agent Browser for visual review and interactions, and the repeatable Playwright suite in `scripts/verify.mjs`. Downloaded files were independently inspected with native FFprobe and FFmpeg. The production TypeScript/Vite build passes.

| Check | Result |
| --- | --- |
| Portable projects | Save/open `.snip`, source SHA-256 equality, every edit and annotation type, drag/drop, Ctrl S and Ctrl Shift O |
| Project recovery | Fresh browser context and refresh offline; clear browser autosave and restore from the downloaded file |
| Invalid projects | 11 malformed/unsupported cases and an aborted storage transaction preserve the previous workspace |
| Imported project export | Offline MP4 download: H.264, 360 × 640, exactly 4.000 s, muted as saved |
| Project controls | Offline open/save at 320 × 640, 390 × 844 and 844 × 390 using mobile emulation |
| Keyboard | Playback, navigation, trim at playhead, split/delete, undo/redo, tools, speed/mute, zoom, open/export, and help; text entry and dialogs protected |
| Touch editing | Clip-edge dragging with undo; swipes pan the zoomed timeline without scrubbing |
| Compact workspace | Collapsible tool settings, sticky portrait preview, mobile undo/redo and project menu |
| Responsive sizes | 320 × 640, 390 × 844, 768 × 1024, and 844 × 390; accessible export remains reachable |
| Branding and interface | Dashed scissors mark, local Inter, neutral light/dark surfaces, no Trim sidebar or editor footer |
| Playback controls | Start/end navigation and speed selection; synchronized with Speed settings |
| Frame background | Inset and custom color persist; exported white border verified at all four corners with native FFmpeg |
| Timeline | Real thumbnails and playhead; From/To inputs removed; ruler adapts to available width |
| Existing saved project | v1 source, trims, and speed migrate correctly without re-upload |
| Split and delete | Split twice, remove the middle, undo and redo, with gaps closed |
| Per-clip trim | Pointer drag and keyboard trims work on both sides of an internal cut; a drag is one undo step |
| Preview playback | Skips deleted footage; playhead displays edited-sequence time |
| MP4 download | 640 × 360, H.264 + AAC, exactly 5.000 s after internal trims |
| Content accuracy | Output frame at 3 s matches expected source frame at 6 s at 49.24 dB PSNR |
| Annotations | Text, arrow, rectangle, and freehand marks are included in the exported image |
| Portrait effects export | 360 × 640 MP4, exactly 2.500 s with cuts, 2× speed, monochrome filter, and all annotation types |
| WebM effects export | Same edited portrait sequence, VP8 + Opus, exported while offline |
| Offline recovery | Clips, filters, portrait canvas, annotations, dark mode, and local Inter survive refresh |
| Custom frame | 3:2 dimensions and 480p selection survive refresh |
| Light/dark mobile layout | 390 × 844 viewport without horizontal overflow |
| Cancel/retry and 4K | Cancellation preserves the project; silent original 3840 × 2160 export succeeds |
| Export playback | Downloaded MP4 reopens and plays in the browser |
| Privacy | No cookies, uploads, third-party requests, or uncaught browser errors during the suite |

Machine-readable results: [report.json](report.json) [interaction-report.json](interaction-report.json), and [project-report.json](project-report.json). Absolute output paths refer to local test artifacts, not public endpoints.

Test inputs are generated fixtures: an 8-second 1280 × 720 motion chart with a 440 Hz tone and a half-second silent 4K chart. No private Downloads recording was transferred. Fixtures, exported videos, and screenshots are not included in the hosted app.

The WebM encoder uses VP8 because VP9 failed in this WebAssembly build during the original implementation. Static offline caching handles the preview server’s `Vary: Origin` header so cold-cache offline module and stylesheet requests work correctly.

The keyboard/touch checks are repeatable with `scripts/verify-interactions.mjs`. `scripts/verify-touch-layout.mjs` additionally checks full-frame crop corners, annotation entry with sticky positioning released, and landscape tool access. These use Chromium with emulated touch input; real iOS/Android hardware was not available.

Project round trips and failed-import recovery are repeatable with `scripts/verify-projects.mjs`. The `.snip` file and exported MP4 were actually downloaded and read from disk; source video bytes were compared using SHA-256. Offline tests include a fresh FFmpeg worker exporting an imported project. Test media, project files, and browser screenshots remain outside the repository.
