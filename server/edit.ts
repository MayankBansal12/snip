import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ChatErrorCode } from '../src/chat';
import { compileAnswer, createPlan, EditError, readRequest } from './planner';

const MAX_BODY = 256 * 1024;
let active = 0;
const limits = new Map<string, { count: number; until: number }>();
type Config = { apiKey?: string; model?: string; fetch?: typeof fetch };

export async function handleEdit(req: IncomingMessage & { body?: unknown }, res: ServerResponse, config: Config = {}) {
  const send = (status: number, body: unknown) => {
    if (!res.destroyed) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); }
  };
  const fail = (status: number, code: ChatErrorCode, message: string) => send(status, { ok: false, error: { code, message } });
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); fail(405, 'INVALID_REQUEST', 'Use POST to request an edit.'); return; }
  if (!req.headers['content-type']?.startsWith('application/json') || req.headers['sec-fetch-site'] === 'cross-site') { fail(403, 'INVALID_REQUEST', 'Send edits from the Snip editor.'); return; }
  const apiKey = config.apiKey ?? process.env.TYPESAFE_API_KEY;
  if (!apiKey) { fail(503, 'NOT_CONNECTED', 'Chat isn’t connected yet. Add TYPESAFE_API_KEY on the server to enable Jev.'); return; }
  const now = Date.now(), ip = req.socket.remoteAddress || 'local';
  for (const [key, value] of limits) if (value.until < now) limits.delete(key);
  const limit = limits.get(ip) ?? { count: 0, until: now + 60000 };
  if (active >= 4 || limit.count >= 30) { res.setHeader('Retry-After', '10'); fail(429, 'RATE_LIMITED', 'A few edits are in progress. Try again in a moment.'); return; }
  limit.count++; limits.set(ip, limit); active++;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  const disconnect = () => { if (!res.writableEnded) controller.abort(); };
  res.on('close', disconnect);
  try {
    let body: unknown = req.body;
    if (body === undefined) {
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of req) {
        size += Buffer.byteLength(chunk);
        if (size > MAX_BODY) throw new EditError('This project is too large for chat. Use the timeline instead.', 413);
        chunks.push(Buffer.from(chunk));
      }
      body = Buffer.concat(chunks).toString('utf8');
    }
    if (Buffer.byteLength(typeof body === 'string' ? body : JSON.stringify(body)) > MAX_BODY) throw new EditError('This project is too large for chat.', 413);
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { throw new EditError('Invalid edit request.', 400); } }
    const request = readRequest(body);
    const evaluate = async (state: unknown, questions: unknown) => {
      const response = await (config.fetch ?? fetch)('https://api.typesafe.ai/v1/systemone', {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: config.model ?? process.env.TYPESAFE_MODEL ?? 'jev-1.13.0', state, questions }), signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status === 429 || response.status === 529) throw new EditError('Jev is busy right now. Try again in a moment.', 503, 'SERVICE_UNAVAILABLE');
        if (response.status === 401 || response.status === 403) throw new EditError('The Jev connection needs attention. Check the server’s API key.', 503, 'NOT_CONNECTED');
        throw new EditError('Jev couldn’t process that edit. Please try again.', 502, 'SERVICE_UNAVAILABLE');
      }
      return response.json();
    };
    const plan = createPlan(request);
    const result = compileAnswer(request, plan, await evaluate(plan.state, plan.questions));
    if (!controller.signal.aborted) send(200, result);
  } catch (error) {
    if (controller.signal.aborted) fail(504, 'TIMEOUT', 'Jev took too long. Your video hasn’t changed. Try again.');
    else if (error instanceof EditError) fail(error.status, error.code, error.message);
    else fail(502, 'SERVICE_UNAVAILABLE', 'Couldn’t reach Jev. Your video hasn’t changed. Try again.');
  } finally { clearTimeout(timeout); res.off('close', disconnect); active--; }
}
