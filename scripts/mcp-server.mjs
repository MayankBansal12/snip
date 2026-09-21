#!/usr/bin/env node
// Local command bridge only. Source video and exported bytes never pass through it.
import { acceptsRequest, parsePublicOrigin } from './bridge-origin.mjs';
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve, extname, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
if (!existsSync(resolve(root, 'index.html'))) throw new Error('Run npm run build before starting the MCP bridge.');
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
  client.on('error', () => {});
  client.on('message', data => {
    let message; try { message = JSON.parse(data.toString()); } catch { client.close(1007); return; }
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
  if (browser?.readyState !== WebSocket.OPEN) throw new Error('No editor connected. Use get_connection and open the pairing URL in your browser. On a VM, configure SNIP_PUBLIC_URL with a secure tunnel origin or forward the loopback port. No agent-browser is needed.');
  if (pending.size >= 16) throw new Error('Too many pending editor requests.');
  const id = randomUUID(), payload = JSON.stringify({ id, method, params });
  if (Buffer.byteLength(payload) > maxPayload) throw new Error('Request exceeds 8 MiB.');
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error('Editor timed out. An edit may have completed; retry with the SAME requestId or read the project.')); }, 60000);
    pending.set(id, { resolve, reject, timeout }); browser.send(payload);
  });
}
const string = { type:'string', minLength:1, maxLength:128 };
const number = { type:'number' };
const command = (action, properties, required = Object.keys(properties)) => ({ type:'object', properties:{ action:{const:action}, ...properties }, required:['action',...required], additionalProperties:false });
const clipId = { clipId:string };
const commands = [
  command('splitClip', {...clipId, sourceTime:number, rightClipId:string}),
  command('trimClip', {...clipId, sourceStart:number, sourceEnd:number}),
  command('setSpeed', {...clipId, speed:{type:'number',minimum:.25,maximum:4}}),
  command('setZoom', {...clipId, zoom:{type:'object',properties:{scale:{type:'number',minimum:1,maximum:4},x:{type:'number',minimum:0,maximum:1},y:{type:'number',minimum:0,maximum:1}},required:['scale','x','y'],additionalProperties:false}}),
  command('deleteClip', clipId), command('mergeClips', clipId),
  command('reorderClips', {clipIds:{type:'array',items:string,minItems:1,maxItems:10000}}),
  command('setOutput', {format:{enum:['mp4','webm']},resolution:{enum:['original','2160','1440','1080','720','480','360']},quality:{enum:['maximum','compact']},muted:{type:'boolean'}}, []),
];
const empty = {type:'object',properties:{},additionalProperties:false};
const revision = {sessionId:string, revision:{type:'integer',minimum:0}, requestId:string};
const tools = [
  {name:'get_connection',description:'Get the browser pairing URL and setup guidance. For VMs, configure SNIP_PUBLIC_URL with a secure tunnel origin or forward the loopback port. The agent runs here; the user opens the editor in their own browser. No agent-browser or desktop is needed on the VM.',inputSchema:empty},
  {name:'get_project',description:'Read the open browser project, source SHA-256, sessionId, revision, JSON specification, source-time clip ranges and sequence-time timeline. Does not return video bytes.',inputSchema:empty},
  {name:'apply_edits',description:'Atomically apply an undoable batch to the open project. Read get_project first. Times are seconds in the original source; ends are exclusive. Use explicit unique rightClipId for splits. Merge clipId with its following timeline neighbor. Retrying must reuse the exact requestId and payload. Different source clips cannot overlap. At least one clip must remain.',inputSchema:{type:'object',properties:{...revision,commands:{type:'array',items:{oneOf:commands},minItems:1,maxItems:1000}},required:[...Object.keys(revision),'commands'],additionalProperties:false}},
  {name:'start_export',description:'Start fixed-profile FFmpeg export of the current revision in the connected browser. Returns a job immediately. Keep the tab open and poll get_export_status. Output is a browser download, not a server file or remotely accessible URL. Reuse requestId on retries.',inputSchema:{type:'object',properties:revision,required:Object.keys(revision),additionalProperties:false}},
  {name:'get_export_status',description:'Read the latest browser export job: running, complete, failed, or cancelled, plus progress and filename/size. Complete means the browser has a downloadable Blob; it does not prove the user saved it. Returns null before any export.',inputSchema:empty},
];
const server = new Server({name:'snip',version:'1.0.0'}, {capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema, async () => ({tools}));
server.setRequestHandler(CallToolRequestSchema, async request => {
  try {
    if (!tools.some(tool => tool.name === request.params.name)) throw new Error('Unknown tool.');
    const result = request.params.name === 'get_connection' ? {url:pairingURL,connected:browser?.readyState === WebSocket.OPEN,mode:publicOrigin?'shared':'loopback',browserRequiredOnAgentHost:false,instructions:publicOrigin?'Open the shared URL in your own browser, connect, and choose a video. Keep that tab open.':'Open the URL on this computer. If the agent is remote, forward this loopback port or restart with SNIP_PUBLIC_URL set to your secure tunnel origin.'} : await callBrowser(request.params.name, request.params.arguments || {});
    return {content:[{type:'text',text:JSON.stringify(result)}]};
  } catch (error) { return {isError:true,content:[{type:'text',text:error.message}]}; }
});
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
