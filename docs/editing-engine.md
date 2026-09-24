# JSON editing and MCP

The TypeScript engine validates edit state and applies atomic commands. React previews that state; browser FFmpeg renders a snapshot. Full videos and exports stay in the browser; requested frame screenshots are shared with the agent.

## Agent onboarding and JSON

In the landing page or editor header, hover or tap **use snip with your agent** to copy a setup prompt. Deployments with `VITE_SNIP_MCP_ORIGIN` configured offer the hosted connection first, with **use local setup instead** as a fallback. Without a hosted origin, local setup remains the default. Editing commands use JSON internally; the editor does not expose a JSON editing panel.

The envelope is `{ version: 1, renderer: "ffmpeg-wasm-0.12.10-single-v1", source, edits }`. `source` contains the source SHA-256, byte size, width, height, and decoded duration; all must match the open video. `edits` is the complete version-2 `Edits` structure in `src/types.ts`, with explicit per-clip speed and zoom. Use `get_project` to inspect the specification. Unknown fields, invalid ranges, mismatched sources, and unsupported versions are rejected. JSON is limited to 8 MiB and excludes video bytes; `.snip` files still include the source and remain compatible.

## Connect through the hosted relay

1. Open Snip, choose a video, and click **use snip with your agent → copy prompt**.
2. Paste the prompt into an agent that supports remote MCP. Add the supplied HTTPS `/mcp` URL in the client's MCP settings if needed. Some clients cannot add a server from a prompt and require this one-time setup themselves.
3. When the client's OAuth authorization page opens in your browser, enter the pairing code shown in Snip. Return to the original editor tab, check the verification code matches, and choose **connect agent**. Client names are self-reported; approve only a request you initiated.
4. Ask for edits. The agent calls the same tools described below; the browser validates changes and updates the preview. Review before asking for an export.

The copied prompt contains a temporary pairing code, not an access token. A code alone cannot read or edit the project: the browser must approve the connection. Pairing codes expire after ten minutes; authorization pages after five minutes. Access tokens last up to one hour and rotate through refresh tokens, bounded by a four-hour browser session. Codes are single-use after approval. No Snip account is required.

The relay runs MCP Streamable HTTP with OAuth discovery, dynamic client registration, and S256 PKCE. A client must support that combination; stdio-only clients should use the local fallback. The integration tests exercise the official TypeScript MCP client, including its automatic discovery/authorization flow. Client-specific setup UI can vary.

The agent talks to the relay over HTTPS; the open editor connects outward using a secure WebSocket. Project metadata, edit commands, status, and requested JPEG frames pass through the relay. Full source videos and exported files stay in the browser. The relay can see the metadata and frames in transit, but does not persist them or include them in application logs. It cannot edit or render when the tab is closed or suspended.

The browser retries brief connection losses with exponential backoff. A disconnected session has a 60-second grace period, and commands fail while offline; edits are never queued for replay. Keep the tab open. **disconnect agent**, replacing the source/project, or clearing the project revokes the grant. Refreshing the tab, expiration, or a relay restart requires a new pairing. An agent's existing credentials do not authorize a different tab or project.

### Deploy the HTTPS endpoint on Render

