# JSON editing and local MCP

The TypeScript engine validates edit state and applies atomic commands. React previews that state; browser FFmpeg renders a snapshot. Video bytes stay in the browser.

## Agent onboarding and JSON

In the landing page or editor header, hover or tap **use snip with your agent** to copy a complete setup prompt with MCP configuration. Editing commands use JSON internally; the editor does not expose a JSON editing panel.

The envelope is `{ version: 1, renderer: "ffmpeg-wasm-0.12.10-single-v1", source, edits }`. `source` contains the source SHA-256, byte size, width, height, and decoded duration; all must match the open video. `edits` is the complete version-2 `Edits` structure in `src/types.ts`, with explicit per-clip speed and zoom. Use `get_project` to inspect the specification. Unknown fields, invalid ranges, mismatched sources, and unsupported versions are rejected. JSON is limited to 8 MiB and excludes video bytes; `.snip` files still include the source and remain compatible.

## Connect an agent

Run Node.js 22+ wherever the agent runs (your computer or a headless VM):

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

Call `get_connection`, open its pairing URL, choose **connect agent**, and select a local video. The bridge serves the built editor on loopback and carries edit metadata/status, not video. It accepts one paired tab, checks Host/Origin, and requires a random token and explicit consent. Reopen the pairing URL to reconnect. `SNIP_PORT` is optional; a fixed port preserves the browser storage origin between restarts. Use `node` directly so npm logs do not corrupt stdio. The default URL is loopback-only; use the remote setup below when the agent runs elsewhere. Transfer projects between origins using `.snip` files.

## Remote agents and headless VMs

The agent host needs Node.js, not a browser or desktop. Open the editor in **your own browser**, choose the video there, and keep the tab open for preview/export. Do not launch `agent-browser` on the VM merely to connect a user.

1. Choose a fixed bridge port, such as `5188`, and expose it through an authenticated HTTPS tunnel that forwards HTTP and WebSocket upgrades. In bb, run `bb connect expose 5188` on the VM (or use `--host <VM-name>` from another enrolled host).
2. Set both variables in the MCP server configuration and restart that MCP process:

   ```json
   "env": {
     "SNIP_PORT": "5188",
     "SNIP_PUBLIC_URL": "https://your-exact-share-origin.example"
   }
   ```

3. Call `get_connection` and give its full pairing URL to the user. A bb share requires the user's bb login. They choose **connect agent**, then select their video; video bytes remain in that browser.

`SNIP_PUBLIC_URL` must be the exact HTTPS origin, without a path, query, or fragment. The process still binds to `127.0.0.1`. Only that configured public origin and the exact loopback Host/Origin pair used by proxies such as bb are accepted; forwarded headers cannot widen the policy. Tokens and explicit consent are still required. `get_connection` reports `mode`, `browserRequiredOnAgentHost: false`, and connection instructions. This is your agent's bridge behind a tunnel, not a central hosted MCP service at snip.mayank.fyi.

SSH forwarding is an alternative that needs no public URL: forward the same local port (`ssh -L 5188:127.0.0.1:5188 user@vm`) and open the loopback pairing link in your computer's browser. If the tunnel closes, manual editing/export in the loaded tab can continue; reconnect to restore agent commands.

A VM-only unattended render still needs a browser runtime today. For automated testing, `test:agent` launches headless Chromium itself when `CDP_URL` is absent. Install a managed browser with `npx playwright-core install chromium`, or set `CHROMIUM_PATH` to an existing Chrome/Chromium executable. Browser system libraries must be installed on the VM. No desktop, display server, or `agent-browser` dependency is required. A file selected by a headless browser and its export live on that VM; this is distinct from the user-browser flow above.

## Agent tools

- `get_connection`: pairing URL and connection status.
- `get_project`: session ID, revision, specification, source/sequence timeline, duration, output dimensions, and `frameTiming` availability/count/policy.
- `apply_edits`: `{ sessionId, revision, requestId, commands }`. Supported actions: `splitClip`, `trimClip`, `setSpeed`, `setZoom`, `deleteClip`, `mergeClips`, `reorderClips`, `setOutput`. Tool discovery provides full schemas. Splits require an explicit unique `rightClipId`; merge joins the next timeline neighbor. A batch is one undo step.
- `start_export`: `{ sessionId, revision, requestId }`; returns a job immediately.
- `get_export_status`: latest job status (`running`, `complete`, `failed`, `cancelled`), progress, output filename/size, and measured `details` (duration, dimensions, frame count/rate, codec, audio).

