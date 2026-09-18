import type { Annotation, Edits } from './types';
export const filters = ['Original', 'Mono', 'Warm', 'Cool', 'Soft', 'Vivid'];
const identity = [1,0,0,0,1,0,0,0,1];
const presets: Record<string, { matrix: number[]; offset: number }> = {
  Original: { matrix: identity, offset: 0 },
  Mono: { matrix: [.2126,.7152,.0722,.2126,.7152,.0722,.2126,.7152,.0722], offset: 0 },
  Warm: { matrix: [1.06,.02,0,0,1,0,0,.015,.88], offset: 0 },
  Cool: { matrix: [.9,0,0,0,1,.015,0,.01,1.08], offset: 0 },
  Soft: { matrix: [.85,.025,.025,.025,.85,.025,.025,.025,.85], offset: .05 },
  Vivid: { matrix: [1.22,-.17,-.05,-.06,1.13,-.07,-.08,-.17,1.25], offset: 0 },
};
export function colorTreatment(edits: Pick<Edits, 'filter' | 'intensity' | 'brightness' | 'contrast'>) {
  const preset = presets[edits.filter] || presets.Original;
  const amount = edits.intensity / 100;
  const contrast = 1 + edits.contrast / 100;
  const matrix = preset.matrix.map((v,i) => (identity[i] + (v - identity[i]) * amount) * contrast);
  const offset = preset.offset * amount * contrast + (1 - contrast) / 2 + edits.brightness / 100;
  return { matrix, offset };
}
export function svgMatrix(edits: Edits) {
  const { matrix: m, offset: b } = colorTreatment(edits);
  return `${m[0]} ${m[1]} ${m[2]} 0 ${b} ${m[3]} ${m[4]} ${m[5]} 0 ${b} ${m[6]} ${m[7]} ${m[8]} 0 ${b} 0 0 0 1 0`;
}
export function colorLut(edits: Edits): string | null {
  if (edits.filter === 'Original' && !edits.brightness && !edits.contrast) return null;
  const { matrix: m, offset } = colorTreatment(edits), size = 33;
  const lines = ['TITLE "snip color treatment"', `LUT_3D_SIZE ${size}`, 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 1 1 1'];
  for (let b=0;b<size;b++) for (let g=0;g<size;g++) for (let r=0;r<size;r++) {
    const input=[r/(size-1),g/(size-1),b/(size-1)];
    lines.push([0,1,2].map(row=>Math.max(0,Math.min(1,m[row*3]*input[0]+m[row*3+1]*input[1]+m[row*3+2]*input[2]+offset)).toFixed(6)).join(' '));
  }
  return lines.join('\n');
}
export function drawAnnotation(ctx: CanvasRenderingContext2D, a: Annotation, width: number, height: number) {
  const x = a.x * width, y = a.y * height, w = a.width * width, h = a.height * height;
  const scale = Math.min(width, height);
  ctx.save(); ctx.strokeStyle = a.color; ctx.fillStyle = a.color; ctx.lineWidth = Math.max(1, a.size * scale); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (a.type === 'text') {
    const size = Math.max(8, a.size * scale);
    ctx.font = `600 ${size}px Arial, sans-serif`; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    ctx.shadowColor = '#0009'; ctx.shadowBlur = size * .12; ctx.shadowOffsetY = size * .025;
    const lines = a.text.split('\n'); lines.forEach((line,i) => ctx.fillText(line, x, y + (i - (lines.length - 1)/2) * size * 1.2, width * .94));
  } else if (a.type === 'rectangle') ctx.strokeRect(x,y,w,h);
  else if (a.type === 'arrow') {
    const angle = Math.atan2(h,w), head = Math.max(ctx.lineWidth * 4, scale * .025);
    ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+w,y+h);ctx.stroke();
    ctx.beginPath();ctx.moveTo(x+w-head*Math.cos(angle-.5),y+h-head*Math.sin(angle-.5));ctx.lineTo(x+w,y+h);ctx.lineTo(x+w-head*Math.cos(angle+.5),y+h-head*Math.sin(angle+.5));ctx.stroke();
  } else if (a.points?.length) {
    ctx.beginPath(); a.points.forEach((p,i)=>i ? ctx.lineTo((a.x+p.x)*width,(a.y+p.y)*height) : ctx.moveTo((a.x+p.x)*width,(a.y+p.y)*height));ctx.stroke();
  }
  ctx.restore();
}
export function renderAnnotations(annotations: Annotation[], width: number, height: number): Promise<Uint8Array> {
  const canvas = document.createElement('canvas'); canvas.width=width; canvas.height=height;
  const ctx = canvas.getContext('2d')!;
  annotations.forEach(a=>drawAnnotation(ctx,a,width,height));
  return new Promise((resolve,reject)=>canvas.toBlob(async blob=>blob ? resolve(new Uint8Array(await blob.arrayBuffer())) : reject(new Error('Could not render annotations.')), 'image/png'));
}
