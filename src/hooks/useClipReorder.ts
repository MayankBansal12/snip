import { useEffect, useRef, useState } from 'react';
import type { PointerEvent, RefObject } from 'react';
import { clamp, clipDuration } from '../types';
import type { Edits } from '../types';

export type ClipDrop = { id: string; from: number; to: number; marker: number; x: number; y: number; width: number; valid: boolean };
export type ClipLanding = ClipDrop & { originX: number; originY: number };
type Drag = { pointer: number; id: string; startX: number; startY: number; x: number; y: number; active: boolean; element: HTMLElement; edits: Edits; width: number; grabX: number; grabY: number; to: number };
type Props = {
  edits: Edits; track: RefObject<HTMLDivElement | null>; scroll: RefObject<HTMLDivElement | null>;
  onSelect: (id: string) => void; onStart: () => void; onMove: (id: string, index: number) => void;
};

// Preview the insertion without changing edits; commit once on pointer-up.
export function useClipReorder(p: Props) {
  const latest = useRef(p); latest.current = p;
  const drag = useRef<Drag | null>(null), frame = useRef(0), preview = useRef<HTMLDivElement>(null);
  const [drop, setDrop] = useState<ClipDrop | null>(null), [landing, setLanding] = useState<ClipLanding | null>(null);
  const reset = () => {
    const d = drag.current; drag.current = null;
    cancelAnimationFrame(frame.current); setDrop(null);
    if (d?.element.hasPointerCapture(d.pointer)) d.element.releasePointerCapture(d.pointer);
  };
  const destination = (d: Drag): ClipDrop | null => {
    const { track, scroll } = latest.current;
    if (!track.current || !scroll.current) return null;
    const box = track.current.getBoundingClientRect(), view = scroll.current.getBoundingClientRect();
    const durations = d.edits.clips.map(c => clipDuration(c, d.edits)), total = durations.reduce((a, b) => a + b, 0);
    const from = d.edits.clips.findIndex(c => c.id === d.id);
    let offset = 0;
    const remaining: { duration: number; center: number }[] = [];
    durations.forEach((duration, index) => {
      if (index !== from) remaining.push({ duration, center: offset + duration / 2 });
      offset += duration;
    });
    const position = (d.x - box.left) / box.width * total;
    let to = remaining.filter(c => position > c.center).length;
    // A little hysteresis prevents the insertion slot flickering at a boundary.
    if (Math.abs(to - d.to) === 1) {
      const boundary = remaining[Math.min(to, d.to)];
      if (Math.abs(position - boundary.center) < Math.min(8 / box.width * total, boundary.duration / 4)) to = d.to;
    }
    d.to = to;
    const marker = remaining.slice(0, to).reduce((sum, c) => sum + c.duration, 0) / total * 100;
    return { id: d.id, from, to, marker, x: d.x - d.grabX, y: d.y - d.grabY - 6, width: d.width,
      valid: d.y >= box.top - 48 && d.y <= box.bottom + 48 && d.x >= view.left - 48 && d.x <= view.right + 48 };
  };
  const settle = (d: Drag, next: ClipDrop, commit: boolean) => {
    const box = latest.current.track.current?.getBoundingClientRect();
    if (!box) return;
    const durations = d.edits.clips.map(c => clipDuration(c, d.edits)), total = durations.reduce((a, b) => a + b, 0);
    const position = commit ? next.marker / 100 * box.width : durations.slice(0, next.from).reduce((a, b) => a + b, 0) / total * box.width;
    const slotWidth = durations[next.from] / total * box.width;
    setLanding({ ...next, x: box.left + position + (slotWidth - d.width) / 2, y: box.top, originX: next.x, originY: next.y, valid: true });
  };
  const cancel = () => {
    const d = drag.current, next = d?.active ? destination(d) : null;
    if (d && next) settle(d, next, false);
    reset();
  };
  const tick = () => {
    const d = drag.current, el = latest.current.scroll.current;
    if (!d?.active || !el) return;
    const box = el.getBoundingClientRect(), trackBox = latest.current.track.current?.getBoundingClientRect();
    if (trackBox && d.y >= trackBox.top - 48 && d.y <= trackBox.bottom + 48) {
      const margin = Math.min(48, box.width / 4);
      const delta = d.x < box.left + margin ? -Math.min(12, (box.left + margin - d.x) / 4)
        : d.x > box.right - margin ? Math.min(12, (d.x - box.right + margin) / 4) : 0;
      if (delta) el.scrollLeft += delta;
    }
    const next = destination(d);
    // Move the lifted thumbnail directly each frame; only rerender the timeline
    // when the destination changes, keeping long timelines responsive.
    if (next && preview.current) preview.current.style.transform = `translate3d(${next.x}px,${next.y}px,0)`;
    setDrop(old => old && next && old.id === next.id && old.to === next.to && old.valid === next.valid ? old : next);
    frame.current = requestAnimationFrame(tick);
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!drag.current) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.key === 'Escape') cancel();
    };
    const blur = () => { reset(); setLanding(null); };
    window.addEventListener('keydown', key, true); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('blur', blur); cancelAnimationFrame(frame.current); };
  }, []);
  useEffect(() => { if (drag.current && drag.current.edits !== p.edits) { reset(); setLanding(null); } }, [p.edits]);
  const start = (event: PointerEvent<HTMLElement>, id: string) => {
    event.stopPropagation();
    if (event.button !== 0 || drag.current) return;
    event.preventDefault();
    const box = event.currentTarget.closest<HTMLElement>('.timeline-clip')!.getBoundingClientRect();
    const width = clamp(box.width, 80, 400);
    p.onStart(); p.onSelect(id); event.currentTarget.focus(); setLanding(null);
    drag.current = { pointer: event.pointerId, id, startX: event.clientX, startY: event.clientY,
      x: event.clientX, y: event.clientY, active: false, element: event.currentTarget, edits: p.edits,
      width, grabX: clamp((event.clientX - box.left) / box.width, 0, 1) * width, grabY: event.clientY - box.top,
      to: p.edits.clips.findIndex(c => c.id === id) };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent) => {
    const d = drag.current; if (!d || d.pointer !== event.pointerId) return;
    d.x = event.clientX; d.y = event.clientY;
    if (!d.active && Math.hypot(d.x - d.startX, d.y - d.startY) >= 6) { d.active = true; tick(); }
  };
  const end = (event: PointerEvent): 'tap' | 'drag' | null => {
    const d = drag.current; if (!d || d.pointer !== event.pointerId) return null;
    d.x = event.clientX; d.y = event.clientY;
    const next = d.active ? destination(d) : null;
    if (next) settle(d, next, next.valid);
    reset();
    if (next?.valid && next.to !== next.from) latest.current.onMove(d.id, next.to);
    return d.active ? 'drag' : 'tap';
  };
  return { drop, landing, preview, finishLanding: () => setLanding(null), start, move, end, cancel, reset };
}
