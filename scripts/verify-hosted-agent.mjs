import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer as createViteServer } from 'vite';
import { chromium } from 'playwright-core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { createHostedServer } from './hosted-server.mjs';

const sample = process.env.VIDEO_SAMPLE;
if (!sample) throw new Error('Set VIDEO_SAMPLE to an eight-second video with audio.');
const output = process.env.VERIFY_OUTPUT || '/tmp/snip-hosted-verification'; mkdirSync(output, { recursive: true });
const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const relayOrigin = `http://127.0.0.1:${port}`;
const vite = await createViteServer({ define: { 'import.meta.env.VITE_SNIP_MCP_ORIGIN': JSON.stringify(relayOrigin) },
  server: { host: '127.0.0.1', port: 0 } });
await vite.listen();
const appOrigin = `http://127.0.0.1:${vite.httpServer.address().port}`;
const relay = createHostedServer({ publicOrigin: relayOrigin, appOrigins: [appOrigin] });
relay.http.listen(port, '127.0.0.1'); await once(relay.http, 'listening');
const browser = process.env.CDP_URL ? await chromium.connectOverCDP(process.env.CDP_URL)
  : await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: appOrigin });
const page = await context.newPage(), authorization = await context.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
authorization.on('pageerror', error => errors.push(error.message));
page.setDefaultTimeout(20_000); authorization.setDefaultTimeout(20_000);
const button = name => page.getByRole('button', { name, exact: true });
const redirectUrl = `${appOrigin}/oauth-callback`;
await authorization.route(`${redirectUrl}?*`, route => route.fulfill({ contentType: 'text/plain', body: 'Agent connected. You can close this tab.' }));
let clientInformation, tokens, verifier;
const authProvider = {
  redirectUrl,
  clientMetadata: { client_name: 'Snip browser verification', redirect_uris: [redirectUrl], token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] },
  clientInformation: () => clientInformation, saveClientInformation: value => { clientInformation = value; },
  tokens: () => tokens, saveTokens: value => { tokens = value; },
  codeVerifier: () => verifier, saveCodeVerifier: value => { verifier = value; },
  state: () => 'browser-verification-state',
  redirectToAuthorization: async url => { await authorization.goto(url.href); },
};
const client = new Client({ name: 'Snip browser verification', version: '1.0.0' });
const transport = new StreamableHTTPClientTransport(new URL(`${relayOrigin}/mcp`), { authProvider });
const call = async (name, args = {}) => {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(result.content[0].text);
  return JSON.parse(result.content[0].text);
};
try {
  await page.goto(appOrigin);
  await button('use snip with your agent').click();
  assert.equal(await button('use local setup instead').count(), 0);
  assert.equal(await page.getByText(/your agent is connected/i).count(), 0);
  assert.equal(await button('view more').count(), 0);
  assert.equal(await button('view less').count(), 0);
  const displayedPrompt = await page.getByLabel('full agent prompt').inputValue();
  assert.equal(await page.getByLabel('full agent prompt').evaluate(element => getComputedStyle(element).textTransform), 'lowercase');
  assert.equal(await page.getByLabel('full agent prompt').evaluate(element => getComputedStyle(element).overflowY), 'auto');
  assert.match(displayedPrompt, /send it to me/);
  await button('copy prompt').click();
  await button('copied').waitFor();
  const prompt = await page.evaluate(() => navigator.clipboard.readText());
  assert.equal(prompt, displayedPrompt);
  assert.ok(prompt.includes(`${relayOrigin}/mcp`)); assert.match(prompt, /Snip authorization link, send it to me/);
  assert.match(prompt, /no video is open, ask me to select one in Snip/); assert.match(prompt, /preview them before you export/);
  assert.match(prompt, /Only if I confirm, clone/); assert.ok(prompt.length < 900);
  assert.equal(prompt.includes('access_token'), false);
  assert.equal(relay.sessions.sessions.size, 0); assert.equal(relay.auth.flows.size, 0);
  await page.keyboard.press('Escape');
  await assert.rejects(client.connect(transport), UnauthorizedError);
  const connectLink = await authorization.getByRole('link', { name: 'Open Snip to connect' }).getAttribute('href');
  assert.match(connectLink, new RegExp(`^${appOrigin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/#hosted=`));
  await page.goto(connectLink);
  await page.bringToFront();
  await page.getByRole('alertdialog').waitFor();
  const verification = await authorization.locator('code').innerText();
  assert.match(await page.getByRole('alertdialog').innerText(), new RegExp(verification));
  await page.screenshot({ path: `${output}/pairing.png`, fullPage: true });
  await button('connect agent').click();
  await page.getByRole('alertdialog').waitFor({ state: 'hidden' });
  await authorization.waitForURL(`${redirectUrl}?*`);
  const callback = new URL(authorization.url());
  assert.equal(callback.searchParams.get('state'), 'browser-verification-state');
  assert.equal(callback.searchParams.get('iss'), relayOrigin + '/');
  await transport.finishAuth(callback.searchParams.get('code'));
  await client.close();
  await client.connect(new StreamableHTTPClientTransport(new URL(`${relayOrigin}/mcp`), { authProvider }));
  console.log('PASS static prompt, one-time connection link, explicit approval and OAuth token exchange');
  const connection = await call('get_connection');
  assert.equal(connection.mode, 'hosted'); assert.equal(connection.connected, true);
  await assert.rejects(call('get_project'), /Open a video/);
  await page.locator('#video-file').setInputFiles(sample);
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  assert.equal((await call('get_connection')).connected, true);
  console.log('PASS connection works before video selection; opening the first video preserves it');
  const before = await call('get_project'), clipId = before.specification.edits.clips[0].id;
  const batch = { sessionId: before.sessionId, revision: before.revision, requestId: 'hosted-edit', commands: [
    { action: 'splitClip', clipId, sourceTime: 4, rightClipId: 'hosted-right' },
    { action: 'setSpeed', clipId: 'hosted-right', speed: 2 },
  ] };
  await call('apply_edits', batch);
  assert.equal((await call('apply_edits', batch)).duplicate, true);
  assert.equal(await page.locator('.timeline-clip').count(), 2);
  assert.equal((await call('get_project')).duration, 6);
  await assert.rejects(call('apply_edits', { ...batch, requestId: 'stale' }), /revision/);
  await button('undo').click();
  assert.equal(await page.locator('.timeline-clip').count(), 1);
  await button('redo').click();
  const current = await call('get_project');
  const frame = await client.callTool({ name: 'get_frame', arguments: { sessionId: current.sessionId, revision: current.revision, sourceTime: 2 } });
  assert.equal(frame.content[1].type, 'image');
  console.log('PASS hosted edits, idempotent retry, stale revision rejection, undo/redo and frame capture');
  const download = page.waitForEvent('download', { timeout: 180_000 });
  const exportRequest = { sessionId: current.sessionId, revision: current.revision, requestId: 'hosted-export' };
  await call('start_export', exportRequest);
  await call('start_export', exportRequest);
  const file = await download;
  assert(file.suggestedFilename().endsWith('.mp4'));
  // CDP/Snap browsers may write downloads in a different filesystem namespace.
  const bytes = await page.evaluate(async () => {
    const link = document.querySelector('a[download]');
    return Array.from(new Uint8Array(await (await fetch(link.href)).arrayBuffer()));
  });
  const path = `${output}/export.mp4`; writeFileSync(path, Buffer.from(bytes));
  assert.equal((await call('get_export_status')).status, 'complete');
  const probe = JSON.parse(execFileSync(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', path], { encoding: 'utf8' }));
  assert(Math.abs(Number(probe.format.duration) - 6) < .1);
  assert(probe.streams.some(stream => stream.codec_type === 'audio'));
  await button('back to editing').click();
  console.log('PASS real browser export has six seconds of video and audio');
  const live = relay.sessions.get(connection.bridgeId);
  live.socket.terminate();
  await page.getByText('reconnecting agent…', { exact: true }).waitFor();
  await page.getByText('reconnecting agent…', { exact: true }).waitFor({ state: 'hidden' });
  assert.equal((await call('get_project')).sessionId, current.sessionId);
  assert.equal((await call('get_connection')).bridgeId, connection.bridgeId);
  console.log('PASS browser reconnect preserves the approved tab and project');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: `${output}/mobile.png`, fullPage: true });
  // Replacing a source must not give an existing agent access to the new project.
  await page.locator('#video-file').setInputFiles(sample);
  await button('disconnect agent').waitFor({ state: 'hidden' });
  assert.equal((await fetch(`${relayOrigin}/mcp`, { headers: { Authorization: `Bearer ${tokens.access_token}` } })).status, 401);
  assert.deepEqual(errors, []);
  console.log('PASS project replacement revokes access; mobile layout and browser console are clean');
} catch (error) {
  console.error('Browser errors:', errors);
  console.error('Connection states:', [...relay.sessions.sessions.values()].map(s => ({ approved: s.approved, connected: !!s.socket })), [...relay.auth.flows.values()].map(f => f.status));
  await page.bringToFront();
  await page.screenshot({ path: `${output}/failure-editor.png`, fullPage: true, timeout: 5000 }).catch(() => {});
  await authorization.bringToFront();
  await authorization.screenshot({ path: `${output}/failure-authorization.png`, fullPage: true, timeout: 5000 }).catch(() => {});
  throw error;
} finally {
  await client.close(); await context.close(); await browser.close(); await relay.close(); await vite.close();
}
