import type { ClipZoom, Edits } from './types.js';

export const MAX_EDITS = 8;
export type Target = 'all' | 'selected' | 'first' | 'last' | 'middle' | 'previous' | { clip: number } | { original: number } | { split: number | 'latest'; side: 'left' | 'right' };
// Timeline/playhead seconds are global; clipStart/clipEnd seconds are relative to
// the target clip (or whole video), at its current playback speed.
export type Time = { from: 'timeline' | 'playhead' | 'clipStart' | 'clipEnd'; seconds: number } | { from: 'half' };
export type Trim = { mode: 'removeStart' | 'removeEnd' | 'keepStart' | 'keepEnd'; seconds: number } | { mode: 'keepRange' | 'removeRange'; start: number; end: number };
export type Change =
  | { action: 'split'; clip: Target; at: Time; result: string }
  | { action: 'trim'; clip: Target; range: Trim }
  | { action: 'zoom'; clip: Target; scale: number | 'in' | 'out' | 'keep'; focus: Pick<ClipZoom, 'x' | 'y'> | null }
  | { action: 'speed'; clip: Target; rate: number | 'faster' | 'slower' }
  | { action: 'merge'; clips: [Target, Target | 'next'] }
  | { action: 'delete'; clip: Target }
  | { action: 'reorder'; clip: Target; to: 'first' | 'last' | 'reverse' }
  | { action: 'output'; settings: Partial<Pick<Edits, 'muted' | 'format' | 'resolution' | 'quality'>> };
