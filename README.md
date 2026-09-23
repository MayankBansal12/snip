# snip.

a simple video editor for short demos, right in your browser.

![snip video editor with a video preview and clip timeline](docs/images/snip-editor.png)

- trim, split, merge, and reorder clips.
- adjust clip speed and zoom in on what matters.
- export mp4 or webm videos without a watermark.
- autosave your work and download projects to reopen later.
- keep videos on your device and edit offline after the first load.

please report failures by opening an issue. pull requests are welcome.

## JSON editing and agents

Choose **use snip with your agent** in the start screen or editor header to copy a complete setup prompt with MCP configuration. The editor and agent share a validated TypeScript editing core, with undo, revision checks, and retry protection. Browser exports use a fixed FFmpeg profile for repeatability.

The MCP bridge can run locally or on a headless VM behind an authenticated HTTPS tunnel. It lets an agent inspect and edit the open project and start an export. Video stays in the browser; the result is a local download. See [setup, JSON format, and rendering guarantees](docs/editing-engine.md).

## Edit with Jev

Switch from **timeline** to **chat**, type an edit, and press Enter. Try “trim the first 2 seconds”, “split at 4 seconds and make the second clip 2× faster”, or “zoom in a little”. Edits appear immediately and each request is one undo step. “Split 3 seconds after” splits three seconds after the playhead at the moment you submit; “split 3 seconds before” goes backwards, and “split here” uses the playhead itself. The result shows the resolved timestamp. Shift+Enter adds a line; Escape cancels a pending request.

Chat shows the selected clip’s zoom amount and focus, such as **zoom 2× · top left**. Click it to see the original frame and drag the box to choose what stays in view. Use the clip selector to inspect another clip. “Zoom needs to be in top left side” keeps an existing magnification; without a zoom, it starts at 1.5×. “Trim 5 seconds” removes the first five seconds; “trim to 5 seconds” keeps the first five. The result states the applied edit.

Copy `.env.example` to `.env.local` and set `TYPESAFE_API_KEY`, then run `npm install` and `npm run dev`. The Vite development and preview servers serve `/api/edit`; `api/edit.ts` provides the same endpoint on Vercel. Set the key in the deployment's server environment as well. Static-only hosting still supports manual editing, but chat needs this endpoint.

The server makes **one Jev call per prompt**. It identifies instruction boundaries locally and sends each instruction’s action, target and value questions together using [typed Choice questions](https://docs.typesafe.ai/primitives/choice). Relevant answers become an ordered `changes` array, which the server compiles into one validated engine batch. Repeated actions have independent values and targets: “split at 4 and 8 seconds, zoom the middle part to 2×, and zoom the last part to 3×” creates four ordered changes. The response includes both `changes` and the executable `batch`; no partial edits are applied if any step fails.

Use up to **eight edits per prompt**, separated with commas, “and”, “then”, or new lines. Clip numbers refer to the timeline at each step; “original clip 2” preserves the original reference, and “the right part” can refer to an earlier split. Split and trim times are edited timeline seconds, or local seconds when a clip is explicitly named. Requests such as “make it faster then split at 4 seconds” execute in that order. Merge still requires adjacent source ranges with matching speed and zoom. Edits that require inspecting video/audio or generating content are unsupported. The browser sends the prompt and edit settings, never video bytes or filenames. API keys stay server-side. Chat requires a connection; manual editing remains local.

`npm run test:chat` checks command planning and API failures without using a key. `npm run build` checks browser and server types.

With a running server, `node --import tsx scripts/verify-chat-prompts.ts` checks common prompts against real Jev responses, including repeated zoom/speed changes, multi-split plans, per-clip trims, merges, new-part references, relative timing, and edited timelines. Use `PROMPT_SUITE=ordered` to run only the compound-plan cases. The full suite pauses between request windows to respect the server rate limit. Set `SNIP_URL` to override `http://127.0.0.1:52947`.

The browser check also uses live Jev requests: start the preview, then run `VIDEO_SAMPLE=/path/to/eight-second-video.mp4 SNIP_URL=http://localhost:52947 CDP_URL=http://localhost:9223 node scripts/verify-chat.mjs`. It checks ordered multi-edit arrays, one-step undo/redo, the reported split/trim/zoom prompts, crop-box focus and dragging, undo/redo, stale responses, cancellation, failures, mobile layout, and persistence.
