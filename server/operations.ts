import type { ChatErrorCode } from '../src/chat.js';
export { MAX_EDITS } from '../src/edit-plan.js';
export type { Change, Target, Time, Trim } from '../src/edit-plan.js';

export class EditError extends Error {
  constructor(message: string, readonly status = 422, readonly code: ChatErrorCode = status === 400 || status === 413 ? 'INVALID_REQUEST' : 'INVALID_EDIT') { super(message); }
}