Use one always-on Node web service. [`render.yaml`](../render.yaml) supplies the service configuration, an explicit single instance, and `/healthz` for health checks. [Render supports inbound WebSockets on the same public port as HTTP](https://render.com/docs/websocket).

1. Create a Render Blueprint from this repository and select the branch containing the hosted feature. Review the compute plan before creating the service. Alternatively, create a Node Web Service with build command `npm ci --omit=dev` and start command `npm run mcp:hosted`.
2. Set `SNIP_APP_ORIGINS` to the exact origin serving the editor, such as `https://snip.mayank.fyi`. Multiple allowed editor origins are comma-separated; there are no wildcard origins. The blueprint sets Node 22 and `SNIP_TRUST_PROXY=1` for Render's proxy.
3. Render supplies `PORT` and `RENDER_EXTERNAL_URL`. The service uses that URL as its canonical HTTPS origin unless `SNIP_RELAY_ORIGIN` is set. The MCP endpoint is **`https://<your-service>.onrender.com/mcp`**.
4. In the website's build environment, set **`VITE_SNIP_MCP_ORIGIN=https://<your-service>.onrender.com`**, without `/mcp`, then rebuild/redeploy the website. The editor can stay on its existing host.
5. For a custom domain such as `mcp.snip.mayank.fyi`, configure its DNS/TLS in Render, set `SNIP_RELAY_ORIGIN=https://mcp.snip.mayank.fyi` on the relay, and update `VITE_SNIP_MCP_ORIGIN` on the website. Requests must use that canonical Host. If a browser-based MCP client sends an Origin header, add its exact origin to `SNIP_CLIENT_ORIGINS`; this does not authorize it as an editor browser.
6. Check `/healthz`, confirm unauthenticated `/mcp` returns 401 with OAuth metadata, and run the pairing/edit/export flow using your actual agent client.

There is no database dependency in this version. Connection routing, OAuth registrations, and grants live in process memory. **Run exactly one Node process/instance; do not enable autoscaling or cluster workers.** A restart invalidates pairings and OAuth registrations. Reconnect/re-register the client after a restart; clients that retain invalid registration credentials may need their Snip connection removed and re-added. Multiple instances would require shared authorization state and routing/pub-sub to the process holding each browser socket.

The relay binds to `0.0.0.0` for managed hosting and expects the platform to terminate HTTPS. Keep its internal HTTP port behind that proxy. Outside Render, set `SNIP_RELAY_ORIGIN` explicitly; HTTP origins are accepted only for loopback development. Leave `SNIP_TRUST_PROXY=0` unless the service is behind a known proxy that supplies the client address, and set it to that proxy's hop count. The server ignores forwarded Host/Origin for trust decisions. Pairing, OAuth, and MCP requests have size/rate/capacity limits. Configure proxy access logs to omit credentials and query strings as well.

Local development, in two terminals (Node does not automatically load `.env.local` for the relay):

```sh
SNIP_RELAY_ORIGIN=http://127.0.0.1:5189 SNIP_APP_ORIGINS=http://localhost:5173 PORT=5189 npm run mcp:hosted
VITE_SNIP_MCP_ORIGIN=http://127.0.0.1:5189 npm run dev -- --port 5173 --strictPort
```

Open `http://localhost:5173`, matching the configured editor origin exactly. The relay does not need a frontend build or a browser runtime.

## Local setup fallback

Use a fresh directory to preserve existing work. Run Node.js 22+ wherever the agent runs (your computer or a headless VM):

```sh
git clone --branch main --single-branch https://github.com/MayankBansal12/snip.git snip-agent
cd snip-agent
git branch --show-current
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

Call `get_connection`, open its pairing URL, choose **connect agent**, and select a local video. The bridge serves the built editor on loopback and carries edit metadata/status and requested frame screenshots, not full video files. It accepts one paired tab, checks Host/Origin, and requires a random token and explicit consent. Reopen the pairing URL to reconnect. `SNIP_PORT` is optional; a fixed port preserves the browser storage origin between restarts. Use `node` directly so npm logs do not corrupt stdio. The default URL is loopback-only; use the remote setup below when the agent runs elsewhere. Transfer projects between origins using `.snip` files.

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

- `get_connection`: bridge ID and connection status. Hosted mode reports the approved browser session and its expiration. Local/shared mode also returns a pairing URL; keep the same stdio process for pairing and edits because another process has its own token and connection. The disconnect button's tooltip identifies the bridge. Heartbeats clear stale connection state after a lost connection.
- `get_frame`: original-source JPEG at `sourceTime` (seconds), with `sessionId` and `revision` from `get_project`. Returns an MCP image up to 1280px plus dimensions/time metadata, without moving playback. It does not include edits or overlays; the pairing dialog discloses that requested frames are shared.
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

Run `npm run test:engine`, `npm run test:bridge`, `npm run test:hosted`, and `npm run build`. The hosted suite checks origin/Host restrictions, OAuth discovery, approval, PKCE/resource/client binding, code reuse, grant expiry/revocation, cross-user routing, frame responses, reconnect, and pending request isolation. For browser/MCP suites, install Chromium first or supply `CHROMIUM_PATH`. Set `CDP_URL` only to reuse an already-running browser:

```sh
VIDEO_SAMPLE=/path/to/8-second-320x180-with-audio.mp4 \
FFMPEG_PATH=/path/to/ffmpeg FFPROBE_PATH=/path/to/ffprobe \
npm run test:agent
```

It verifies live edits, retries, invalid/stale batches, undo, drag isolation, same-tab reconnect, cancellation, valid MP4/WebM, sub-frame export failure, and repeated decoded video/audio equality. Native FFmpeg/FFprobe are independent test tools only. `npm run test:keyboard` covers existing editor controls and project roundtrips.

Set `SNIP_TEST_PROXY=1` to run that same browser suite through a separate proxy origin with bb-style Host/Origin rewriting. The bridge suite exercises origin/token restrictions and MCP routing without launching a browser.

`VIDEO_SAMPLE=/path/to/8-second-320x180-with-audio.mp4 npm run test:agent:hosted` starts an isolated Vite editor and relay, uses the SDK's standard OAuth client plus real browser consent, then verifies edits/retries/undo, frame capture, an independently probed export, reconnect, mobile layout, and project-replacement revocation. It needs Chromium and `ffprobe` (or `FFPROBE_PATH`). Screenshots and the export go to `/tmp/snip-hosted-verification`, overridable with `VERIFY_OUTPUT`.
