import type { Blur } from './types.js';

export const blurActive = (blur: Blur, time: number) => time >= blur.start && time < blur.end;
export const blurRadius = (blur: Blur, width: number, height: number) => Math.min(width, height) * blur.strength / 2000;
export const blurName = (blur: Blur, index: number) => blur.name?.trim() || `blur ${index + 1}`;
export const blurRangeStatus = (blur: Blur, duration: number) => blur.start >= duration ? 'outside' : blur.end > duration + 1e-7 ? 'clipped' : 'inside';

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
