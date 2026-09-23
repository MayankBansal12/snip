export { MAX_EDITS } from '../src/edit-plan';
export type { Change, Target, Time, Trim } from '../src/edit-plan';

export class EditError extends Error {
  constructor(message: string, readonly status = 422) { super(message); }
}
