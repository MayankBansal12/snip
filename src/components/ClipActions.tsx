import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { Gauge, ZoomIn, X } from 'lucide-react';
import { Button } from './ui/button';
import { Kbd } from './ui/kbd';
import { Input } from './ui/input';
import { Popover, PopoverClose, PopoverPopup, PopoverTitle, PopoverTrigger } from './ui/popover';
import ZoomArea from './ZoomArea';
import { clipSpeed, defaultZoom, speedPresets, zoomPresets, MIN_SPEED, MAX_SPEED } from '../types';
import type { Clip, Edits, Source } from '../types';

type Props = {
  source: Source; videoRef: RefObject<HTMLVideoElement | null>; edits: Edits; selected: string; open: boolean; onOpenChange: (open: boolean) => void;
  onChange: (patch: Partial<Clip>, record?: boolean) => void; onCheckpoint: () => void;
};
export default function ClipActions(p: Props) {
  const index = p.edits.clips.findIndex(c => c.id === p.selected), clip = p.edits.clips[index];
  const [kind, setKind] = useState<'speed' | 'zoom'>('speed');
  const [custom, setCustom] = useState(false), [draft, setDraft] = useState(''), [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const speed = clip ? clipSpeed(clip, p.edits) : 1, zoom = clip?.zoom ?? defaultZoom;
  const value = kind === 'speed' ? speed : zoom.scale, min = kind === 'speed' ? MIN_SPEED : 1, max = MAX_SPEED;
  useEffect(() => { setCustom(false); setError(''); }, [p.selected, p.open, kind]);
  useEffect(() => { if (custom) { input.current?.focus(); input.current?.select(); } }, [custom]);
  if (!clip) return null;
  const change = (next: number) => p.onChange(kind === 'speed' ? { speed: next } : { zoom: { ...zoom, scale: next } });
  const apply = () => {
    const next = Number(draft);
    if (!draft.trim() || !Number.isFinite(next) || next < min || next > max) { setError(`enter a value from ${min}× to ${max}×`); input.current?.focus(); return; }
    if (next !== value) change(next);
    setCustom(false); setError('');
  };
  return <>
    {(['speed', 'zoom'] as const).map(mode => <Popover key={mode} open={p.open && kind === mode} onOpenChange={open => { setKind(mode); p.onOpenChange(open); }}>
      <PopoverTrigger render={<Button size="xs" variant="ghost" />} aria-label={`${mode} ${mode === 'speed' ? speed : zoom.scale}×`}>
        {mode === 'speed' ? <Gauge /> : <ZoomIn />}<span>{mode} <span className="tabular-nums">{mode === 'speed' ? speed : zoom.scale}×</span></span><Kbd aria-hidden="true" className="hidden sm:inline-flex">{mode === 'speed' ? 'x' : 'z'}</Kbd>
      </PopoverTrigger>
      <PopoverPopup onKeyDown={event => {
        if (event.target instanceof Element && event.target.closest('input,textarea') || event.ctrlKey || event.metaKey || event.altKey) return;
        if (event.key.toLowerCase() !== (mode === 'speed' ? 'x' : 'z')) return;
        event.preventDefault(); event.stopPropagation();
        const presets = mode === 'speed' ? speedPresets : zoomPresets;
        change((event.shiftKey ? [...presets].reverse().find(p => p < value) : presets.find(p => p > value)) ?? (event.shiftKey ? presets[presets.length - 1] : presets[0]));
      }} side="top" align="start" sideOffset={12} className="w-80 max-w-[calc(100vw-2rem)]">
        <div className="mb-4 flex items-center justify-between"><PopoverTitle className="text-sm">{mode} · clip {index + 1}</PopoverTitle><PopoverClose render={<Button variant="ghost" size="icon-sm" />} aria-label={`close ${mode}`}><X /></PopoverClose></div>
        <div className="grid grid-cols-5 gap-1">{(mode === 'speed' ? speedPresets : zoomPresets).map(preset => <Button key={preset} size="sm" variant={value === preset ? 'secondary' : 'ghost'} aria-pressed={value === preset} onClick={() => { change(preset); setCustom(false); }}>{preset}×</Button>)}</div>
        {!custom ? <Button className="mt-3 w-full" size="sm" variant="outline" onClick={() => { setDraft(String(value)); setCustom(true); }}>custom {mode}…</Button> : <form noValidate className="mt-3 space-y-2" onSubmit={event => { event.preventDefault(); apply(); }}>
          <label htmlFor={`custom-${mode}`} className="text-xs">custom {mode} ({min}×–{max}×)</label>
          <div className="flex gap-2"><Input ref={input} id={`custom-${mode}`} type="number" inputMode="decimal" min={min} max={max} step="any" value={draft} aria-invalid={!!error} aria-describedby={error ? `error-${mode}` : undefined} onChange={event => { setDraft(event.target.value); setError(''); }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setCustom(false); } }} /><Button type="submit" size="sm">apply</Button><Button type="button" size="sm" variant="ghost" onClick={() => setCustom(false)}>cancel</Button></div>
          {error && <p id={`error-${mode}`} role="alert" className="text-xs text-destructive-foreground">{error}</p>}
        </form>}
        {mode === 'zoom' && <div className="mt-4"><ZoomArea source={p.source} edits={p.edits} clip={clip} videoRef={p.videoRef} onCheckpoint={p.onCheckpoint} onChange={(zoom, record = true) => p.onChange({ zoom }, record)} /></div>}
        <p className="mt-3 text-xs text-muted-foreground"><Kbd>{mode === 'speed' ? 'x' : 'z'}</Kbd> cycles presets · <Kbd>shift</Kbd> reverses</p>
      </PopoverPopup>
    </Popover>)}
  </>;
}
