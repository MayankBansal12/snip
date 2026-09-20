import { MAX_JSON_BYTES, object } from './engine';
export type AgentHandler = (method: string, params: unknown) => Promise<unknown>;
/** An explicit pairing link connects only to the local bridge serving this app. */
export function connectAgent(token: string, handle: AgentHandler, status: (value: string) => void) {
  if (!['127.0.0.1', 'localhost'].includes(location.hostname) || !/^[a-f0-9]{64}$/.test(token)) throw new Error('Open the pairing link printed by your local MCP bridge.');
  const url = new URL('/agent', location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'; url.searchParams.set('token', token);
  const socket = new WebSocket(url);
  socket.onopen = () => status('agent connected');
  socket.onclose = () => status('agent disconnected');
  socket.onerror = () => status('agent connection failed');
  socket.onmessage = async event => {
    if (typeof event.data !== 'string' || event.data.length > MAX_JSON_BYTES) { socket.close(1009); return; }
    let request: Record<string, unknown>;
    try { request = object(JSON.parse(event.data)); } catch { return; }
    if (typeof request.id !== 'string' || typeof request.method !== 'string') return;
    try {
      const result = await handle(request.method, request.params);
      const response = JSON.stringify({ id: request.id, result });
      if (new TextEncoder().encode(response).length > MAX_JSON_BYTES) throw new Error('Project response exceeds 8 MiB. Use the local JSON dialog.');
      if (socket.readyState === WebSocket.OPEN) socket.send(response);
    } catch (error) {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id: request.id, error: error instanceof Error ? error.message : 'Command failed.' }));
    }
  };
  return () => { socket.onclose = null; socket.onerror = null; socket.close(); };
}
