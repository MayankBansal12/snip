// Static onboarding prompt: hosted MCP first when this build has a relay origin, local bridge otherwise.
const repository = 'https://github.com/MayankBansal12/snip';
const setupGuide = `${repository}/blob/main/docs/editing-engine.md`;

const localSetup = `Follow ${setupGuide} to set up Snip's local MCP server, then call get_connection and send me its pairing link. Keep the same MCP process running throughout the session.`;

const editing = `Once connected:
- Call get_project first. If no video is open, ask me to select one. Refresh it whenever the revision is stale.
- Ask what I want changed.
- Use get_frame when an edit depends on what's on screen.
- Apply edits in clear, reversible batches.
- Summarize the result and let me preview it. Call start_export only after I approve.`;

export function agentPrompt(mcpOrigin: string) {
  const connect = mcpOrigin
    ? `Connect to Snip's hosted MCP server at ${mcpOrigin}/mcp and send me the authorization link to approve in my browser. If the hosted connection fails, briefly explain why and ${localSetup[0].toLowerCase()}${localSetup.slice(1)}`
    : localSetup;
  return `Help me edit a video with Snip. The video stays in my browser.

${connect}

${editing}`;
}
