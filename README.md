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

The optional local MCP bridge lets an agent inspect and edit the open project and start an export. Video stays in the browser; the result is a local download. See [setup, JSON format, and rendering guarantees](docs/editing-engine.md).
