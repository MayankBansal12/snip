import { MAX_JSON_BYTES, object } from './engine';
export type AgentHandler = (method: string, params: unknown) => Promise<unknown>;
/** Pair only with the same origin serving the editor; the bridge validates Origin. */
export function connectAgent(token: string, handle: AgentHandler, status: (value: string) => void, identity: (value: string) => void) {
  if (!window.isSecureContext || !/^[a-f0-9]{64}$/.test(token)) throw new Error('Open the secure pairing link returned by your MCP bridge.');
  const url = new URL('/agent', location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'; url.searchParams.set('token', token);
  const socket = new WebSocket(url);
  let lastReply=Date.now(),disposed=false;
  status('connecting agent…'); identity('');
  const heartbeat=setInterval(()=>{
    if(Date.now()-lastReply>15000){status('agent disconnected');socket.close();clearInterval(heartbeat);return;}
    if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'ping'}));
  },5000);
  socket.onclose = () => { clearInterval(heartbeat); if(!disposed)status('agent disconnected'); };
  socket.onerror = () => { if(!disposed)status('agent connection failed'); };

  socket.onmessage = async event => {
    if (typeof event.data !== 'string' || event.data.length > MAX_JSON_BYTES) { socket.close(1009); return; }
    let request: Record<string, unknown>;
    try { request = object(JSON.parse(event.data)); } catch { return; }
    if(request.type==='ready' && typeof request.bridgeId==='string'){lastReply=Date.now();identity(request.bridgeId);status('agent connected');return;}
    if(request.type==='pong'){lastReply=Date.now();return;}
    if (typeof request.id !== 'string' || typeof request.method !== 'string') return;
    try {
      const result = await handle(request.method, request.params);
      const response = JSON.stringify({ id: request.id, result });
      if (new TextEncoder().encode(response).length > MAX_JSON_BYTES) throw new Error('Project response exceeds 8 MiB. Reduce the project size before inspecting it through the agent.');
      if (socket.readyState === WebSocket.OPEN) socket.send(response);
    } catch (error) {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id: request.id, error: error instanceof Error ? error.message : 'Command failed.' }));
    }
  };
  return () => { disposed=true;clearInterval(heartbeat);socket.onmessage=null;socket.onclose = null; socket.onerror = null; socket.close(); };
}
