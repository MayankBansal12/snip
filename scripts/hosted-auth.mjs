import { randomBytes, randomUUID } from 'node:crypto';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { InvalidClientMetadataError, InvalidGrantError, InvalidScopeError, InvalidTargetError, InvalidTokenError, InvalidRequestError, TooManyRequestsError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { secret } from './hosted-sessions.mjs';

const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** OAuth credentials authorize one explicitly approved browser session, not an account. */
export class HostedAuth {
  constructor(sessions, origin, appOrigin, { now = Date.now, limit = 1000 } = {}) {
    Object.assign(this, { sessions, origin, appOrigin, now, limit });
    this.resource = `${origin}/mcp`;
    this.clients = new Map();
    this.flows = new Map();
    this.codes = new Map();
    this.tokens = new Map();
    this.refreshTokens = new Map();
    this.clientsStore = {
      getClient: id => this.clients.get(id),
      registerClient: async client => {
        this.sweep();
        if (this.clients.size >= this.limit) throw new TooManyRequestsError('Client limit reached. Try later.');
        if (!client.redirect_uris.length || client.redirect_uris.length > 10 || (client.client_name?.length || 0) > 100)
          throw new InvalidClientMetadataError('Provide a short client name and 1–10 redirect URIs.');
        for (const uri of client.redirect_uris) {
          const url = new URL(uri);
          if (url.hash || url.username || url.password || (url.protocol !== 'https:'
            && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))))
            throw new InvalidClientMetadataError('Redirect URIs must use HTTPS or HTTP loopback.');
        }
        const registered = { ...client, client_id: client.client_id || randomUUID(), client_id_issued_at: Math.floor(now() / 1000) };
        this.clients.set(registered.client_id, registered);
        return registered;
      },
    };
    sessions.onDecision = (session, requestId, approved) => {
      const flow = this.flows.get(requestId);
      if (!flow || flow.expiresAt <= now() || flow.sessionId !== session.id || session.flowId !== requestId || flow.status !== 'pending') return;
      session.flowId = undefined;
      if (!approved) { flow.status = 'denied'; sessions.revoke(session); return; }
      session.approved = true;
      flow.status = 'approved';
      flow.code = secret();
      this.codes.set(flow.code, { ...flow, expiresAt: now() + 60_000 });
      sessions.send(session, { type: 'approved' });
    };
    sessions.onRevoke = session => {
      for (const map of [this.codes, this.tokens, this.refreshTokens])
        for (const [key, entry] of map) if (entry.sessionId === session.id) map.delete(key);
      for (const flow of this.flows.values()) if (flow.sessionId === session.id) flow.status = 'denied';
    };
  }

  checkResource(resource) {
    if (resource && resource.href !== this.resource) throw new InvalidTargetError('This grant is only for Snip MCP.');
  }

  async authorize(client, params, res) {
    this.sweep();
    this.checkResource(params.resource);
    if (params.scopes?.some(scope => scope !== 'snip:edit')) throw new InvalidScopeError('Only snip:edit is supported.');
    if (!/^[A-Za-z0-9_-]{43}$/.test(params.codeChallenge)) throw new InvalidRequestError('A SHA-256 PKCE challenge is required.');
    if ((params.state?.length || 0) > 2048 || params.redirectUri.length > 2048) throw new InvalidRequestError('Authorization parameters are too long.');
    if (this.flows.size >= this.limit) throw new TooManyRequestsError('Too many authorization requests.');
    const id = secret();
    this.flows.set(id, { id, clientId: client.client_id, clientName: client.client_name || 'MCP client',
      ...params, status: 'new', attempts: 0, verification: randomBytes(4).toString('hex'), expiresAt: this.now() + 5 * 60_000 });
    res.redirect(303, `${this.origin}/connect?flow=${id}`);
  }

  attachFlow(session, id) {
    const flow = this.getFlow(id);
    if (!flow || flow.status !== 'new' || flow.sessionId || session.flowId || session.approved)
      throw new InvalidRequestError('Connection link expired or already used.');
    flow.sessionId = session.id;
    flow.status = 'pending';
    session.flowId = flow.id;
    this.sessions.send(session, { type: 'pair_request', requestId: flow.id, clientName: flow.clientName, verification: flow.verification });
  }

  validCode(client, code) {
    const grant = this.codes.get(code);
    if (!grant || grant.clientId !== client.client_id || grant.expiresAt <= this.now() || !this.sessions.get(grant.sessionId)?.approved)
      throw new InvalidGrantError('Authorization expired or was already used. Connect again from Snip.');
    return grant;
  }

  async challengeForAuthorizationCode(client, code) { return this.validCode(client, code).codeChallenge; }

  async exchangeAuthorizationCode(client, code, _verifier, redirectUri, resource) {
    const grant = this.validCode(client, code);
    this.checkResource(resource);
    if (redirectUri !== grant.redirectUri) throw new InvalidGrantError('Redirect URI does not match.');
    this.codes.delete(code);
    return this.issueTokens(grant);
  }

  issueTokens(grant) {
    const session = this.sessions.get(grant.sessionId);
    if (!session?.approved) throw new InvalidGrantError('Browser access expired.');
    const access = secret(), refresh = secret();
    const expiresAt = Math.min(this.now() + 60 * 60_000, session.expiresAt);
    const record = { clientId: grant.clientId, sessionId: session.id, expiresAt };
    this.tokens.set(access, record);
    this.refreshTokens.set(refresh, { ...record, expiresAt: session.expiresAt });
    return { access_token: access, token_type: 'Bearer', expires_in: Math.max(1, Math.floor((expiresAt - this.now()) / 1000)),
      refresh_token: refresh, scope: 'snip:edit' };
  }

  async exchangeRefreshToken(client, token, scopes, resource) {
    this.checkResource(resource);
    if (scopes?.some(scope => scope !== 'snip:edit')) throw new InvalidScopeError('Only snip:edit is supported.');
    const grant = this.refreshTokens.get(token);
    if (!grant || grant.clientId !== client.client_id || grant.expiresAt <= this.now()) throw new InvalidGrantError('Refresh token expired or was already used.');
    this.refreshTokens.delete(token);
    return this.issueTokens(grant);
  }

  async verifyAccessToken(token) {
    const grant = this.tokens.get(token);
    if (!grant || grant.expiresAt <= this.now() || !this.sessions.get(grant.sessionId)?.approved)
      throw new InvalidTokenError('Browser access expired. Connect again from Snip.');
    return { token, clientId: grant.clientId, scopes: ['snip:edit'], expiresAt: Math.floor(grant.expiresAt / 1000),
      resource: new URL(this.resource), extra: { browserSessionId: grant.sessionId } };
  }

  async revokeToken(client, { token }) {
    const grant = this.tokens.get(token) || this.refreshTokens.get(token);
    if (grant?.clientId === client.client_id) {
      const session = this.sessions.get(grant.sessionId);
      if (session) this.sessions.revoke(session);
    }
  }

  sweep() {
    for (const [id, flow] of this.flows) if (flow.expiresAt <= this.now()) {
      this.flows.delete(id);
      const session = this.sessions.get(flow.sessionId);
      if (session?.flowId === id) {
        session.flowId = undefined;
        this.sessions.send(session, { type: 'pair_expired', requestId: id });
      }
    }
    for (const map of [this.codes, this.tokens, this.refreshTokens])
      for (const [id, grant] of map) if (grant.expiresAt <= this.now()) map.delete(id);
    for (const [id, client] of this.clients)
      if (client.client_id_issued_at * 1000 + 24 * 60 * 60_000 <= this.now()) this.clients.delete(id);
  }

  connectRouter() {
    const router = express.Router();
    router.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));
    router.use((req, res, next) => {
      res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'strict-origin', 'X-Frame-Options': 'DENY',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'" });
      next();
    });
    router.get('/poll.js', (_req, res) => res.type('js').send(`
      const flow = new URLSearchParams(location.search).get('flow');
      async function poll() {
        try {
          const response = await fetch('/connect/status?flow=' + encodeURIComponent(flow));
          const result = await response.json();
          if (result.redirect) { location.replace(result.redirect); return; }
          if (!response.ok) { document.getElementById('status').textContent = 'Connection expired. Start again from your agent.'; return; }
        } catch { /* A brief connection loss can be retried. */ }
        setTimeout(poll, 1500);
      }
      poll();
    `));
    router.get('/status', (req, res) => {
      const flow = this.getFlow(req.query.flow);
      if (!flow) { res.status(410).json({ error: 'expired' }); return; }
      if (flow.status !== 'approved' && flow.status !== 'denied') { res.json({ pending: true }); return; }
      const redirect = new URL(flow.redirectUri);
      if (flow.status === 'approved') redirect.searchParams.set('code', flow.code);
      else redirect.searchParams.set('error', 'access_denied');
      if (flow.state) redirect.searchParams.set('state', flow.state);
      redirect.searchParams.set('iss', new URL(this.origin).href);
      res.json({ redirect: redirect.href });
    });
    router.get('/', (req, res) => {
      const flow = this.getFlow(req.query.flow);
      if (!flow) { res.status(410).send('Connection expired. Start again from your agent.'); return; }
      res.type('html').send(this.page(flow));
    });
    return router;
  }

  getFlow(id) {
    const flow = typeof id === 'string' ? this.flows.get(id) : undefined;
    return flow && flow.expiresAt > this.now() ? flow : undefined;
  }

  page(flow) {
    const pending = flow.status !== 'new';
    return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Connect your agent · Snip</title><style>body{font:16px/1.6 system-ui,sans-serif;max-width:440px;margin:12vh auto;padding:24px;color:#222;background:#fafafa}h1{font-size:28px}a{box-sizing:border-box;display:block;width:100%;font:inherit;text-align:center;text-decoration:none;padding:12px;margin-top:20px;border-radius:8px;background:#222;color:white}code{font-size:20px}small{color:#555}</style>
      <h1>Connect your agent to Snip</h1><p>Client: <strong>${escape(flow.clientName)}</strong></p>
      ${pending ? `<p id="status">Return to your open Snip tab and approve this connection. Check that both pages show <code>${escape(flow.verification)}</code>.</p><script src="/connect/poll.js" defer></script>`
        : `<p>Open Snip, then approve the request only if it shows <code>${escape(flow.verification)}</code>. This one-time link expires in five minutes.</p>
          <a href="${escape(`${this.appOrigin}/#hosted=${flow.id}`)}" target="_blank" rel="noopener">Open Snip to connect</a>
          <p id="status">Waiting for approval in Snip…</p><script src="/connect/poll.js" defer></script>`}
      <p><small>The agent can read edit settings, request frame screenshots, change the project, and start an export. Full videos stay in your browser. Client names are self-reported; only approve a connection you initiated.</small></p></html>`;
  }
}
