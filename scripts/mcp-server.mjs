#!/usr/bin/env node
// Command bridge; requested frame images may pass through, full videos and exports do not.
import { acceptsRequest, parsePublicOrigin } from './bridge-origin.mjs';
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve, extname, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { createSnipServer } from './mcp-tools.mjs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
if (!existsSync(resolve(root, 'index.html'))) throw new Error('Run npm run build before starting the MCP bridge.');
const bridgeId = randomUUID();
const token = randomBytes(32).toString('hex');
const maxPayload = 8 * 1024 * 1024;
const publicOrigin = parsePublicOrigin(process.env.SNIP_PUBLIC_URL);
let browser, origin, localOrigin;
const pending = new Map();
const contentTypes = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.wasm':'application/wasm', '.woff2':'font/woff2', '.svg':'image/svg+xml', '.png':'image/png', '.txt':'text/plain', '.json':'application/json' };
const http = createServer((req, res) => {
  // Exact Host and Origin checks prevent DNS rebinding and cross-site control.
  if (!acceptsRequest(req.headers, localOrigin, publicOrigin)) { res.writeHead(403).end(); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  let path;
  try { path = decodeURIComponent(new URL(req.url, origin).pathname); } catch { res.writeHead(400).end(); return; }
  const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
  if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type':contentTypes[extname(file)] || 'application/octet-stream', 'Content-Length':statSync(file).size,
    'Cross-Origin-Opener-Policy':'same-origin', 'Cross-Origin-Embedder-Policy':'require-corp', 'X-Content-Type-Options':'nosniff', 'Cache-Control':'no-store' });
  if (req.method === 'HEAD') res.end(); else createReadStream(file).on('error', () => res.destroy()).pipe(res);
});
const ws = new WebSocketServer({ noServer: true, maxPayload });
http.on('upgrade', (req, socket, head) => {
  let url;
  try { url = new URL(req.url, origin); } catch { socket.destroy(); return; }
  if (!acceptsRequest(req.headers, localOrigin, publicOrigin, true) || url.pathname !== '/agent' || url.searchParams.get('token') !== token || browser) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return;
  }
  ws.handleUpgrade(req, socket, head, client => ws.emit('connection', client));
});
ws.on('connection', client => {
  browser = client;
  client.send(JSON.stringify({type:'ready',bridgeId}));
  client.on('error', () => {});
  client.on('message', data => {
    let message; try { message = JSON.parse(data.toString()); } catch { client.close(1007); return; }
    if(message?.type==='ping'){client.send(JSON.stringify({type:'pong'}));return;}
    if (!message || typeof message.id !== 'string') return;
    const request = pending.get(message.id); if (!request) return;
    pending.delete(message.id); clearTimeout(request.timeout);
    if (typeof message.error === 'string') request.reject(new Error(message.error)); else request.resolve(message.result);
  });
  client.on('close', () => {
    if (browser === client) browser = undefined;
    for (const request of pending.values()) { clearTimeout(request.timeout); request.reject(new Error('Editor disconnected. Reconnect and read the project before continuing.')); }
    pending.clear();
  });
});
await new Promise((resolve, reject) => {
  http.once('error', reject);
  http.listen(Number(process.env.SNIP_PORT || 0), '127.0.0.1', resolve);
});
localOrigin = `http://127.0.0.1:${http.address().port}`;
origin = publicOrigin || localOrigin;
const pairingURL = `${origin}/#agent=${token}`;
console.error(`Snip: ${publicOrigin ? 'open this shared link in your browser (the VM needs no browser)' : 'open this link locally, or forward this loopback port to your computer'}, then choose Connect agent:\n${pairingURL}`);

function callBrowser(method, params) {
  if (browser?.readyState !== WebSocket.OPEN) throw new Error(`No editor connected to bridge ${bridgeId} at ${origin}. A tab connected to another bridge is not connected to this process. Use get_connection and open the pairing URL in your browser. On a VM, configure SNIP_PUBLIC_URL with a secure tunnel origin or forward the loopback port. No agent-browser is needed.`);
  if (pending.size >= 16) throw new Error('Too many pending editor requests.');
  const id = randomUUID(), payload = JSON.stringify({ id, method, params });
  if (Buffer.byteLength(payload) > maxPayload) throw new Error('Request exceeds 8 MiB.');
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error('Editor timed out. An edit may have completed; retry with the SAME requestId or read the project.')); }, 60000);
    pending.set(id, { resolve, reject, timeout }); browser.send(payload);
  });
}
const server = createSnipServer(callBrowser, () => ({
  url:pairingURL, bridgeId, connected:browser?.readyState === WebSocket.OPEN,
  mode:publicOrigin?'shared':'loopback', browserRequiredOnAgentHost:false,
  instructions:publicOrigin?'Open the shared URL in your own browser, connect, and choose a video. Keep that tab open.':'Open the URL on this computer. If the agent is remote, forward this loopback port or restart with SNIP_PUBLIC_URL set to your secure tunnel origin.',
}));
const shutdown = () => {
  browser?.terminate(); ws.close(); http.close();
  for (const request of pending.values()) { clearTimeout(request.timeout); request.reject(new Error('MCP bridge stopped.')); }
  pending.clear();
};
const transport = new StdioServerTransport();
await server.connect(transport);
transport.onclose = shutdown;
process.on('SIGINT', () => { shutdown(); process.exit(0); });
process.on('SIGTERM', () => { shutdown(); process.exit(0); });
