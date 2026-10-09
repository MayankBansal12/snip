import type { Blur, Edits } from './types.js';
import { clipDuration, clipSpeed } from './types.js';

export const blurActive = (blur: Blur, time: number) => time >= blur.start && time < blur.end;
export const blurRadius = (blur: Blur, width: number, height: number) => Math.min(width, height) * blur.strength / 2000;
export const blurName = (blur: Blur, index: number) => blur.name?.trim() || `blur ${index + 1}`;
export const blurRangeStatus = (blur: Blur, duration: number) => blur.start >= duration ? 'outside' : blur.end > duration + 1e-7 ? 'clipped' : 'inside';

// Store editable ranges in output time. When clips change, project the covered
// source intervals onto the new sequence (also works across splits/merges).
// If reordered clips separate covered content, create one area per contiguous
// run rather than blurring unrelated footage between them.
export function retimeBlurs(before: Edits, after: Edits): Blur[] {
  const timeline = (edits: Edits) => {
    let offset = 0;
    return edits.clips.map(clip => {
      const start = offset, speed = clipSpeed(clip, edits); offset += clipDuration(clip, edits);
      return { clip, start, end: offset, speed };
    });
  };
  const previous = timeline(before), next = timeline(after);
  if (previous.length === next.length && previous.every((item, i) => item.clip.start === next[i].clip.start && item.clip.end === next[i].clip.end && item.start === next[i].start && item.speed === next[i].speed)) return before.blurs;
  const ids = new Set(before.blurs.map(blur => blur.id)), names = new Set(before.blurs.map(blurName));
  return before.blurs.flatMap(blur => {
    // Preserve imported ranges with no content in the original video so they
    // remain recoverable in the outside-video menu.
    if (blur.start >= (previous.at(-1)?.end ?? 0)) return [blur];
    const covered = previous.flatMap(item => {
      const start = Math.max(blur.start, item.start), end = Math.min(blur.end, item.end);
      return end > start ? [{ start: item.clip.start + (start - item.start) * item.speed, end: item.clip.start + (end - item.start) * item.speed }] : [];
    });
    const mapped = next.flatMap(item => covered.flatMap(part => {
      const start = Math.max(part.start, item.clip.start), end = Math.min(part.end, item.clip.end);
      return end > start + 1e-9 ? [{ start: item.start + (start - item.clip.start) / item.speed, end: item.start + (end - item.clip.start) / item.speed }] : [];
    }));
    if (!mapped.length) return [];
    const runs: { start: number; end: number }[] = [];
    for (const part of mapped.sort((a, b) => a.start - b.start)) {
      const last = runs.at(-1);
      if (last && part.start <= last.end + 1e-9) last.end = Math.max(last.end, part.end);
      else runs.push({ ...part });
    }
    return runs.map((range, index) => {
      if (!index) return { ...blur, ...range };
      let suffix = index + 1, id = `${blur.id.slice(0, 110)}~${suffix}`;
      while (ids.has(id)) id = `${blur.id.slice(0, 110)}~${++suffix}`;
      ids.add(id);
      let number = 1; while (names.has(`blur ${number}`)) number++;
      const name = `blur ${number}`; names.add(name);
      return { ...blur, ...range, id, name };
    });
  });
}

export function fitBlurRange(blur: Blur, duration: number) {
  if (blur.start < duration) return { start: blur.start, end: Math.min(blur.end, duration) };
  return { start: Math.max(0, duration - (blur.end - blur.start)), end: duration };
}

export function blurTimecode(time: number) {
  const milliseconds = Math.round(time * 1000), minutes = Math.floor(milliseconds / 60000);
  const seconds = ((milliseconds % 60000) / 1000).toFixed(3).padStart(6, '0');
  return `${minutes}:${seconds.replace(/0$/, '')}`;
}

export function parseBlurTimecode(value: string): number | null {
  const text = value.trim();
  if (!/^\d+(?::[0-5]?\d)?(?:\.\d{1,3})?$/.test(text)) return null;
  const parts = text.split(':');
  const result = parts.length === 2 ? Number(parts[0]) * 60 + Number(parts[1]) : Number(parts[0]);
  return Number.isFinite(result) ? result : null;
}

export function blurPixels(blur: Blur, width: number, height: number) {
  const x = Math.min(width - 1, Math.round(blur.x * width)), y = Math.min(height - 1, Math.round(blur.y * height));
  return { x, y, width: Math.max(1, Math.min(width - x, Math.round(blur.width * width))),
    height: Math.max(1, Math.min(height - y, Math.round(blur.height * height))) };
}

// Blur the whole picture before cropping: the rectangle samples neighboring
// pixels without dark seams at its edges. Each pass preserves overlap order.
export function blurFilterGraph(blurs: Blur[], width: number, height: number, duration: number, input = 'picture') {
  const graph: string[] = [];
  let label = input;
  blurs.forEach((blur, index) => {
    if (blur.start >= duration) return;
    const p = blurPixels(blur, width, height), base = `blur${index}`;
    graph.push(`[${label}]split=2[${base}base][${base}source]`);
    graph.push(`[${base}source]gblur=sigma=${blurRadius(blur, width, height)}:steps=3,crop=${p.width}:${p.height}:${p.x}:${p.y}:exact=1[${base}region]`);
    graph.push(`[${base}base][${base}region]overlay=${p.x}:${p.y}:format=auto:enable='gte(t,${blur.start})*lt(t,${blur.end})'[${base}out]`);
    label = `${base}out`;
  });
  return { graph, label };
}

export function drawBlurs(ctx: OffscreenCanvasRenderingContext2D, scratch: OffscreenCanvas, blurs: Blur[], time: number) {
  const { width, height } = ctx.canvas, copy = scratch.getContext('2d')!;
  for (const blur of blurs) {
    if (!blurActive(blur, time)) continue;
    copy.clearRect(0, 0, width, height); copy.drawImage(ctx.canvas, 0, 0);
    const p = blurPixels(blur, width, height);
    ctx.save();
    ctx.beginPath(); ctx.rect(p.x, p.y, p.width, p.height); ctx.clip();
    ctx.filter = `blur(${blurRadius(blur, width, height)}px)`;
    ctx.drawImage(scratch, 0, 0);
    ctx.restore();
  }
}
