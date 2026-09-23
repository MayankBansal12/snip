import { clamp, clipCrop, clipDuration, cropPixels } from './types';
import type { ClipZoom, Edits, Source } from './types';

type Viewport = ReturnType<typeof cropPixels>;
export const ZOOM_TRANSITION_SECONDS = .55;
export const ZOOM_TRANSITION_FPS = 60;

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
  // Zero velocity and acceleration at both ends, without overshoot.
  const eased = progress ** 3 * (progress * (progress * 6 - 15) + 10);
  const mix = (a: number, b: number) => a + (b - a) * eased;
  // Interpolate magnification proportionally and pan around the viewport center.
  const width = from.width * (to.width / from.width) ** eased;
  const height = from.height * (to.height / from.height) ** eased;
  return { x: mix(from.x + from.width / 2, to.x + to.width / 2) - width / 2,
    y: mix(from.y + from.height / 2, to.y + to.height / 2) - height / 2, width, height };
}

/** Match the preview's viewport without resizing the output canvas or overlapping clips. */
export function zoomTransitionFilter(source: Source, edits: Edits, index: number, frameRate: number) {
  const { from, to, duration } = zoomTransition(source, edits, index);
  if (!duration) return null;
  const frames = frameRate * duration;
  // FFmpeg 5.1 perspective numbers its first output frame as 1.
  const progress = `min(1,max(0,(on-1)/${frames}))`;
  const ease = `(pow(${progress},3)*(${progress}*(${progress}*6-15)+10))`;
  const mix = (a: number, b: number) => a === b ? String(a) : `(${a}+(${b - a})*(${ease}))`;
  const scale = (a: number, b: number) => a === b ? String(a) : `(${a}*pow(${b / a},${ease}))`;
  const width = scale(from.width, to.width), height = scale(from.height, to.height);
  const x = `(${mix(from.x + from.width / 2, to.x + to.width / 2)}-${width}/2)`;
  const y = `(${mix(from.y + from.height / 2, to.y + to.height / 2)}-${height}/2)`;
  // Map the changing viewport into the final, fixed crop. Outside that crop is
  // discarded; the perspective filter can turn off once it becomes identity.
  const left = `(${x}-${to.x}*${width}/${to.width})`;
  const top = `(${y}-${to.y}*${height}/${to.height})`;
  const right = `${left}+W*${width}/${to.width}`, bottom = `${top}+H*${height}/${to.height}`;
  return `perspective=x0='${left}':y0='${top}':x1='${right}':y1='${top}':x2='${left}':y2='${bottom}':x3='${right}':y3='${bottom}':sense=source:eval=frame:interpolation=cubic:enable='lt(t,${duration})'`;
}

export function zoomFocusLabel(zoom: ClipZoom): string {
  if (zoom.scale === 1) return 'full frame';
  const horizontal = zoom.x < .25 ? 'left' : zoom.x > .75 ? 'right' : '';
  const vertical = zoom.y < .25 ? 'top' : zoom.y > .75 ? 'bottom' : '';
  return [vertical, horizontal].filter(Boolean).join(' ') || 'center';
}
