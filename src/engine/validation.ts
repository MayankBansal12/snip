import type { Annotation, Edits } from '../types';

const INVALID = 'This project is incomplete or damaged. Your current workspace hasn’t changed.';
const fail = (): never => { throw new Error(INVALID); };
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  return value as Record<string, unknown>;
};
const number = (value: unknown, min: number, max: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) return fail();
  return value;
};
const string = (value: unknown, max: number): string => {
  if (typeof value !== 'string' || value.length > max) return fail();
  return value;
};
const choice = <T extends string>(value: unknown, choices: readonly T[]): T => {
  if (!choices.includes(value as T)) return fail();
  return value as T;
};
const color = (value: unknown) => {
  const result = string(value, 7);
  return /^#[0-9a-f]{6}$/i.test(result) ? result : fail();
};
const list = (value: unknown, max: number): unknown[] => {
  if (!Array.isArray(value) || value.length > max) return fail();
  return value;
};
const uniqueId = (value: unknown, seen: Set<string>) => {
  const id = string(value, 128);
  if (!id || seen.has(id)) return fail();
  seen.add(id);
  return id;
};

export function validateEdits(value: unknown, duration: number, endpointTolerance = .05): Edits {
  const e = record(value), crop = record(e.crop), canvas = record(e.canvas);
  if (e.version !== 2 || typeof e.muted !== 'boolean') return fail();
  let pointCount = 0;
  const clipIds = new Set<string>(), annotationIds = new Set<string>();
  const clips = list(e.clips, 10000).map(value => {
    const c = record(value), start = number(c.start, 0, duration);
    const end = Math.min(duration, number(c.end, 0, duration + endpointTolerance));
    if (end <= start) return fail();

    const zoom = c.zoom === undefined ? undefined : record(c.zoom);
    return { id: uniqueId(c.id, clipIds), start, end,
      ...(c.speed === undefined ? {} : { speed: number(c.speed, .25, 4) }),
      ...(zoom ? { zoom: { scale: number(zoom.scale, 1, 4), x: number(zoom.x, 0, 1), y: number(zoom.y, 0, 1) } } : {}) };

  });
  if (!clips.length) return fail();
  const ordered = [...clips].sort((a, b) => a.start - b.start);
  if (ordered.some((clip, i) => i > 0 && clip.start < ordered[i - 1].end - 1e-7)) return fail();
  const annotations: Annotation[] = list(e.annotations, 1000).map(value => {
    const a = record(value), type = choice(a.type, ['text', 'arrow', 'rectangle', 'pen']);
    const points = a.points === undefined ? undefined : list(a.points, 100000).map(value => {
      const p = record(value);
      if (++pointCount > 100000) return fail();
      return { x: number(p.x, -1, 1), y: number(p.y, -1, 1) };
    });
    return { id: uniqueId(a.id, annotationIds), type, x: number(a.x, 0, 1), y: number(a.y, 0, 1),
      width: number(a.width, -1, 1), height: number(a.height, -1, 1), text: string(a.text, 200),
      color: color(a.color), size: number(a.size, .001, .16), ...(points ? { points } : {}) };
  });
  const checkedCrop = { x: number(crop.x, 0, 1), y: number(crop.y, 0, 1),
    width: number(crop.width, Number.EPSILON, 1), height: number(crop.height, Number.EPSILON, 1) };
  if (checkedCrop.x + checkedCrop.width > 1.0000001 || checkedCrop.y + checkedCrop.height > 1.0000001) return fail();
  return {
    version: 2, clips, annotations, crop: checkedCrop, muted: e.muted,
    speed: number(e.speed, .25, 4), cropAspect: choice(e.cropAspect, ['Free', 'Original', '1:1', '16:9', '9:16', '4:5', '4:3', '21:9']),
    canvas: { aspect: choice(canvas.aspect, ['Original', 'Custom', '1:1', '16:9', '9:16', '4:5', '4:3', '21:9']),
      ratio: canvas.ratio === null ? null : number(canvas.ratio, .2, 5),
      fit: choice(canvas.fit, ['fit', 'fill']), background: color(canvas.background), inset: number(canvas.inset, 0, 20),
      ...(canvas.customWidth === undefined ? {} : { customWidth: number(canvas.customWidth, 1, 8192) }),
      ...(canvas.customHeight === undefined ? {} : { customHeight: number(canvas.customHeight, 1, 8192) }) },
    filter: choice(e.filter, ['Original', 'Mono', 'Warm', 'Cool', 'Soft', 'Vivid']),
    intensity: number(e.intensity, 0, 100), brightness: number(e.brightness, -30, 30), contrast: number(e.contrast, -30, 30),
    resolution: choice(e.resolution, ['original', '2160', '1440', '1080', '720', '480', '360']),
    format: choice(e.format, ['mp4', 'webm']), quality: choice(e.quality, ['maximum', 'compact']),
  };
}

