export type Crop = { x: number; y: number; width: number; height: number };
export type ClipZoom = { scale: number; x: number; y: number };
export type Clip = { id: string; start: number; end: number; speed?: number; zoom?: ClipZoom };
export const speedPresets: readonly number[] = [.25, .5, .75, 1, 1.25, 1.5, 1.75, 2, 3, 4];
export const MIN_SPEED = .25, MAX_SPEED = 4;
export const defaultZoom: ClipZoom = { scale: 1, x: .5, y: .5 };
export type Annotation = {
  id: string; type: 'text' | 'arrow' | 'rectangle' | 'pen';
  x: number; y: number; width: number; height: number;
  text: string; color: string; size: number; points?: { x: number; y: number }[];
};
export type Edits = {
  version: 2; clips: Clip[]; speed: number; crop: Crop; cropAspect: string;
  canvas: { aspect: string; ratio: number | null; fit: 'fit' | 'fill'; background: string; inset: number; customWidth?: number; customHeight?: number };
  filter: string; intensity: number; brightness: number; contrast: number;
  annotations: Annotation[]; resolution: string; format: 'mp4' | 'webm'; quality: string; muted: boolean;
};
export type Source = { file: Blob; name: string; width: number; height: number; duration: number };
export const uid = () => crypto.randomUUID();
export const fullCrop: Crop = { x: 0, y: 0, width: 1, height: 1 };
export const defaults = (duration: number): Edits => ({
  version: 2, clips: [{ id: uid(), start: 0, end: duration }], speed: 1,
  crop: { ...fullCrop }, cropAspect: 'Free', canvas: { aspect: 'Original', ratio: null, fit: 'fit', background: '#171717', inset: 0, customWidth: 16, customHeight: 9 },
  filter: 'Original', intensity: 100, brightness: 0, contrast: 0, annotations: [],
  resolution: 'original', format: 'mp4', quality: 'maximum', muted: false,
});
export function migrateEdits(value: Edits | Record<string, unknown>, duration: number): Edits {
  const base = defaults(duration);
  if (value.version === 2) return { ...base, ...value, canvas: { ...base.canvas, ...(value as Edits).canvas } } as Edits;
  const old = value as Record<string, unknown>;
  return { ...base, speed: Number(old.speed) || 1, crop: (old.crop as Crop) || base.crop, cropAspect: String(old.aspect || 'Free'),
    clips: [{ id: uid(), start: Number(old.start) || 0, end: Number(old.end) || duration }],
    resolution: String(old.resolution || 'original'), format: old.format === 'webm' ? 'webm' : 'mp4', quality: String(old.quality || 'maximum'), muted: !!old.muted };
}
export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
export function formatTime(seconds: number, precise = true) {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const rounded = Math.round(safe * (precise ? 10 : 1)) / (precise ? 10 : 1);
  return `${Math.floor(rounded / 60)}:${(rounded % 60).toFixed(precise ? 1 : 0).padStart(precise ? 4 : 2, '0')}`;
}
export const even = (n: number) => Math.max(2, Math.floor((n + 1e-7) / 2) * 2);
export const clipSpeed = (clip: Clip, edits: Edits) => clip.speed ?? edits.speed;
export const clipDuration = (clip: Clip, edits: Edits) => (clip.end - clip.start) / clipSpeed(clip, edits);
export const sequenceDuration = (edits: Edits) => edits.clips.reduce((n, c) => n + clipDuration(c, edits), 0);
export function toSourceTime(time: number, edits: Edits): { time: number; index: number } {
  let remaining = Math.max(0, time);
  for (let i = 0; i < edits.clips.length; i++) {
    const clip = edits.clips[i], duration = clipDuration(clip, edits);
    if (remaining < duration || i === edits.clips.length - 1) return { time: clamp(clip.start + remaining * clipSpeed(clip, edits), clip.start, clip.end), index: i };
    remaining -= duration;
  }
  return { time: 0, index: 0 };
}
export function toSequenceTime(time: number, edits: Edits) {
  let elapsed = 0;
  for (const clip of edits.clips) {
    if (time < clip.end) return elapsed + clamp(time - clip.start, 0, clip.end - clip.start) / clipSpeed(clip, edits);
    elapsed += clipDuration(clip, edits);
  }
  return elapsed;
}
// Zoom within the existing crop, keeping the output frame and legacy framing intact.
export function clipCrop(edits: Edits, clip?: Clip): Crop {
  const { scale, x, y } = clip?.zoom ?? defaultZoom, base = edits.crop;
  const width = base.width / scale, height = base.height / scale;
  return { width, height, x: base.x + (base.width - width) * x, y: base.y + (base.height - height) * y };
}
export function canMergeClips(left: Clip | undefined, right: Clip | undefined, edits: Edits) {
  if (!left || !right || Math.abs(left.end - right.start) > 1e-7 || clipSpeed(left, edits) !== clipSpeed(right, edits)) return false;
  const a = left.zoom ?? defaultZoom, b = right.zoom ?? defaultZoom;
  return a.scale === b.scale && (a.scale === 1 || (a.x === b.x && a.y === b.y));
}
export function cropPixels(source: Source, crop: Crop) {
  const width = even(source.width * crop.width), height = even(source.height * crop.height);
  return { width, height, x: Math.min(source.width - width, Math.max(0, Math.floor(source.width * crop.x / 2) * 2)), y: Math.min(source.height - height, Math.max(0, Math.floor(source.height * crop.y / 2) * 2)) };
}
export function canvasSize(source: Source, edits: Edits) {
  const crop = cropPixels(source, edits.crop);
  if (!edits.canvas.ratio) return { width: crop.width, height: crop.height };
  const ratio = edits.canvas.ratio;
  const short = Math.min(crop.width, crop.height);
  return { width: even(ratio >= 1 ? short * ratio : short), height: even(ratio >= 1 ? short : short / ratio) };
}
export function outputSize(source: Source, edits: Edits) {
  const { width, height } = canvasSize(source, edits);
  const factor = edits.resolution === 'original' ? 1 : Math.min(1, Number(edits.resolution) / Math.min(width, height));
  return { width: even(width * factor), height: even(height * factor) };
}
export function placement(source: Source, edits: Edits, output: { width: number; height: number }) {
  const crop = cropPixels(source, edits.crop);
  const inset = Math.min(output.width, output.height) * clamp(edits.canvas.inset || 0, 0, 20) / 100;
  const scale = edits.canvas.fit === 'fit' ? Math.min((output.width - 2 * inset) / crop.width, (output.height - 2 * inset) / crop.height) : Math.max(output.width / crop.width, output.height / crop.height);
  const width = even(crop.width * scale), height = even(crop.height * scale);
  return { width, height, x: Math.floor((output.width - width) / 4) * 2, y: Math.floor((output.height - height) / 4) * 2 };
}
export const ratios: Record<string, number> = { '1:1': 1, '16:9': 16 / 9, '9:16': 9 / 16, '4:5': 4 / 5, '4:3': 4 / 3, '21:9': 21 / 9 };
