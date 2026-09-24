#!/usr/bin/env node
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { WebSocketServer } from 'ws';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { parsePublicOrigin } from './bridge-origin.mjs';
import { createSnipServer } from './mcp-tools.mjs';
import { BrowserSessions, MAX_PAYLOAD } from './hosted-sessions.mjs';
import { HostedAuth } from './hosted-auth.mjs';

export function createHostedServer({ publicOrigin, appOrigins, clientOrigins = [], trustProxy = 0, sessionOptions = {}, authOptions = {} }) {
  publicOrigin = parsePublicOrigin(publicOrigin);
  if (!publicOrigin || !appOrigins?.length) throw new Error('Set SNIP_RELAY_ORIGIN and SNIP_APP_ORIGINS to explicit HTTPS origins.');
  const browserOrigins = new Set(appOrigins.map(parsePublicOrigin));
  const allowedOrigins = new Set([publicOrigin, ...browserOrigins, ...clientOrigins.map(parsePublicOrigin)]);
  if (allowedOrigins.has(null)) throw new Error('Allowed origins must not be empty.');
  if (!Number.isInteger(trustProxy) || trustProxy < 0 || trustProxy > 5) throw new Error('SNIP_TRUST_PROXY must be a trusted proxy hop count (0–5).');
  const sessions = new BrowserSessions(sessionOptions);
  const auth = new HostedAuth(sessions, publicOrigin, authOptions);
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy);
  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  app.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    if (req.headers.host !== new URL(publicOrigin).host || (req.headers.origin && !allowedOrigins.has(req.headers.origin))) {
      res.sendStatus(403); return;
    }
    if (req.headers.origin) {
      res.set({ 'Access-Control-Allow-Origin': req.headers.origin, 'Vary': 'Origin',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, MCP-Protocol-Version, Mcp-Session-Id',
        'Access-Control-Expose-Headers': 'WWW-Authenticate, MCP-Protocol-Version',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS' });
    }
    if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
    next();
  });
  app.use('/connect', auth.connectRouter());
  app.use(mcpAuthRouter({ provider: auth, issuerUrl: new URL(publicOrigin), resourceServerUrl: new URL(auth.resource),
    scopesSupported: ['snip:edit'], resourceName: 'Snip browser editor' }));
  app.use('/mcp', rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: true, legacyHeaders: false }),
    requireBearerAuth({ verifier: auth, requiredScopes: ['snip:edit'], resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(new URL(auth.resource)) }));
  app.post('/mcp', express.json({ limit: MAX_PAYLOAD }), async (req, res) => {
    const id = req.auth.extra.browserSessionId;
    const server = createSnipServer((method, params, signal) => sessions.call(id, method, params, signal), () => {
      const session = sessions.get(id);
      return { mode: 'hosted', bridgeId: id, connected: Boolean(session?.socket), browserRequiredOnAgentHost: false,
        expiresAt: session?.expiresAt, instructions: 'Use the approved Snip tab. Keep it open; video and export stay in that browser.' };
    }, true);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { void server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      await server.close();
      if (!res.headersSent) res.status(500).json({ error: 'MCP request failed.' });
    }
  });
  app.all('/mcp', (_req, res) => res.status(405).set('Allow', 'POST').json({ error: 'Use MCP Streamable HTTP POST requests.' }));
  app.use((_req, res) => res.sendStatus(404));
  app.use((error, _req, res, _next) => {
    // Never log payloads, pairing codes, authorization headers, or frame data.
    if (!res.headersSent) res.status(error.status === 413 ? 413 : 400).json({ error: 'Invalid request.' });
  });
  const http = createServer(app);
  const ws = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD, perMessageDeflate: false });
  const upgrades = new Map();
  http.on('upgrade', (req, socket, head) => {
    const key = socket.remoteAddress;
    const now = Date.now(), bucket = upgrades.get(key);
    const count = bucket && bucket.until > now ? bucket.count + 1 : 1;
    if (upgrades.size < 10_000 || upgrades.has(key)) upgrades.set(key, { count, until: bucket?.until > now ? bucket.until : now + 60_000 });
    if (req.url !== '/browser' || req.headers.host !== new URL(publicOrigin).host || !browserOrigins.has(req.headers.origin)
      || ws.clients.size >= sessions.limit * 2 || count > 120 || upgrades.size >= 10_000) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    ws.handleUpgrade(req, socket, head, client => {
      client.on('error', () => {});
      const timeout = setTimeout(() => client.close(1008, 'Handshake timed out'), 5000);
      client.once('close', () => clearTimeout(timeout));
      client.once('message', data => {
        clearTimeout(timeout);
        try {
          if (data.length > 1024) throw new Error('Invalid handshake.');
          const hello = JSON.parse(data.toString());
          if (hello?.type !== 'hello' || (hello.resumeToken !== undefined && (typeof hello.resumeToken !== 'string' || hello.resumeToken.length !== 43)))
            throw new Error('Invalid handshake.');
          sessions.attach(client, req.headers.origin, hello.resumeToken);
        } catch {
          client.close(1008, 'Session unavailable. Copy a new prompt in Snip.');
        }
      });
    });
  });
  const timer = setInterval(() => {
    sessions.sweep(); auth.sweep();
    for (const [key, bucket] of upgrades) if (bucket.until <= Date.now()) upgrades.delete(key);
  }, 5000);
  timer.unref();
  return { http, sessions, auth, async close() {
    clearInterval(timer); sessions.close();
    for (const client of ws.clients) client.terminate();
    ws.close();
    http.closeAllConnections();
    await new Promise(resolve => http.close(resolve));
  } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const relay = createHostedServer({ publicOrigin: process.env.SNIP_RELAY_ORIGIN || process.env.RENDER_EXTERNAL_URL,
    appOrigins: process.env.SNIP_APP_ORIGINS?.split(',').map(s => s.trim()),
    clientOrigins: process.env.SNIP_CLIENT_ORIGINS?.split(',').map(s => s.trim()) || [],
    trustProxy: Number(process.env.SNIP_TRUST_PROXY || 0) });
  relay.http.listen(Number(process.env.PORT || 5189), '0.0.0.0', () => console.log('Snip hosted MCP relay is ready.'));
  const stop = () => { void relay.close().then(() => process.exit(0)); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
