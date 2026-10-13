import { useEffect, useRef, useState } from 'react';
import type { PointerEvent, RefObject } from 'react';
import { clipDuration } from '../types';
import type { Edits } from '../types';

type Drop = { id: string; from: number; to: number; marker: number; x: number; y: number; valid: boolean };
type Drag = { pointer: number; id: string; startX: number; startY: number; x: number; y: number; active: boolean; element: HTMLElement; edits: Edits };
type Props = {
  edits: Edits; track: RefObject<HTMLDivElement | null>; scroll: RefObject<HTMLDivElement | null>;
  onSelect: (id: string) => void; onStart: () => void; onMove: (id: string, index: number) => void;
};

// Keep the sequence untouched until drop, so a move is exactly one undo step.
export function useClipReorder(p: Props) {
  const latest = useRef(p); latest.current = p;
  const drag = useRef<Drag | null>(null), frame = useRef(0);
  const [drop, setDrop] = useState<Drop | null>(null);
  const cancel = () => {
    const d = drag.current; drag.current = null;
    cancelAnimationFrame(frame.current); setDrop(null);
    if (d?.element.hasPointerCapture(d.pointer)) d.element.releasePointerCapture(d.pointer);
  };
  const destination = (d: Drag): Drop | null => {
    const { track, scroll } = latest.current;
    if (!track.current || !scroll.current) return null;
    const box = track.current.getBoundingClientRect(), view = scroll.current.getBoundingClientRect();
    const durations = d.edits.clips.map(c => clipDuration(c, d.edits)), total = durations.reduce((a, b) => a + b, 0);
    const from = d.edits.clips.findIndex(c => c.id === d.id);
    let offset = 0, to = 0, marker = 0;
    const remaining: { left: number; center: number }[] = [];
    durations.forEach((duration, index) => {
      if (index !== from) remaining.push({ left: offset, center: offset + duration / 2 });
      offset += duration;
    });
    const position = (d.x - box.left) / box.width * total;
    to = remaining.filter(c => position > c.center).length;
    marker = (remaining[to]?.left ?? total) / total * 100;
    return { id: d.id, from, to, marker, x: d.x, y: d.y,
      valid: d.y >= box.top - 48 && d.y <= box.bottom + 48 && d.x >= view.left - 48 && d.x <= view.right + 48 };
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
    setDrop(old => old && next && Object.keys(next).every(k => old[k as keyof Drop] === next[k as keyof Drop]) ? old : next);
    frame.current = requestAnimationFrame(tick);
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!drag.current) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.key === 'Escape') cancel();
    };
    const blur = () => cancel();
    window.addEventListener('keydown', key, true); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('blur', blur); cancelAnimationFrame(frame.current); };
  }, []);
  useEffect(() => { if (drag.current && drag.current.edits !== p.edits) cancel(); }, [p.edits]);
  const start = (event: PointerEvent<HTMLElement>, id: string) => {
    event.stopPropagation();
    if (event.button !== 0 || drag.current) return;
    event.preventDefault();
    p.onStart(); p.onSelect(id); event.currentTarget.focus();
    drag.current = { pointer: event.pointerId, id, startX: event.clientX, startY: event.clientY,
      x: event.clientX, y: event.clientY, active: false, element: event.currentTarget, edits: p.edits };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent) => {
    const d = drag.current; if (!d || d.pointer !== event.pointerId) return;
    d.x = event.clientX; d.y = event.clientY;
    if (!d.active && Math.hypot(d.x - d.startX, d.y - d.startY) >= 6) { d.active = true; tick(); }
  };
  const end = (event: PointerEvent) => {
    const d = drag.current; if (!d || d.pointer !== event.pointerId) return;
    d.x = event.clientX; d.y = event.clientY;
    const next = d.active ? destination(d) : null;
    cancel();
    if (next?.valid && next.to !== next.from) latest.current.onMove(d.id, next.to);
  };
  return { drop, start, move, end, cancel };
}
