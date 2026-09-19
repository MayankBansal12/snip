import type { Annotation, Edits, Source } from './types';
import { readMetadata } from './media';

// A small, versioned container: 8-byte signature, uint32 LE version, uint32 LE
// JSON length, UTF-8 manifest, then the original video bytes. Blob slices keep
// the video out of JS memory; no base64, recompression, or external dependencies.
const MAGIC = 'SNIPFILE';
const VERSION = 1;
const HEADER_SIZE = 16;
const MAX_MANIFEST = 8 * 1024 * 1024;
export const MAX_VIDEO_SIZE = 500 * 1024 * 1024;
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

function validateEdits(value: unknown, duration: number): Edits {
  const e = record(value), crop = record(e.crop), canvas = record(e.canvas);
  if (e.version !== 2 || typeof e.muted !== 'boolean') return fail();
  let previousEnd = 0, pointCount = 0;
  const clipIds = new Set<string>(), annotationIds = new Set<string>();
  const clips = list(e.clips, 10000).map(value => {
    const c = record(value), start = number(c.start, 0, duration);
    const end = Math.min(duration, number(c.end, 0, duration + .05));
    if (end <= start || start < previousEnd - 1e-7) return fail();
    previousEnd = end;
    return { id: uniqueId(c.id, clipIds), start, end };
  });
  if (!clips.length) return fail();
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

export function createProjectFile(source: Source, edits: Edits): { blob: Blob; name: string } {
  if (!source.file.size || source.file.size > MAX_VIDEO_SIZE) throw new Error('Projects support videos up to 500 MB.');
  // Validate our own output too, so Save never produces a file we cannot reopen.
  const checked = validateEdits(edits, source.duration);
  const sourceName = source.name.replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 1024) || 'Untitled';
  const manifest = new TextEncoder().encode(JSON.stringify({
    savedAt: new Date().toISOString(), source: { name: sourceName, type: source.file.type, size: source.file.size }, edits: checked,
  }));
  if (manifest.byteLength > MAX_MANIFEST) throw new Error('This project has too many edits to save. Try removing a few annotations.');
  const header = new Uint8Array(HEADER_SIZE);
  header.set(new TextEncoder().encode(MAGIC));
  const view = new DataView(header.buffer);
  view.setUint32(8, VERSION, true); view.setUint32(12, manifest.byteLength, true);
  return { blob: new Blob([header, manifest, source.file], { type: 'application/octet-stream' }),
    name: `${sourceName.replace(/\.[^.]+$/, '') || 'Untitled'}.snip` };
}

export async function readProjectFile(file: File): Promise<{ source: Source; edits: Edits }> {
  if (file.size < HEADER_SIZE || file.size > MAX_VIDEO_SIZE + MAX_MANIFEST + HEADER_SIZE) return fail();
  const header = await file.slice(0, HEADER_SIZE).arrayBuffer();
  if (new TextDecoder().decode(header.slice(0, 8)) !== MAGIC) throw new Error('This isn’t a snip project. Choose a .snip file saved from the editor.');
  const view = new DataView(header);
  if (view.getUint32(8, true) !== VERSION) throw new Error('This project uses a different snip version. Update the editor and try again.');
  const length = view.getUint32(12, true), offset = HEADER_SIZE + length;
  if (!length || length > MAX_MANIFEST || offset >= file.size) return fail();
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await file.slice(HEADER_SIZE, offset).arrayBuffer())); }
  catch { return fail(); }
  const manifest = record(raw), info = record(manifest.source);
  const name = string(info.name, 1024), type = string(info.type, 128), size = number(info.size, 1, MAX_VIDEO_SIZE);
  if (!name || /[\\/\u0000-\u001f]/.test(name) || !Number.isSafeInteger(size) || file.size - offset !== size) return fail();
  // Never trust dimensions/duration supplied by a project file. Decode the
  // embedded video locally, then validate every edit against its real duration.
  const source = await readMetadata(new File([file.slice(offset)], name, { type: type.startsWith('video/') ? type : '' }));
  const edits = validateEdits(manifest.edits, source.duration);
  return { source, edits };
}
