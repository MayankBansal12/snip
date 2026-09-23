import { validateEdits } from './engine/validation';
import type { Edits, Source } from './types';
import { readMetadata } from './media';

// A small, versioned container: 8-byte signature, uint32 LE version, uint32 LE
// JSON length, UTF-8 manifest, then the original video bytes. Blob slices keep
// the video out of JS memory; no base64, recompression, or external dependencies.
const MAGIC = 'SNIPFILE';
const VERSION = 2;
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
  if (![1, VERSION].includes(view.getUint32(8, true))) throw new Error('This project uses a different snip version. Update the editor and try again.');
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
