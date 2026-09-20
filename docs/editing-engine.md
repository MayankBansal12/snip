# Browser editing engine and agent connection

The original source video plus a versioned JSON specification describes the render. The pure TypeScript engine validates edits, applies commands, and calculates the timeline. React displays that state; browser FFmpeg exports a snapshot. No backend renders or stores video.

## Use JSON without an agent

1. Open a video or `.snip` project in the editor.
2. Choose **Project menu → edit JSON**. The editor hashes the source in 1 MiB chunks and displays its complete specification.
3. Download that JSON, or edit/load JSON in the dialog and choose **apply edits**.
4. Preview the changes and export normally. Applying JSON replaces all edits as one undo step.

JSON contains edit settings, not video bytes. Open the original video (or its self-contained `.snip` project) before applying JSON. Source SHA-256, size, dimensions, and decoded duration must match. Renaming a source does not invalidate the specification. A different decoder reporting different source metadata is rejected rather than silently changing the render.

The envelope is `{ version: 1, renderer: "ffmpeg-wasm-0.12.10-single-v1", source, edits }`. `source` contains `sha256`, `size`, `width`, `height`, `duration`. `edits` is the complete existing version-2 `Edits` structure from `src/types.ts`, with explicit per-clip speed and zoom. Get a complete valid starting document from the editor or `get_project`; partial specifications are rejected. Unknown fields, malformed numbers, invalid ranges, unsupported versions, and mismatched sources are rejected before any mutation. Limit: 8 MiB of JSON.

`.snip` containers remain version 2 and compatible with existing projects. JSON is an additional edit-only interchange format, not a replacement for the portable source-containing project file.

## Connect an agent locally

Requires Node.js 22+ and an MCP client supporting stdio. On the **same device as the browser**:

```sh
npm ci
npm run build
```

Configure the agent's MCP client with an absolute path (adapt the path to your checkout):

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

The bridge serves `dist/` on `127.0.0.1`; it does not run Vite or render media. `SNIP_PORT` is optional (default: a free ephemeral port). A stable port keeps the same browser storage origin across bridge restarts. Use `node` directly in MCP configuration so npm's console output does not enter the stdio protocol.

Ask the agent for `get_connection`, open the returned pairing URL, and choose **connect agent**. Then choose a local video/project in that browser tab. A pairing link is also printed to the bridge's stderr. This is a separate browser origin from the hosted editor; an existing hosted project can be transferred using a downloaded `.snip` file. A bridge running on a remote host cannot pair with your device's loopback browser URL—run it locally.

The bridge accepts one paired tab, binds only to loopback, checks Host and Origin, and requires a fresh random token. Pairing requires a user click; the token is removed from the address bar. The user can disconnect from the editor. Browser reload requires reopening the pairing link and reconnecting. No public REST API is needed, and the bridge never receives source or output video bytes. It receives edit metadata, including existing annotation text.

### Tools

- `get_connection`: pairing URL and connection status.
- `get_project`: session ID, revision, source-bound specification, source/sequence timeline, output dimensions and duration.
- `apply_edits`: an atomic command batch. Every successful batch is one undo step. Existing dialogs/drag interactions and exports block agent mutations.
- `start_export`: creates a browser export job immediately. Supply the current session, revision, and a unique request ID.
- `get_export_status`: latest job, including `running`, `complete`, `failed`, or `cancelled`, progress, and output filename/size.

For example, after reading `get_project`:

```json
{
  "sessionId": "<returned session ID>",
  "revision": 0,
  "requestId": "edit-intro-1",
  "commands": [
    { "action": "splitClip", "clipId": "<existing clip ID>", "sourceTime": 4, "rightClipId": "demo" },
    { "action": "trimClip", "clipId": "<existing clip ID>", "sourceStart": 1, "sourceEnd": 4 },
    { "action": "setSpeed", "clipId": "demo", "speed": 2 },
    { "action": "setZoom", "clipId": "demo", "zoom": { "scale": 2, "x": 0.5, "y": 0.5 } }
  ]
}
```

Other actions are `deleteClip`, `mergeClips` (merge `clipId` with its next timeline neighbor), `reorderClips` (every clip ID exactly once), and `setOutput` (format, resolution, quality, muted). Tool discovery returns full command schemas.

