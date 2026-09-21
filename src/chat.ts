import type { Batch } from './engine';
import type { Edits } from './types';

export type ChatRequest = {
  text: string;
  requestId: string;
  sessionId: string;
  revision: number;
  project: { duration: number; edits: Edits; selectedClip: string; time: number };
};
export type ChatResult = { batch: Batch; summary: string };

export async function requestChatEdit(request: ChatRequest, signal: AbortSignal): Promise<ChatResult> {
  const response = await fetch('/api/edit', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request), signal,
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error || 'Couldn’t reach Jev. Try again in a moment.');
  if (!result?.batch || typeof result.summary !== 'string') throw new Error('Couldn’t read that edit. Please try again.');
  return result;
}
