import { useRef } from 'react';
import type { PointerEvent } from 'react';
import type { Blur } from '../types';
import { blurActive, blurName, blurRadius } from '../blur';
import { moveCrop, resizeCrop } from '../crop';

type Props = { blurs: Blur[]; time: number; width: number; height: number; editing: boolean; selected: string;
  onSelect: (id: string) => void; onChange: (id: string, patch: Partial<Blur>, record?: boolean) => void; onCheckpoint: () => void; onDelete: () => void };

export default function BlurArea({ blurs, time, width, height, editing, selected, onSelect, onChange, onCheckpoint, onDelete }: Props) {
  const drag = useRef<{ pointer: number; x: number; y: number; width: number; height: number; blur: Blur; corner: string | null; changed: boolean } | null>(null);
  const start = (event: PointerEvent, blur: Blur, corner: string | null) => {
    if (event.button !== 0 || drag.current) return;
    event.preventDefault(); event.stopPropagation(); onSelect(blur.id);
    drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, width, height, blur, corner, changed: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent) => {
    const d = drag.current; if (!d || d.pointer !== event.pointerId) return;
    const dx = (event.clientX - d.x) / d.width, dy = (event.clientY - d.y) / d.height;
    if (!d.changed && Math.hypot(event.clientX - d.x, event.clientY - d.y) < 3) return;
    const patch = d.corner ? resizeCrop(d.blur, d.corner, dx, dy, null, width / height) : moveCrop(d.blur, dx, dy);
    if (!d.changed) {
      if (Object.entries(patch).every(([key, value]) => d.blur[key as keyof Blur] === value)) return;
      onCheckpoint(); d.changed = true;
    }
    onChange(d.blur.id, patch, false);
  };
  const end = () => { drag.current = null; };
  return <>
    <BlurEffects blurs={blurs} time={time} width={width} height={height} />
    {editing && <div className="blur-selections">{blurs.map((blur,index)=>({blur,index})).sort((a,b)=>Number(a.blur.id===selected)-Number(b.blur.id===selected)).map(({blur,index}) => (blurActive(blur, time) || selected === blur.id) && <div key={blur.id} className="blur-selection" data-selected={selected === blur.id} data-inactive={!blurActive(blur, time)} style={{ left: `${blur.x * 100}%`, top: `${blur.y * 100}%`, width: `${blur.width * 100}%`, height: `${blur.height * 100}%` }} role="group" tabIndex={0} aria-label={`${blurName(blur, index)} area`}
      onFocus={() => onSelect(blur.id)} onPointerDown={event => start(event, blur, null)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); event.stopPropagation(); onDelete(); }
        if (!event.key.startsWith('Arrow')) return;
        event.preventDefault(); event.stopPropagation(); const step = event.shiftKey ? .05 : .01;
        onChange(blur.id, moveCrop(blur, event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0, event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0));
      }}>
      {selected === blur.id && <span className="blur-label">{blurName(blur, index)}{!blurActive(blur, time) && ' · hidden now'}</span>}
      {selected === blur.id && ['nw', 'ne', 'sw', 'se'].map(corner => <button key={corner} type="button" className={`crop-corner ${corner}`} aria-label={`resize ${blurName(blur, index)} ${corner}`}
        onPointerDown={event => start(event, blur, corner)} onKeyDown={event => {
          if (!event.key.startsWith('Arrow')) return;
          event.preventDefault(); event.stopPropagation(); const step = event.shiftKey ? .05 : .01;
          onChange(blur.id, resizeCrop(blur, corner, event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0, event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0, null, width / height));
        }} />)}
    </div>)}</div>}
  </>;
}

export function BlurEffects({ blurs, time, width, height }: Pick<Props, 'blurs' | 'time' | 'width' | 'height'>) {
  return blurs.filter(blur => blurActive(blur, time)).map(blur => <div key={blur.id} className="blur-window" aria-hidden="true" style={{ left: `${blur.x * 100}%`, top: `${blur.y * 100}%`, width: `${blur.width * 100}%`, height: `${blur.height * 100}%`, backdropFilter: `blur(${blurRadius(blur, width, height)}px)` }} />);
}