Always read the current session/revision first. Human edits and undo/redo advance revision; opening a project starts a new session. Dialogs, pointer interactions, and exports block agent mutations. After a timeout, retry the identical payload with the same request ID. Edit receipts are retained for the session, capped at 10,000 requests without eviction. Export retries never create another render; only the latest matching job is returned.

To smoke-test with an eight-second video: split at second 4 and set the second clip to speed 2. Expect two clips, six seconds total, and one undo step. Repeat the exact batch to check `duplicate: true`; send a new request ID with the stale revision to check rejection. Export, play the downloaded file, then test cancellation and reconnection.

## Rendering contract

- Same edits and explicit commands produce the same edit state. Times are fractional source seconds, starts inclusive and ends exclusive. Timeline order follows the clips array; duration is the sum of `(end - start) / speed`.
- Clips must have positive duration and cannot overlap in the source (tolerance: 1e-7 seconds). When source frames can be indexed, UI and agent trims/splits snap to the nearest presentation timestamp (ties go earlier), and splits leave at least one source frame on each side. `get_project.frameTiming` reports availability. Read the project after an agent edit to see snapped ranges. Unsupported, ambiguous, or mismatched timestamps and sources over one million frames use explicitly labeled timestamp trimming; splits then leave at least 0.1 seconds on each side. At least one clip must remain. Very short ranges may contain no video frames; export verifies a decoded video frame and fails rather than downloading an audio-only result.
- Speed: 0.25–4, preserving audio pitch. Zoom: scale 1–4, x/y 0–1. Shared zoom easing lasts up to 0.55 seconds, capped at half the incoming clip duration, with at least 60 fps transition sampling.
- Default exports use bundled FFmpeg 0.12.10, one thread, fixed encoder settings, metadata stripping, and a 90 kHz encoder time base. Native encoding and source-copy shortcuts are bypassed. Profile `ffmpeg-wasm-0.12.10-single-v2` uses decoded frame indices for indexed sources; older rendering profiles are rejected. This can be slower because frame selection decodes from the beginning.
- Repeatability targets decoded video/audio within the same rendering environment, not byte-identical containers or cross-platform font rasterization. Rendering-semantic changes must bump the profile and either preserve or reject older profiles.
- Keep the tab open. Completion means a downloadable Blob; it does not confirm a disk save. Use **download again** if automatic download is blocked. Hashing and source reads are incremental, but frames, filters, history, and output still consume RAM; the 500 MiB input limit is not a memory budget.

## Checks

Run `npm run test:engine`, `npm run test:bridge`, and `npm run build`. For the browser/MCP suite, install Chromium first or supply `CHROMIUM_PATH`. Set `CDP_URL` only to reuse an already-running browser:

```sh
VIDEO_SAMPLE=/path/to/8-second-320x180-with-audio.mp4 \
FFMPEG_PATH=/path/to/ffmpeg FFPROBE_PATH=/path/to/ffprobe \
npm run test:agent
```

It verifies live edits, retries, invalid/stale batches, undo, drag isolation, same-tab reconnect, cancellation, valid MP4/WebM, sub-frame command rejection, and repeated decoded video/audio equality. Native FFmpeg/FFprobe are independent test tools only. `npm run test:keyboard` covers existing editor controls and project roundtrips.

Set `SNIP_TEST_PROXY=1` to run that same browser suite through a separate proxy origin with bb-style Host/Origin rewriting. The bridge suite exercises origin/token restrictions and MCP routing without launching a browser.

For source-frame verification, start `npm run dev` and run:

```sh
EDITOR_URL=http://localhost:5173 \
FFMPEG_PATH=/path/to/ffmpeg FFPROBE_PATH=/path/to/ffprobe \
npm run test:frames
```

This creates 60 fps and variable-rate fixtures and checks keyboard stepping/trimming, source timestamps against FFprobe, one-frame exports at 1×/2×, and independently decoded first/last exported frames. Unsupported browser/container timestamp mismatches remain explicitly labeled as unavailable for frame precision. Export details describe the rendered bytes, including average frame rate for variable-rate output; they are not a downloadable receipt.
