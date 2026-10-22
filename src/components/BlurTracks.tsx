import { useRef } from 'react';
import type { PointerEvent } from 'react';
import type { Blur } from '../types';
import { clamp } from '../types';
import { blurName, blurRangeStatus, blurTimecode } from '../blur';

type Props = { blurs: Blur[]; duration: number; maxTime: number; time: number; selected: string; onSelect: (id: string) => void; onFocus: (id: string) => void; onEdit: (id: string) => void; onDelete: () => void;
  onChange: (id: string, patch: Partial<Blur>, record?: boolean) => void; onCheckpoint: () => void; onSeek: (time: number) => void };
export default function BlurTracks({ blurs, duration, maxTime, time, selected, onSelect, onFocus, onEdit, onDelete, onChange, onCheckpoint, onSeek }: Props) {
  const drag = useRef<{ pointer: number; x: number; y: number; width: number; blur: Blur; edge: 'start' | 'end' | null; touch: boolean; changed: boolean } | null>(null);
  const moved = useRef(false);
  const touchTap = useRef(false);
  const start = (event: PointerEvent, blur: Blur, edge: 'start' | 'end' | null) => {
    if (event.button !== 0 || drag.current) return;
    const touch = event.pointerType === 'touch';
    touchTap.current = touch;
    if (!touch) { event.preventDefault(); onSelect(blur.id); event.currentTarget.setPointerCapture(event.pointerId); }
    event.stopPropagation();
    const width = event.currentTarget.closest('.blur-track')!.getBoundingClientRect().width;
    moved.current = false; drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, width, blur, edge, touch, changed: false };
  };
  const retime = (blur: Blur, edge: 'start' | 'end' | null, delta: number, record = true, gesture = drag.current) => {
    const minimum = Math.min(.1, duration, blur.end - blur.start), length = blur.end - blur.start;
    const patch = edge === 'start' ? { start: clamp(blur.start + delta, 0, Math.min(blur.end, duration) - minimum) }
      : edge === 'end' ? { end: clamp(blur.end + delta, blur.start + minimum, duration) }
      : (() => {
        const latest = blur.end > duration ? duration - minimum : duration - length;
        const start = clamp(blur.start + delta, 0, Math.max(0, Math.min(latest, maxTime - length))); return { start, end: Math.min(maxTime, start + length) };
      })();
    if (Object.entries(patch).every(([key, value]) => blur[key as keyof Blur] === value) && !gesture?.changed) return;
    if (!record && gesture && !gesture.changed) { onCheckpoint(); gesture.changed = true; }
    onChange(blur.id, patch, record);
    onSeek(edge === 'end' ? Math.min(duration, Math.max(blur.start, (patch as { end: number }).end - .001)) : (patch as { start: number }).start);
  };
  const move = (event: PointerEvent) => {
    const d = drag.current; if (d?.pointer !== event.pointerId) return;
    const dx = event.clientX - d.x, dy = event.clientY - d.y;
    if (!moved.current) {
      if (Math.abs(dx) < (d.touch ? 10 : 3)) return;
      if (d.touch && Math.abs(dy) > Math.abs(dx)) { drag.current = null; return; }
      moved.current = true;
      if (d.touch) { onSelect(d.blur.id); event.currentTarget.setPointerCapture(event.pointerId); }
    }
    event.preventDefault(); retime(d.blur, d.edge, dx / d.width * duration, false, d);
  };
  const end = () => { drag.current = null; };
  return <div className="blur-tracks" aria-label="blur timeline">{blurs.map((blur, index) => {
    const status = blurRangeStatus(blur, duration), outside = status === 'outside', label = blurName(blur, index);
    return <div key={blur.id} className="blur-track">
      <div className="blur-bar" data-selected={selected === blur.id} data-outside={outside} data-clipped={status === 'clipped'} role="button" tabIndex={0} aria-pressed={selected === blur.id} aria-label={`${label}, ${blurTimecode(blur.start)} to ${blurTimecode(blur.end)}${outside ? ', outside video' : status === 'clipped' ? ', past video end' : ''}`}
        style={{ left: outside ? 'auto' : `${blur.start / duration * 100}%`, right: outside ? 0 : undefined, width: outside ? 'auto' : `${(Math.min(blur.end, duration) - blur.start) / duration * 100}%` }}
        onFocus={() => onFocus(blur.id)} onClick={event => { if (!moved.current && (touchTap.current || !(event.target instanceof Element && event.target.closest('.blur-handle')))) onEdit(blur.id); }} onPointerDown={event => start(event, blur, null)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}
        onKeyDown={event => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onEdit(blur.id); onSeek(clamp(blur.start, 0, duration)); }
          if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); event.stopPropagation(); onDelete(); }
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); retime(blur, null, (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 1 : .1)); }
        }}>
        <span>{label}{outside ? ` · outside video → ${blurTimecode(blur.start)}` : status === 'clipped' ? ' · past video end' : ` · ${blurTimecode(blur.start)}–${blurTimecode(blur.end)}`}</span>
        {!outside && (['start', 'end'] as const).map(edge => <div key={edge} className={`blur-handle ${edge}`} role="slider" tabIndex={0} aria-label={`${label} ${edge}`} aria-valuemin={edge === 'start' ? 0 : blur.start} aria-valuemax={edge === 'start' ? Math.min(blur.end, duration) : Math.max(duration, blur.end)} aria-valuenow={blur[edge]} aria-valuetext={blurTimecode(blur[edge])}
          onPointerDown={event => start(event, blur, edge)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}
          onKeyDown={event => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault(); event.stopPropagation(); retime(blur, edge, (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 1 : .1));
          }}><i /></div>)}
      </div>
      <i className="blur-track-playhead" aria-hidden="true" style={{ left: `${clamp(time / duration, 0, 1) * 100}%` }} />
    </div>;
  })}</div>;
}
