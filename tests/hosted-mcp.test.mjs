import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { WebSocket } from 'ws';
import { createHostedServer } from '../scripts/hosted-server.mjs';

const browserOrigin = 'http://localhost:5173';
async function fixture(t, options = {}) {
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const relay = createHostedServer({ publicOrigin: origin, appOrigins: [browserOrigin, 'http://localhost:5174'], ...options });
  relay.http.listen(port, '127.0.0.1'); await once(relay.http, 'listening');
  t.after(() => relay.close());
  const request = (path, init = {}) => fetch(`${origin}${path}`, init);
  const post = (path, data, asJson = false, extra = {}) => request(path, { method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': asJson ? 'application/json' : 'application/x-www-form-urlencoded', ...extra },
    body: asJson ? JSON.stringify(data) : new URLSearchParams(data) });
  async function browser(marker = 'browser', resumeToken, originHeader = browserOrigin) {
    const socket = new WebSocket(`${origin.replace('http:', 'ws:')}/browser`, { origin: originHeader });
    const queued = [], waiters = [];
    socket.on('message', data => {
      const message = JSON.parse(data);
      if (message.id && marker !== null) {
        socket.send(JSON.stringify({ id: message.id, result: message.method === 'get_frame'
          ? { data: '/9j/', mimeType: 'image/jpeg', width: 1, height: 1 }
          : { marker, method: message.method, params: message.params } }));
      } else {
        const index = waiters.findIndex(w => w.type === message.type);
        if (index >= 0) { const [waiter] = waiters.splice(index, 1); clearTimeout(waiter.timer); waiter.resolve(message); }
        else queued.push(message);
      }
    });
    const next = type => {
      const index = queued.findIndex(m => m.type === type);
      if (index >= 0) return Promise.resolve(queued.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { type, resolve, timer: setTimeout(() => reject(new Error(`Missing ${type}`)), 3000) };
        waiters.push(waiter);
      });
    };
    await once(socket, 'open');
    socket.send(JSON.stringify({ type: 'hello', resumeToken }));
    const ready = await next('hosted_ready');
    t.after(() => socket.terminate());
    return { socket, ready, next };
  }
  async function begin(code) {
    const registered = await post('/register', { client_name: 'Test agent', redirect_uris: ['http://localhost:43210/callback'],
      token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }, true);
    assert.equal(registered.status, 201);
    const client = await registered.json();
    const verifier = randomBytes(32).toString('base64url');
    const query = new URLSearchParams({ client_id: client.client_id, redirect_uri: client.redirect_uris[0], response_type: 'code',
      code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      scope: 'snip:edit', state: 'client-state', resource: `${origin}/mcp` });
    const response = await request(`/authorize?${query}`, { redirect: 'manual' });
    assert.equal(response.status, 303);
    const flow = new URL(response.headers.get('location')).searchParams.get('flow');
    const pair = await post('/connect', { flow, code }, false, { Origin: origin });
    return { client, verifier, flow, pair };
  }
  const exchange = (flow, code, overrides = {}) => post('/token', { client_id: flow.client.client_id,
    grant_type: 'authorization_code', code, code_verifier: flow.verifier, redirect_uri: flow.client.redirect_uris[0], resource: `${origin}/mcp`, ...overrides });
  async function approve(owner) {
    const flow = await begin(owner.ready.code);
    assert.equal(flow.pair.status, 303);
    const pending = await owner.next('pair_request');
    const before = await (await request(`/connect/status?flow=${flow.flow}`)).json();
    assert.deepEqual(before, { pending: true });
    owner.socket.send(JSON.stringify({ type: 'decision', requestId: pending.requestId, approved: true }));
    await owner.next('approved');
    const done = await (await request(`/connect/status?flow=${flow.flow}`)).json();
    const redirect = new URL(done.redirect);
    assert.equal(redirect.searchParams.get('state'), 'client-state');
    assert.equal(redirect.searchParams.get('iss'), origin + '/');
    return { ...flow, code: redirect.searchParams.get('code') };
  }
  async function token(owner) {
    const flow = await approve(owner);
    const response = await exchange(flow, flow.code);
    assert.equal(response.status, 200);
    return { ...await response.json(), flow };
  }
  async function mcp(token) {
    const client = new Client({ name: 'Hosted integration test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    t.after(() => client.close());
    return client;
  }
  return { relay, origin, request, post, browser, begin, approve, exchange, token, mcp };
}

test('hosted MCP requires authorization and exact configured origins; discovery is public', async t => {
  const f = await fixture(t);
  const response = await f.post('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, true);
  assert.equal(response.status, 401);
  assert.match(response.headers.get('www-authenticate'), /oauth-protected-resource\/mcp/);
  const discovery = await (await f.request('/.well-known/oauth-protected-resource/mcp')).json();
  assert.equal(discovery.resource, `${f.origin}/mcp`);
  assert.equal((await f.request('/.well-known/oauth-authorization-server')).status, 200);
  assert.equal((await f.request('/mcp', { headers: { Origin: 'https://evil.example' } })).status, 403);
  const wrongHost = await new Promise((resolve, reject) => {
    const request = httpRequest(`${f.origin}/mcp`, { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject); request.end();
  });
  assert.equal(wrongHost, 403);
  const socket = new WebSocket(`${f.origin.replace('http:', 'ws:')}/browser`, { origin: 'https://evil.example' });
  await assert.rejects(once(socket, 'open'), /403/);
  assert.equal((await f.post('/connect', { flow: 'bogus', code: 'bogus' }, false, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await f.post('/register', { redirect_uris: ['https://user:pass@evil.example/callback'] }, true)).status, 400);
});

test('two approved OAuth clients route tools only to their own browser, including frame images', async t => {
  const f = await fixture(t);
  const alice = await f.browser('alice'), bob = await f.browser('bob');
  const aliceToken = await f.token(alice), bobToken = await f.token(bob);
  const a = await f.mcp(aliceToken.access_token), b = await f.mcp(bobToken.access_token);
  assert.equal((await a.listTools()).tools.length, 6);
  const call = async (client, name, args = {}) => client.callTool({ name, arguments: args });
  assert.equal(JSON.parse((await call(a, 'get_project')).content[0].text).marker, 'alice');
  assert.equal(JSON.parse((await call(b, 'get_project')).content[0].text).marker, 'bob');
  const batch = { sessionId: 'project-a', revision: 7, requestId: 'edit-a', commands: [{ action: 'setSpeed', clipId: 'clip', speed: 2 }] };
  assert.deepEqual(JSON.parse((await call(a, 'apply_edits', batch)).content[0].text).params, batch);
  const frame = await call(a, 'get_frame', { sessionId: 'project-a', revision: 7, sourceTime: 1 });
  assert.equal(frame.content[1].type, 'image');
  assert.equal(frame.content[1].mimeType, 'image/jpeg');
  assert.equal(JSON.parse((await call(a, 'get_connection')).content[0].text).bridgeId, alice.ready.bridgeId);
  const repeat = await f.begin(alice.ready.code);
  assert.equal(repeat.pair.status, 400);
  alice.socket.send(JSON.stringify({ type: 'revoke' }));
  await alice.next('revoked');
  assert.equal((await f.request('/mcp', { headers: { Authorization: `Bearer ${aliceToken.access_token}` } })).status, 401);
  assert.equal(JSON.parse((await call(b, 'get_project')).content[0].text).marker, 'bob');
});

test('authorization codes bind client, redirect, PKCE and resource; tokens rotate and revoke', async t => {
  const f = await fixture(t), owner = await f.browser();
  const flow = await f.approve(owner);
  assert.equal((await f.exchange(flow, flow.code, { code_verifier: 'bad-verifier' })).status, 400);
  assert.equal((await f.exchange(flow, flow.code, { redirect_uri: 'http://localhost:43210/wrong' })).status, 400);
  assert.equal((await f.exchange(flow, flow.code, { resource: 'https://other.example/mcp' })).status, 400);
  const outsider = await f.begin('incorrect-code');
  assert.equal((await f.exchange(flow, flow.code, { client_id: outsider.client.client_id })).status, 400);
  const tokens = await (await f.exchange(flow, flow.code)).json();
  assert.equal(typeof tokens.access_token, 'string');
  assert.equal((await f.exchange(flow, flow.code)).status, 400);
  const refresh = data => f.post('/token', { client_id: flow.client.client_id, grant_type: 'refresh_token', refresh_token: tokens.refresh_token, resource: `${f.origin}/mcp`, ...data });
  assert.equal((await refresh({ resource: 'https://other.example/mcp' })).status, 400);
  assert.equal((await refresh({ client_id: outsider.client.client_id })).status, 400);
  const rotated = await (await refresh({})).json();
  assert.equal(typeof rotated.access_token, 'string');
  assert.equal((await refresh({})).status, 400);
  assert.equal((await f.post('/revoke', { client_id: flow.client.client_id, token: rotated.refresh_token })).status, 200);
  assert.equal((await f.request('/mcp', { headers: { Authorization: `Bearer ${tokens.access_token}` } })).status, 401);
  assert.equal((await f.request('/mcp', { headers: { Authorization: `Bearer ${rotated.access_token}` } })).status, 401);
});

test('knowing a pairing code cannot bypass approval or approve another browser', async t => {
  const f = await fixture(t), owner = await f.browser(), outsider = await f.browser();
  const flow = await f.begin(owner.ready.code), pending = await owner.next('pair_request');
  outsider.socket.send(JSON.stringify({ type: 'decision', requestId: pending.requestId, approved: true }));
  assert.deepEqual(await (await f.request(`/connect/status?flow=${flow.flow}`)).json(), { pending: true });
  const second = await f.begin(owner.ready.code);
  assert.equal(second.pair.status, 400);
  owner.socket.send(JSON.stringify({ type: 'decision', requestId: pending.requestId, approved: false }));
  // A ping confirms the preceding decision was processed on the same socket.
  owner.socket.send(JSON.stringify({ type: 'ping' })); await owner.next('pong');
  const denied = await (await f.request(`/connect/status?flow=${flow.flow}`)).json();
  assert.equal(new URL(denied.redirect).searchParams.get('error'), 'access_denied');
  assert.equal(f.relay.sessions.get(owner.ready.bridgeId).approved, false);
});

test('expired pairing, grant and disconnected sessions cannot be used', async t => {
  let now = Date.now();
  const f = await fixture(t, { sessionOptions: { now: () => now, pairingMs: 100, lifetimeMs: 1000, reconnectMs: 50 }, authOptions: { now: () => now } });
  const expired = await f.browser();
  now += 101;
  assert.equal((await f.begin(expired.ready.code)).pair.status, 400);
  const owner = await f.browser(), tokens = await f.token(owner);
  now += 1001;
  assert.equal((await f.request('/mcp', { headers: { Authorization: `Bearer ${tokens.access_token}` } })).status, 401);
  const disconnected = await f.browser(), credential = await f.token(disconnected);
  disconnected.socket.close(); await once(disconnected.socket, 'close');
  now += 51;
  assert.equal((await f.request('/mcp', { headers: { Authorization: `Bearer ${credential.access_token}` } })).status, 401);
});

test('same browser resumes briefly; disconnected commands fail instead of being queued', async t => {
  const f = await fixture(t), owner = await f.browser('original'), tokens = await f.token(owner);
  const client = await f.mcp(tokens.access_token);
  owner.socket.close(); await once(owner.socket, 'close');
  const offline = await client.callTool({ name: 'get_project', arguments: {} });
  assert.equal(offline.isError, true); assert.match(offline.content[0].text, /disconnected/);
  const wrongOrigin = new WebSocket(`${f.origin.replace('http:', 'ws:')}/browser`, { origin: 'http://localhost:5174' });
  await once(wrongOrigin, 'open');
  wrongOrigin.send(JSON.stringify({ type: 'hello', resumeToken: owner.ready.resumeToken }));
  assert.equal((await once(wrongOrigin, 'close'))[0], 1008);
  const resumed = await f.browser('resumed', owner.ready.resumeToken);
  assert.equal(resumed.ready.bridgeId, owner.ready.bridgeId); assert.equal(resumed.ready.approved, true);
  const result = await client.callTool({ name: 'get_project', arguments: {} });
  assert.equal(JSON.parse(result.content[0].text).marker, 'resumed');
});

test('a browser cannot answer another tab’s pending call; timeouts and disconnects release requests', async t => {
  const f = await fixture(t, { sessionOptions: { requestMs: 100 } });
  const owner = await f.browser(null), other = await f.browser();
  const tokens = await f.token(owner), client = await f.mcp(tokens.access_token);
  const request = client.callTool({ name: 'get_project', arguments: {} });
  const pending = await owner.next(undefined);
  other.socket.send(JSON.stringify({ id: pending.id, result: { marker: 'wrong browser' } }));
  other.socket.send(JSON.stringify({ type: 'ping' })); await other.next('pong');
  owner.socket.send(JSON.stringify({ id: pending.id, result: { marker: 'right browser' } }));
  assert.equal(JSON.parse((await request).content[0].text).marker, 'right browser');
  const timedOut = await client.callTool({ name: 'get_project', arguments: {} });
  assert.equal(timedOut.isError, true); assert.match(timedOut.content[0].text, /timed out/);
  assert.equal(f.relay.sessions.get(owner.ready.bridgeId).pending.size, 0);
  await owner.next(undefined);
  const interrupted = client.callTool({ name: 'get_project', arguments: {} });
  await owner.next(undefined);
  owner.socket.close(); await once(owner.socket, 'close');
  assert.equal((await interrupted).isError, true);
  assert.equal(f.relay.sessions.get(owner.ready.bridgeId).pending.size, 0);
});
