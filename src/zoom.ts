import { clamp, clipCrop, clipDuration, clipSpeed, cropPixels } from './types';
import type { Edits, Source } from './types';

type Viewport = ReturnType<typeof cropPixels>;
export const ZOOM_TRANSITION_SECONDS = .28;

export function zoomTransition(source: Source, edits: Edits, index: number) {
  const to = cropPixels(source, clipCrop(edits, edits.clips[index]));
  if (index === 0) return { from: to, to, duration: 0 };
  const from = cropPixels(source, clipCrop(edits, edits.clips[index - 1]));
  const changed = from.x !== to.x || from.y !== to.y || from.width !== to.width || from.height !== to.height;
  // Finish early even on a short clip, leaving its chosen framing visible.
  return { from, to, duration: changed ? Math.min(ZOOM_TRANSITION_SECONDS, clipDuration(edits.clips[index], edits) / 2) : 0 };
}

export function zoomViewport(source: Source, edits: Edits, index: number, elapsed: number, editing = false): Viewport {
  const { from, to, duration } = zoomTransition(source, edits, index);
  if (editing || !duration || elapsed >= duration) return to;
  const progress = clamp(elapsed / duration, 0, 1);
  const eased = (1 - Math.cos(Math.PI * progress)) / 2;
  const mix = (a: number, b: number) => a + (b - a) * eased;
  return { x: mix(from.x, to.x), y: mix(from.y, to.y), width: mix(from.width, to.width), height: mix(from.height, to.height) };
}

/** Match the preview's viewport without resizing the output canvas or overlapping clips. */
export function zoomTransitionFilter(source: Source, edits: Edits, index: number, frameRate: number) {
  const { from, to, duration } = zoomTransition(source, edits, index);
  if (!duration) return null;
  const frames = frameRate * clipSpeed(edits.clips[index], edits) * duration;
  // FFmpeg 5.1 perspective numbers its first output frame as 1.
  const ease = `(1-cos(PI*min(1,max(0,(on-1)/${frames}))))/2`;
  const mix = (a: number, b: number) => a === b ? String(a) : `(${a}+(${b - a})*(${ease}))`;
  const width = mix(from.width, to.width), height = mix(from.height, to.height);
  // Map the changing viewport into the final, fixed crop. Outside that crop is
  // discarded; the perspective filter can turn off once it becomes identity.
  const left = `(${mix(from.x, to.x)}-${to.x}*${width}/${to.width})`;
  const top = `(${mix(from.y, to.y)}-${to.y}*${height}/${to.height})`;
  const right = `${left}+W*${width}/${to.width}`, bottom = `${top}+H*${height}/${to.height}`;
  return `perspective=x0='${left}':y0='${top}':x1='${right}':y1='${top}':x2='${left}':y2='${bottom}':x3='${right}':y3='${bottom}':sense=source:eval=frame:interpolation=cubic:enable='lt(t,${duration})'`;
}
