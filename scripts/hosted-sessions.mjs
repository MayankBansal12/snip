import { randomBytes, randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';

export const secret = () => randomBytes(32).toString('base64url');
export const MAX_PAYLOAD = 8 * 1024 * 1024;

/** Application sessions, independent of MCP transport identifiers. No video storage. */
export class BrowserSessions {
  constructor({ now = Date.now, limit = 200, lifetimeMs = 4 * 60 * 60_000, reconnectMs = 60_000, requestMs = 60_000 } = {}) {
    Object.assign(this, { now, limit, lifetimeMs, reconnectMs, requestMs });
    this.sessions = new Map();
    this.onRevoke = () => {};
    this.onDecision = () => {};
  }

  attach(socket, origin, resumeToken) {
    this.sweep();
    let session;
    if (resumeToken) {
      session = [...this.sessions.values()].find(s => s.resumeToken === resumeToken && s.origin === origin);
      if (!session || session.socket) throw new Error('Session expired. Copy a new prompt in Snip.');
    } else {
      if (this.sessions.size >= this.limit) throw new Error('The relay is busy. Try again shortly.');
      session = { id: randomUUID(), resumeToken: secret(), origin, expiresAt: this.now() + this.lifetimeMs,
        approved: false, pending: new Map(), lastSeen: this.now() };
      this.sessions.set(session.id, session);
    }
    session.socket = socket;
    session.disconnectedAt = undefined;
    session.lastSeen = this.now();
    socket.on('pong', () => { if (session.socket === socket) session.lastSeen = this.now(); });
    socket.send(JSON.stringify({ type: 'hosted_ready', bridgeId: session.id, resumeToken: session.resumeToken,
      expiresAt: session.expiresAt, approved: session.approved }));
    socket.on('message', data => {
      if (session.socket !== socket || !this.sessions.has(session.id)) return;
      let message;
      try { message = JSON.parse(data.toString()); } catch { socket.close(1007); return; }
      if (!message || typeof message !== 'object') return;
      session.lastSeen = this.now();
      if (message.type === 'ping') { socket.send(JSON.stringify({ type: 'pong' })); return; }
      if (message.type === 'revoke') { this.revoke(session); return; }
      if (message.type === 'decision') {
        this.onDecision(session, message.requestId, message.approved === true);
        return;
      }
      const pending = session.pending.get(message.id);
      if (pending) pending.finish(typeof message.error === 'string' ? new Error(message.error) : null, message.result);
    });
    socket.on('close', () => {
      if (session.socket !== socket) return;
      session.socket = undefined;
      session.disconnectedAt = this.now();
      this.rejectPending(session, 'Editor disconnected. Read the project after reconnecting; never blindly repeat edits.');
    });
    return session;
  }

  get(id) {
    const session = this.sessions.get(id);
    if (!session || session.expiresAt <= this.now()
      || (session.disconnectedAt !== undefined && this.now() - session.disconnectedAt >= this.reconnectMs)) {
      if (session) this.revoke(session);
      return undefined;
    }
    return session;
  }

  send(session, message) {
    if (session.socket?.readyState === WebSocket.OPEN) session.socket.send(JSON.stringify(message));
  }

  call(id, method, params, signal) {
    const session = this.get(id);
    if (!session?.approved) throw new Error('Browser authorization expired. Reconnect from Snip.');
    if (session.socket?.readyState !== WebSocket.OPEN) throw new Error('Editor disconnected. Keep the Snip tab open and wait for it to reconnect.');
    if (session.pending.size >= 16) throw new Error('Too many pending editor requests.');
    const requestId = randomUUID(), payload = JSON.stringify({ id: requestId, method, params });
    if (Buffer.byteLength(payload) > MAX_PAYLOAD) throw new Error('Request exceeds 8 MiB.');
    if (signal?.aborted) throw new Error('Request cancelled. Read the project before continuing.');
    return new Promise((resolve, reject) => {
      const finish = (error, result) => {
        if (!session.pending.delete(requestId)) return;
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
        if (error) reject(error); else resolve(result);
      };
      const abort = () => finish(new Error('Request cancelled. An edit may have completed; read the project.'));
      const timeout = setTimeout(() => finish(new Error('Editor timed out. An edit may have completed; retry the SAME requestId or read the project.')), this.requestMs);
      session.pending.set(requestId, { finish });
      signal?.addEventListener('abort', abort, { once: true });
      session.socket.send(payload, error => { if (error) finish(error); });
    });
  }

  rejectPending(session, message) {
    for (const request of session.pending.values()) request.finish(new Error(message));
  }

  revoke(session, closeCode = 1000, reason = 'Session ended') {
    if (!this.sessions.delete(session.id)) return;
    this.rejectPending(session, 'Browser access revoked.');
    this.onRevoke(session);
    this.send(session, { type: 'revoked' });
    session.socket?.close(closeCode, reason);
  }

  sweep() {
    for (const session of this.sessions.values()) {
      if (!this.get(session.id)) continue;
      if (session.socket && this.now() - session.lastSeen > 25_000) this.revoke(session);
      else if (session.socket?.readyState === WebSocket.OPEN) {
        session.socket.ping();
        this.send(session, { type: 'pong' });
      }
    }
  }

  close() { for (const session of this.sessions.values()) this.revoke(session); }
}
