import { MAX_JSON_BYTES, object } from './engine';
import type { AgentHandler } from './agent-connection';

export const hostedMcpOrigin = (import.meta.env.VITE_SNIP_MCP_ORIGIN as string | undefined)?.trim().replace(/\/$/, '') || '';
export type PairingRequest = { requestId: string; clientName: string; verification: string };

export function connectHostedAgent(handle: AgentHandler, status: (value: string) => void,
  identity: (value: string) => void, request: (value: PairingRequest | null) => void, flowId: string) {
  const origin = new URL(hostedMcpOrigin);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
  if (!window.isSecureContext || origin.origin !== hostedMcpOrigin
    || (origin.protocol !== 'https:' && !(loopback && origin.protocol === 'http:')))
    throw new Error('Snip needs a secure MCP relay origin.');
  const url = new URL('/browser', origin); url.protocol = origin.protocol === 'https:' ? 'wss:' : 'ws:';
  let socket: WebSocket, disposed = false, approved = false, resumeToken: string | undefined;
  let retries = 0, lastReply = Date.now(), pendingRequest: string | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined, reconnect: ReturnType<typeof setTimeout> | undefined;

  const stop = (message: string) => {
    disposed = true; approved = false; clearInterval(heartbeat); clearTimeout(reconnect);
    request(null); status(message);
    socket?.close();
  };
  const open = () => {
    if (disposed) return;
    status(resumeToken ? 'reconnecting agent…' : 'connecting agent…');
    const active = new WebSocket(url); socket = active; lastReply = Date.now();
    heartbeat = setInterval(() => {
      if (Date.now() - lastReply > 20_000) { active.close(); return; }
      if (active.readyState === WebSocket.OPEN) active.send(JSON.stringify({ type: 'ping' }));
    }, 5000);
    active.onopen = () => active.send(JSON.stringify({ type: 'hello', resumeToken, ...(!resumeToken ? { flowId } : {}) }));
    active.onerror = () => { /* onclose handles failures and reconnects. */ };
    active.onclose = event => {
      clearInterval(heartbeat);
      if (disposed) return;
      if (event.code === 1008 || event.code === 1000 || retries >= 4) { stop(''); return; }
      status('reconnecting agent…');
      reconnect = setTimeout(open, Math.min(1000 * 2 ** retries++, 8000));
    };
    active.onmessage = async event => {
      if (disposed || active !== socket) return;
      if (typeof event.data !== 'string' || new TextEncoder().encode(event.data).length > MAX_JSON_BYTES) { stop('agent response was too large'); return; }
      let message: Record<string, unknown>;
      try { message = object(JSON.parse(event.data)); } catch { return; }
      if (message.type === 'hosted_ready') {
        if (typeof message.resumeToken !== 'string' || typeof message.bridgeId !== 'string') { stop('invalid relay response'); return; }
        resumeToken = message.resumeToken; approved = message.approved === true; retries = 0; lastReply = Date.now();
        identity(message.bridgeId); status(approved ? 'agent connected' : 'waiting for approval');
        return;
      }
      if (message.type === 'pong') { lastReply = Date.now(); return; }
      if (message.type === 'pair_request' && typeof message.requestId === 'string' && typeof message.clientName === 'string' && typeof message.verification === 'string') {
        pendingRequest = message.requestId;
        request({ requestId: message.requestId, clientName: message.clientName, verification: message.verification }); return;
      }
      if (message.type === 'pair_expired' && message.requestId === pendingRequest) { pendingRequest = undefined; request(null); return; }
      if (message.type === 'approved') { approved = true; pendingRequest = undefined; request(null); status('agent connected'); return; }
      if (message.type === 'revoked') { stop(''); return; }
      if (!approved || typeof message.id !== 'string' || typeof message.method !== 'string') return;
      const respond = (payload: unknown) => {
        if (!disposed && approved && active === socket && active.readyState === WebSocket.OPEN) active.send(JSON.stringify(payload));
      };
      try {
        const result = await handle(message.method, message.params);
        if (new TextEncoder().encode(JSON.stringify({ id: message.id, result })).length > MAX_JSON_BYTES) throw new Error('Project response exceeds 8 MiB.');
        respond({ id: message.id, result });
      } catch (error) {
        respond({ id: message.id, error: error instanceof Error ? error.message : 'Command failed.' });
      }
    };
  };
  open();
  return {
    decide(requestId: string, allow: boolean) {
      if (disposed || socket.readyState !== WebSocket.OPEN) throw new Error('Connection lost. Wait for Snip to reconnect.');
      if (requestId !== pendingRequest) throw new Error('This connection request expired.');
      socket.send(JSON.stringify({ type: 'decision', requestId, approved: allow }));
      pendingRequest = undefined; request(null);
    },
    disconnect() {
      if (!disposed && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'revoke' }));
      stop('');
    },
  };
}

export function hostedAgentPrompt() {
  return `Help me edit a video in my Snip browser tab. Connect to Snip's MCP server at ${hostedMcpOrigin}/mcp (Streamable HTTP with OAuth). If your client can't add it from here, tell me the setup step.

1. When you get the Snip authorization link, send it to me. Don't open it yourself; I'll approve the connection in Snip.
2. Call get_project. If no video is open, ask me to select one in Snip and try again. You can't open files by path.
3. Ask what I want to change, make the edits, and let me preview them before you export.

If the MCP connection doesn't work, tell me what went wrong and wait. Only if I confirm, clone https://github.com/MayankBansal12/snip and follow docs/editing-engine.md for local setup.`;
}
