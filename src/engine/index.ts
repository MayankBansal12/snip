import type { Clip, Edits, Source } from '../types';
import { canMergeClips, clipDuration, defaultZoom, outputSize } from '../types';
import { validateEdits } from './validation';

export const ENGINE_VERSION = 1;
export const RENDER_PROFILE = 'ffmpeg-wasm-0.12.10-single-v1';
export const MAX_JSON_BYTES = 8 * 1024 * 1024;
export type SourceInfo = { sha256: string; size: number; width: number; height: number; duration: number };
export type Specification = { version: 1; renderer: typeof RENDER_PROFILE; source: SourceInfo; edits: Edits };
export type Command =
  | { action: 'splitClip'; clipId: string; sourceTime: number; rightClipId: string }
  | { action: 'trimClip'; clipId: string; sourceStart: number; sourceEnd: number }
  | { action: 'setSpeed'; clipId: string; speed: number }
  | { action: 'setZoom'; clipId: string; zoom: NonNullable<Clip['zoom']> }
  | { action: 'deleteClip'; clipId: string }
  | { action: 'mergeClips'; clipId: string }
  | { action: 'reorderClips'; clipIds: string[] }
  | { action: 'setOutput'; format?: Edits['format']; resolution?: string; quality?: string; muted?: boolean };
