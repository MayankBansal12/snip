# JSON editing and local MCP

The TypeScript engine validates edit state and applies atomic commands. React previews that state; browser FFmpeg renders a snapshot. Video bytes stay in the browser.

## Agent onboarding and JSON

On the landing page, hover or tap **use snip with your agent** to copy a complete setup prompt with MCP configuration. Editing commands use JSON internally; the editor does not expose a JSON editing panel.

The envelope is `{ version: 1, renderer: "ffmpeg-wasm-0.12.10-single-v1", source, edits }`. `source` contains the source SHA-256, byte size, width, height, and decoded duration; all must match the open video. `edits` is the complete version-2 `Edits` structure in `src/types.ts`, with explicit per-clip speed and zoom. Use `get_project` to inspect the specification. Unknown fields, invalid ranges, mismatched sources, and unsupported versions are rejected. JSON is limited to 8 MiB and excludes video bytes; `.snip` files still include the source and remain compatible.

## Connect an agent

Run Node.js 22+ on the **same computer as the browser**:

```sh
npm ci
npm run build
```

Configure your stdio MCP client, replacing the absolute path:

```json
{
  "mcpServers": {
    "snip": {
      "command": "node",
      "args": ["/absolute/path/to/snip/scripts/mcp-server.mjs"],
      "env": { "SNIP_PORT": "5188" }
    }
  }
}
```

Call `get_connection`, open its pairing URL, choose **connect agent**, and select a local video. The bridge serves the built editor on loopback and carries edit metadata/status, not video. It accepts one paired tab, checks Host/Origin, and requires a random token and explicit consent. Reopen the pairing URL to reconnect. `SNIP_PORT` is optional; a fixed port preserves the browser storage origin between restarts. Use `node` directly so npm logs do not corrupt stdio. A remote bb preview can test the landing page, editor, and export, but cannot pair with this local-only bridge. Transfer projects between origins using `.snip` files.

## Agent tools

- `get_connection`: pairing URL and connection status.
- `get_project`: session ID, revision, specification, source/sequence timeline, duration, and output dimensions.
- `apply_edits`: `{ sessionId, revision, requestId, commands }`. Supported actions: `splitClip`, `trimClip`, `setSpeed`, `setZoom`, `deleteClip`, `mergeClips`, `reorderClips`, `setOutput`. Tool discovery provides full schemas. Splits require an explicit unique `rightClipId`; merge joins the next timeline neighbor. A batch is one undo step.
- `start_export`: `{ sessionId, revision, requestId }`; returns a job immediately.
- `get_export_status`: latest job status (`running`, `complete`, `failed`, `cancelled`), progress, and output filename/size.

Always read the current session/revision first. Human edits and undo/redo advance revision; opening a project starts a new session. Dialogs, pointer interactions, and exports block agent mutations. After a timeout, retry the identical payload with the same request ID. Edit receipts are retained for the session, capped at 10,000 requests without eviction. Export retries never create another render; only the latest matching job is returned.

To smoke-test with an eight-second video: split at second 4 and set the second clip to speed 2. Expect two clips, six seconds total, and one undo step. Repeat the exact batch to check `duplicate: true`; send a new request ID with the stale revision to check rejection. Export, play the downloaded file, then test cancellation and reconnection.

## Rendering contract

- Same edits and explicit commands produce the same edit state. Times are fractional source seconds, starts inclusive and ends exclusive. Timeline order follows the clips array; duration is the sum of `(end - start) / speed`.
- Clips must have positive duration and cannot overlap in the source (tolerance: 1e-7 seconds). Splits leave at least 0.1 seconds on each side. At least one clip must remain. Very short ranges may contain no video frames; export verifies a decoded video frame and fails rather than downloading an audio-only result.
- Speed: 0.25–4, preserving audio pitch. Zoom: scale 1–4, x/y 0–1. Shared zoom easing lasts up to 0.55 seconds, capped at half the incoming clip duration, with at least 60 fps transition sampling.
- Default exports use bundled FFmpeg 0.12.10, one thread, fixed encoder settings, metadata stripping, and a 90 kHz encoder time base. Native encoding and source-copy shortcuts are bypassed. This can be slower; cuts still resolve to decoded frames.
- Repeatability targets decoded video/audio within the same rendering environment, not byte-identical containers or cross-platform font rasterization. Rendering-semantic changes must bump the profile and either preserve or reject older profiles.
- Keep the tab open. Completion means a downloadable Blob; it does not confirm a disk save. Use **download again** if automatic download is blocked. Hashing and source reads are incremental, but frames, filters, history, and output still consume RAM; the 500 MiB input limit is not a memory budget.

## Checks

Run `npm run test:engine` and `npm run build`. With Chromium running with remote debugging enabled, run the browser/MCP suite:

```sh
VIDEO_SAMPLE=/path/to/8-second-320x180-with-audio.mp4 \
FFMPEG_PATH=/path/to/ffmpeg FFPROBE_PATH=/path/to/ffprobe \
CDP_URL=http://127.0.0.1:19410 npm run test:agent
```

It verifies live edits, retries, invalid/stale batches, undo, drag isolation, same-tab reconnect, cancellation, valid MP4/WebM, sub-frame export failure, and repeated decoded video/audio equality. Native FFmpeg/FFprobe are independent test tools only. `npm run test:keyboard` covers existing editor controls and project roundtrips.
