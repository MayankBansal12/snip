import { MAX_JSON_BYTES, object } from './engine';
import type { AgentHandler } from './agent-connection';

export const hostedMcpOrigin = (import.meta.env.VITE_SNIP_MCP_ORIGIN as string | undefined)?.trim().replace(/\/$/, '') || '';
export type PairingRequest = { requestId: string; clientName: string; verification: string };
export type HostedPairing = { code: string; pairingExpiresAt: number };

export function connectHostedAgent(handle: AgentHandler, status: (value: string) => void,
  identity: (value: string) => void, request: (value: PairingRequest | null) => void) {
  const origin = new URL(hostedMcpOrigin);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
  if (!window.isSecureContext || origin.origin !== hostedMcpOrigin
    || (origin.protocol !== 'https:' && !(loopback && origin.protocol === 'http:')))
    throw new Error('Snip needs a secure MCP relay origin.');
  const url = new URL('/browser', origin); url.protocol = origin.protocol === 'https:' ? 'wss:' : 'ws:';
  let socket: WebSocket, disposed = false, approved = false, resumeToken: string | undefined;
  let retries = 0, lastReply = Date.now(), pendingRequest: string | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined, reconnect: ReturnType<typeof setTimeout> | undefined;
  let resolveReady: (value: HostedPairing) => void, rejectReady: (error: Error) => void;
  const ready = new Promise<HostedPairing>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });

  const stop = (message: string) => {
    disposed = true; approved = false; clearInterval(heartbeat); clearTimeout(reconnect);
    request(null); status(message); rejectReady(new Error(message));
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
    active.onopen = () => active.send(JSON.stringify({ type: 'hello', resumeToken }));
    active.onerror = () => { /* onclose handles failures and reconnects. */ };
    active.onclose = event => {
      clearInterval(heartbeat);
      if (disposed) return;
      if (event.code === 1008 || event.code === 1000 || retries >= 4) { stop('agent disconnected — copy a new prompt to reconnect'); return; }
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
        identity(message.bridgeId); status(approved ? 'agent connected' : 'waiting for agent');
        if (typeof message.code === 'string' && typeof message.pairingExpiresAt === 'number')
          resolveReady({ code: message.code, pairingExpiresAt: message.pairingExpiresAt });
        return;
      }
      if (message.type === 'pong') { lastReply = Date.now(); return; }
      if (message.type === 'pair_request' && typeof message.requestId === 'string' && typeof message.clientName === 'string' && typeof message.verification === 'string') {
        pendingRequest = message.requestId;
        request({ requestId: message.requestId, clientName: message.clientName, verification: message.verification }); return;
      }
      if (message.type === 'pair_expired' && message.requestId === pendingRequest) { pendingRequest = undefined; request(null); return; }
      if (message.type === 'approved') { approved = true; pendingRequest = undefined; request(null); status('agent connected'); return; }
      if (message.type === 'revoked') { stop('agent disconnected — copy a new prompt to reconnect'); return; }
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
    ready,
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

export function hostedAgentPrompt(pairing: HostedPairing) {
  return `Help me edit the video open in my Snip browser tab. Use Snip's remote MCP server at ${hostedMcpOrigin}/mcp. Add it using your client's Streamable HTTP / OAuth setup if it is not already available. Do not clone Snip for the normal connection.

My temporary pairing code is ${pairing.code}. When authorization opens, tell me to enter this code on the Snip connection page, then approve the matching verification code in my existing Snip tab. The code expires at ${new Date(pairing.pairingExpiresAt).toISOString()}. Authorization must happen in my browser; do not open a headless browser on your machine. If your client cannot add a server from a prompt, explain its one-time MCP setup step.

Use get_connection to confirm the connection, then get_project before editing. Use the returned sessionId and revision. Use get_frame with original-source seconds when visual inspection is needed. Retry an interrupted edit only with the same requestId and payload, or read the project again. Ask what edits I want and let me preview before starting an export. Keep the tab open. Full video and exports stay in my browser; requested frame screenshots are shared with you.

If remote MCP is unsupported or the relay is unavailable, use the local setup at https://github.com/MayankBansal12/snip/blob/main/docs/editing-engine.md as a fallback. An existing project can be transferred to the local editor by saving and reopening its .snip file.`;
}