export type Batch = { requestId: string; sessionId: string; revision: number; commands: Command[] };

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object.');
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unknown field: ${key}`);
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !value.length || value.length > 128) throw new Error('IDs must contain 1–128 characters.');
  return value;
}
export function parseJSON(text: string): unknown {
  if (new TextEncoder().encode(text).length > MAX_JSON_BYTES) throw new Error('Edit JSON exceeds 8 MiB.');
  try { return JSON.parse(text); } catch { throw new Error('Invalid JSON.'); }
}
/** Pure, deterministic normalization. Legacy omitted values become explicit. */
export function normalizeEdits(value: unknown, duration: number): Edits {
  const raw = object(value);
  const allowed = ['version','clips','speed','crop','cropAspect','canvas','filter','intensity','brightness','contrast','annotations','resolution','format','quality','muted'];
  keys(raw, allowed);
  if (Array.isArray(raw.clips)) for (const clip of raw.clips) {
    const c = object(clip); keys(c, ['id','start','end','speed','zoom']);
    if (c.zoom !== undefined) keys(object(c.zoom), ['scale','x','y']);
  }
  keys(object(raw.crop), ['x','y','width','height']);
  keys(object(raw.canvas), ['aspect','ratio','fit','background','inset','customWidth','customHeight']);
  if (Array.isArray(raw.annotations)) for (const annotation of raw.annotations) {
    const a = object(annotation); keys(a, ['id','type','x','y','width','height','text','color','size','points']);
    if (Array.isArray(a.points)) for (const point of a.points) keys(object(point), ['x','y']);
  }
  let edits: Edits;
  try { edits = validateEdits(value, duration, 0); } catch { throw new Error('Invalid edits: check unique IDs, non-overlapping source ranges, numeric limits, and output settings.'); }
  return { ...edits, clips: edits.clips.map(c => ({ ...c, speed: c.speed ?? edits.speed, zoom: c.zoom ?? { ...defaultZoom } })) };
}
export function createSpecification(source: SourceInfo, edits: Edits): Specification {
  return { version: ENGINE_VERSION, renderer: RENDER_PROFILE, source: { ...source }, edits: normalizeEdits(edits, source.duration) };
}
export function readSpecification(value: unknown, source: SourceInfo): Specification {
  const spec = object(value); keys(spec, ['version','renderer','source','edits']);
  if (spec.version !== ENGINE_VERSION || spec.renderer !== RENDER_PROFILE) throw new Error('Unsupported edit specification or rendering profile.');
  const info = object(spec.source); keys(info, ['sha256','size','width','height','duration']);
  for (const key of ['sha256','size','width','height','duration'] as const)
    if (info[key] !== source[key]) throw new Error('This JSON belongs to a different source video or decoded source metadata.');
  return createSpecification(source, normalizeEdits(spec.edits, source.duration));
}
/** Every command runs against a private copy; an invalid batch changes nothing. */
export function applyCommands(value: Edits, commands: unknown, duration: number): Edits {
  if (!Array.isArray(commands) || !commands.length || commands.length > 1000) throw new Error('Supply 1–1,000 commands.');
  let edits = normalizeEdits(value, duration);
  for (const input of commands) {
    const c = object(input);
    const action = c.action;
    if (action === 'reorderClips') {
      keys(c, ['action','clipIds']);
      if (!Array.isArray(c.clipIds) || c.clipIds.length !== edits.clips.length || new Set(c.clipIds).size !== edits.clips.length) throw new Error('Specify every clip ID exactly once.');
      edits.clips = c.clipIds.map(value => { const clip = edits.clips.find(clip => clip.id === id(value)); if (!clip) throw new Error('Unknown clip ID.'); return clip; });
    } else if (action === 'setOutput') {
      keys(c, ['action','format','resolution','quality','muted']);
      const { action: _, ...patch } = c; edits = { ...edits, ...patch } as Edits;
    } else {
      const index = edits.clips.findIndex(clip => clip.id === id(c.clipId));
      if (index < 0) throw new Error(`Unknown clip ID: ${String(c.clipId)}`);
      const clip = edits.clips[index];
      switch (action) {
        case 'splitClip': {
          keys(c, ['action','clipId','sourceTime','rightClipId']);
          const time = c.sourceTime;
          if (typeof time !== 'number' || !Number.isFinite(time) || time - clip.start < .1 || clip.end - time < .1) throw new Error('A split must leave at least 0.1 seconds on both sides.');
          const rightId = id(c.rightClipId);
          if (edits.clips.some(clip => clip.id === rightId)) throw new Error('The new clip ID already exists.');
          edits.clips.splice(index, 1, { ...clip, end: time }, { ...clip, id: rightId, start: time }); break;
        }
        case 'trimClip': keys(c, ['action','clipId','sourceStart','sourceEnd']); edits.clips[index] = { ...clip, start: c.sourceStart as number, end: c.sourceEnd as number }; break;
        case 'setSpeed': keys(c, ['action','clipId','speed']); if(typeof c.speed!=='number')throw new Error('Speed must be a number.'); edits.clips[index] = { ...clip, speed: c.speed as number }; break;
        case 'setZoom': keys(c, ['action','clipId','zoom']); keys(object(c.zoom), ['scale','x','y']); edits.clips[index] = { ...clip, zoom: c.zoom as Clip['zoom'] }; break;
        case 'deleteClip': keys(c, ['action','clipId']); edits.clips.splice(index, 1); break;
        case 'mergeClips': {
          keys(c, ['action','clipId']); const right = edits.clips[index + 1];
          if (!canMergeClips(clip, right, edits)) throw new Error('Merge requires adjacent source ranges with matching speed and zoom.');
          edits.clips.splice(index, 2, { ...clip, end: right.end }); break;
        }
        default: throw new Error(`Unknown action: ${String(action)}`);
      }
    }
    edits = normalizeEdits(edits, duration);
  }
  return edits;
}
export function compileTimeline(source: Source, value: Edits) {
  const edits = normalizeEdits(value, source.duration);
  let end = 0;
  const clips = edits.clips.map(clip => {
    const start = end; end += clipDuration(clip, edits);
    return { clipId: clip.id, sourceStart: clip.start, sourceEnd: clip.end, sequenceStart: start, sequenceEnd: end };
  });
  return { renderer: RENDER_PROFILE, edits, clips, duration: end, output: outputSize(source, edits) };
}
/** Browser session concurrency and retry protection, separate from pure edit math. */
export class EditSession {
  revision = 0;
  private receipts = new Map<string, { input: string; revision: number }>();
  constructor(readonly sessionId: string) {}
  changed() { this.revision++; }
  apply(value: unknown, edits: Edits, duration: number) {
    const batch = object(value); keys(batch, ['requestId','sessionId','revision','commands']);
    const requestId = id(batch.requestId);
    if (batch.sessionId !== this.sessionId) throw new Error('Project session changed. Read the project again.');
    const input = JSON.stringify(batch);
    const receipt = this.receipts.get(requestId);
    if (receipt) {
      if (receipt.input !== input) throw new Error('Request ID was already used with different contents.');
      return { edits, revision: receipt.revision, duplicate: true };
    }
    if (batch.revision !== this.revision) throw new Error('Project revision changed. Read the project again.');
    const next = applyCommands(edits, batch.commands, duration);
    // Never evict a receipt and risk executing an old retry again.
    if (this.receipts.size >= 10000) throw new Error('Session request limit reached. Reopen the project.');
    this.changed(); this.receipts.set(requestId, { input, revision: this.revision });
    return { edits: next, revision: this.revision, duplicate: false };
  }
}
