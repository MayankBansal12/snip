import type { Clip } from './types.js';

/** Presentation timestamps, sorted in display order; the last boundary is exclusive. */
export type FrameIndex = { times: Float64Array; end: number };
export const FRAME_EPSILON = 1e-7;
export function lowerFrame(times: ArrayLike<number>, time: number): number {
  let lo = 0, hi = times.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (times[mid] < time - FRAME_EPSILON) lo = mid + 1; else hi = mid; }
  return lo;
}
export function boundary(index: FrameIndex, frame: number): number {
  return frame >= index.times.length ? index.end : index.times[Math.max(0, frame)];
}
export function nearestBoundary(index: FrameIndex, time: number, min = 0, max = index.end): number {
  if(!Number.isFinite(time))throw new Error('Frame time must be finite.');
  const first = lowerFrame(index.times, min), after = lowerFrame(index.times, max);
  const last = boundary(index, after) <= max + FRAME_EPSILON ? after : after - 1;
  if (first > last) throw new Error('There is no source-frame boundary in this range.');
  const upper = Math.max(first, Math.min(last, lowerFrame(index.times, time)));
  const lower = Math.max(first, upper - 1);
  // Ties choose the earlier boundary consistently.
  return Math.abs(time - boundary(index, lower)) <= Math.abs(boundary(index, upper) - time) + FRAME_EPSILON
    ? boundary(index, lower) : boundary(index, upper);
}
export function retainedFrames(index: FrameIndex, clip: Pick<Clip, 'start' | 'end'>) {
  return { first: lowerFrame(index.times, clip.start), after: lowerFrame(index.times, clip.end) };
}
export function frameAt(index: FrameIndex, time: number, clip: Pick<Clip, 'start' | 'end'>): number {
  const { first, after } = retainedFrames(index, clip);
  if (after <= first) throw new Error('This clip contains no source frames. Extend its boundaries.');
  const next = lowerFrame(index.times, time);
  const current = next < index.times.length && Math.abs(index.times[next] - time) <= FRAME_EPSILON ? next : next - 1;
  return Math.max(first, Math.min(after - 1, current));
}
export function previewTimestamp(index: FrameIndex, frame: number): number {
  // Seek just inside the selected frame, avoiding decoder boundary rounding.
  const start = boundary(index, frame), end = boundary(index, frame + 1);
  return start + Math.min(.001, (end - start) / 4);
}
export function trimBoundary(index: FrameIndex, clip: Clip, edge: 'start' | 'end', time: number, limits: { start: number; end: number }): number {
  const frames = retainedFrames(index, clip);
  const min = edge === 'start' ? limits.start : boundary(index, frames.first + 1);
  const max = edge === 'end' ? limits.end : boundary(index, frames.after - 1);
  return nearestBoundary(index, time, min, max);
}
export function stepBoundary(index: FrameIndex, time: number, direction: number): number {
  const next = lowerFrame(index.times, time);
  const aligned = Math.abs(boundary(index, next) - time) <= FRAME_EPSILON;
  return boundary(index, Math.max(0, Math.min(index.times.length, direction > 0 ? next + (aligned ? 1 : 0) : next - 1)));
}
export function preciseTime(seconds: number): string {
  const ms=Math.round(seconds*1000);
  return `${Math.floor(ms/60000)}:${((ms%60000)/1000).toFixed(3).padStart(6,'0')}`;
}