Use `get_project` to obtain the actual current revision; never assume it is zero. Human edits, undo, redo, and JSON imports advance the revision. Opening a project creates a new session. On a timeout, retry the **identical** edit/export request with the same request ID. Reusing an ID with different contents fails. Successful edit receipts persist for the current browser project session, with a hard 10,000-request limit rather than eviction that could accidentally execute old retries. Export retries return the latest matching job; an older completed request ID cannot create a second export.

## Export flow and guarantees

`start_export` captures the current validated edits, locks mutations, and runs FFmpeg in a worker in the open browser. Completion creates a Blob and initiates a browser download. The editor retains **download again** if automatic downloads are blocked. The MCP result reports the filename and byte size; it does not return a remote URL or promise that a file was saved to disk. Keep the browser tab open. Closing the tab stops the render; exports are not durable background jobs.

The default export profile now always uses the bundled FFmpeg 0.12.10 single-thread core, with fixed encoder options, metadata stripping, and the existing explicit timing/zoom math. It bypasses native hardware encoders, automatic thread selection, and source-copy shortcuts. This trades some export speed for repeatability. The older optimized path remains internal and requires an explicit `deterministic=false` call; editor and MCP exports always use the fixed profile.

Contract:

- Same edit state + same explicit commands = same resulting edit state. Command execution has no generated IDs, clock reads, DOM access, or randomness. Split IDs are supplied by the caller; UI-generated IDs become explicit command inputs.
- Source timestamps are finite fractional seconds, with inclusive starts and exclusive ends. Timeline order is array order. Sequence duration is the sum of `(end - start) / speed`. Retiming uses FFmpeg's 90 kHz encoder time base; cuts resolve to decoded frames, so duration can differ by a frame boundary.
- Source clip ranges cannot overlap (existing validator tolerance: 1e-7 seconds). Reordering is supported; repeating/overlapping source footage is not yet supported. At least one positive-duration clip must remain. Splits preserve at least 0.1 seconds on each side.
- Speed is 0.25–4; zoom scale 1–4; zoom x/y 0–1. Speed preserves audio pitch. Zoom uses the existing shared quintic easing, a 0.55-second transition capped at half the incoming clip duration, and 60 fps minimum transition sampling.
- Same source bytes, normalized specification, and rendering environment should yield matching decoded frames, timing, and audio. Tests verify repeated decoded exports. **Byte-identical MP4/WebM files and cross-platform pixel identity are not promised.** Preview remains browser/canvas rendering; source decoding and annotation rasterization can vary between browser environments. Fonts finish loading before annotation export.
- Any future change to render semantics, FFmpeg core, encoder settings, or shared effect/timing math must bump the renderer profile and preserve an old profile or explicitly reject its specifications.

Source hashing and FFmpeg WORKERFS read input incrementally. Memory is still needed for decoded frames, filters/encoders, undo state, and output bytes. The existing 500 MiB source limit is not a RAM budget. Multi-clip filters and large-resolution exports can exceed browser memory; this initial engine does not add streaming output or a memory guarantee.

## Implementation and checks

- `src/engine/index.ts`: pure normalization, specification parsing, commands, timeline compilation, revision/retry receipts.
- `src/engine/validation.ts`: shared schema validation used by legacy project files and the strict engine.
- `src/engine/source.ts`: incremental source hashing.
- `src/agent-connection.ts`: paired browser transport.
- `scripts/mcp-server.mjs`: stdio MCP tools plus local static server/WebSocket bridge.
- `src/export.ts`: validated snapshot export using the fixed profile by default.

```sh
npm run test:engine
npm run build
VIDEO_SAMPLE=/path/to/8-second-320x180-with-audio.mp4 \
FFMPEG_PATH=/path/to/ffmpeg FFPROBE_PATH=/path/to/ffprobe \
CDP_URL=http://127.0.0.1:19410 npm run test:agent
```

The browser suite creates its own MCP bridge and isolated browser context. It checks pairing restrictions, actual MCP edits, invalid/stale batches, retry safety, UI undo/redo, JSON source matching, and two real exports. Native FFmpeg independently checks duration, dimensions, first-frame source alignment, and matching decoded video/audio between exports. It is a test tool only, not an application service.
