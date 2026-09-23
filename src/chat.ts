import type { Batch } from './engine';
import type { Edits } from './types';

export type ChatRequest = {
  text: string;
  requestId: string;
  sessionId: string;
  revision: number;
  project: { duration: number; edits: Edits; selectedClip: string; time: number };
};
export type ChatErrorCode = 'INVALID_REQUEST' | 'UNSUPPORTED_EDIT' | 'UNSUPPORTED_VALUE' | 'UNCLEAR_REQUEST' | 'TOO_MANY_EDITS' | 'INVALID_EDIT' | 'NO_CHANGE' | 'INVALID_MODEL_RESPONSE' | 'NOT_CONNECTED' | 'RATE_LIMITED' | 'SERVICE_UNAVAILABLE' | 'TIMEOUT';
export type ChatFailure = { ok: false; error: { code: ChatErrorCode; message: string } };
export type ChatResult = { ok: true; batch: Batch; summary: string; changes: import('./edit-plan').Change[] };

export async function requestChatEdit(request: ChatRequest, signal: AbortSignal): Promise<ChatResult> {
  const response = await fetch('/api/edit', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request), signal,
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.ok === false) throw new Error(typeof result?.error?.message === 'string' ? result.error.message : 'Couldn’t reach Jev. Try again in a moment.');
  if (result?.ok !== true || !Array.isArray(result.changes) || !result?.batch || typeof result.summary !== 'string') throw new Error('Couldn’t read that edit. Please try again.');
  return result;
}
