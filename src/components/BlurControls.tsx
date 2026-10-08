import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { Plus, Redo2, ScanEye, Trash2, Undo2, X } from 'lucide-react';
import type { Blur, Edits, Source } from '../types';
import { clamp, clipDuration, toSourceTime } from '../types';
import { blurName, blurRangeStatus, blurTimecode, fitBlurRange, parseBlurTimecode } from '../blur';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { SliderPrimitive } from './ui/slider';
import { Popover, PopoverClose, PopoverPopup, PopoverTitle, PopoverTrigger } from './ui/popover';
import BlurEditorPreview from './BlurEditorPreview';

type Props = { source: Source; edits: Edits; videoRef: RefObject<HTMLVideoElement | null>; open: boolean; onOpenChange: (open: boolean) => void;
  selected: string; duration: number; time: number; onSelect: (id: string, preview?: boolean) => void; onAdd: () => void;
  onChange: (id: string, patch: Partial<Blur>, record?: boolean) => void; onCheckpoint: () => void; onDelete: () => void; onSeek: (time: number) => void;
  onUndo: () => void; onRedo: () => void; canUndo: boolean; canRedo: boolean };

function BlurSlider({ value, labels, max, step, disabled, onChange, onCheckpoint }: {
  value: number[]; labels: string[]; max: number; step: number; disabled?: boolean;
  onChange: (value: number[], thumb: number) => void; onCheckpoint?: () => void;
}) {
  const changed = useRef(false);
  return <SliderPrimitive.Root className="blur-slider" value={value.length === 1 ? value[0] : value} min={labels[0] === 'blur strength' ? 1 : 0} max={max} step={step} minStepsBetweenValues={value.length > 1 ? 1 : 0} disabled={disabled} thumbAlignment="edge" thumbCollisionBehavior="none"
    onPointerDownCapture={() => { changed.current = false; }} onKeyDownCapture={event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) changed.current = false; }}
    onValueChange={(values, details) => {
      const next = Array.isArray(values) ? values : [values as number];
      if (next.every((number, index) => number === value[index])) return;
      if (!changed.current) { onCheckpoint?.(); changed.current = true; }
      onChange(next, details.activeThumbIndex);
    }}>
    <SliderPrimitive.Control className="blur-slider-control"><SliderPrimitive.Track className="blur-slider-track">
      <SliderPrimitive.Indicator className="blur-slider-indicator" />
      {value.map((_, index) => <SliderPrimitive.Thumb key={index} index={index} className="blur-slider-thumb" getAriaLabel={i => labels[i]} getAriaValueText={(_formatted, number) => labels[0] === 'blur strength' ? `${number}%` : blurTimecode(number)} />)}
    </SliderPrimitive.Track></SliderPrimitive.Control>
  </SliderPrimitive.Root>;
}

function TimeField({ label, value, onCommit }: { label: string; value: number; onCommit: (value: number) => boolean }) {
  const [draft, setDraft] = useState(blurTimecode(value)), [error, setError] = useState(''), [dirty, setDirty] = useState(false);
  useEffect(() => { setDraft(blurTimecode(value)); setError(''); setDirty(false); }, [value]);
  const commit = () => {
    if (!dirty) return;
    const seconds = parseBlurTimecode(draft);
    if (seconds === value) { setDraft(blurTimecode(value)); setError(''); setDirty(false); return; }
    if (seconds === null) { setError('use m:ss, for example 0:05.00.'); return; }
    if (!onCommit(seconds)) { setError(label === 'start' ? 'start must be before end and inside the video.' : 'end must follow start and fit the video or saved range.'); return; }
    setDraft(blurTimecode(seconds)); setError(''); setDirty(false);
  };
  return <label className="space-y-1 text-xs text-muted-foreground">{label}<Input aria-label={`blur ${label}`} aria-invalid={!!error} value={draft} inputMode="decimal" onChange={event => { setDraft(event.target.value); setError(''); setDirty(true); }} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commit(); } if (event.key === 'Escape' && (dirty || error)) { event.preventDefault(); event.stopPropagation(); setDraft(blurTimecode(value)); setError(''); setDirty(false); } }} />
    {error && <span role="status" className="text-destructive-foreground">{error}</span>}
  </label>;
}

function BlurNameField({ blur, label, onChange }: { blur: Blur; label: string; onChange: Props['onChange'] }) {
  const [name, setName] = useState(label);
  useEffect(() => setName(label), [label, blur.id]);
  const commit = () => { const next = name.trim() || label; setName(next); if (next !== label) onChange(blur.id, { name: next }); };
  return <Input aria-label="blur name" value={name} maxLength={80} onChange={event => setName(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commit(); } if (event.key === 'Escape' && name !== label) { event.preventDefault(); event.stopPropagation(); setName(label); } }} />;
}

function BlurSettings({ blur, index, ...p }: Props & { blur: Blur; index: number }) {
  const status = blurRangeStatus(blur, p.duration), outside = status === 'outside';
  const minimum = Math.min(.01, p.duration, blur.end - blur.start), step = Math.min(.01, p.duration / 100);
  const changeRange = (start: number, end: number, record = true) => {
    p.onChange(blur.id, { start, end }, record); p.onSeek(clamp(start, 0, p.duration));
  };
  const location = toSourceTime(p.time, p.edits), clipStart = p.edits.clips.slice(0, location.index).reduce((sum, clip) => sum + clipDuration(clip, p.edits), 0);
  const clipEnd = clipStart + clipDuration(p.edits.clips[location.index], p.edits);
  return <div className="blur-settings space-y-4">
    <div className="flex items-center gap-1.5"><BlurNameField key={blur.id} blur={blur} label={blurName(blur, index)} onChange={p.onChange} /><Button size="icon-sm" variant="ghost" aria-label="delete blur" onClick={p.onDelete}><Trash2 /></Button></div>
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs"><span className="font-medium">duration</span><span className="tabular-nums text-muted-foreground">{blurTimecode(blur.end - blur.start)} long</span></div>
      <BlurSlider labels={['blur range start', 'blur range end']} value={[Math.min(blur.start, p.duration), Math.min(blur.end, p.duration)]} max={p.duration} step={step} disabled={outside} onCheckpoint={p.onCheckpoint} onChange={(values, thumb) => {
        if (values[1] <= values[0]) return;
        p.onChange(blur.id, thumb === 0 ? { start: values[0] } : { end: values[1] }, false);
        p.onSeek(thumb === 0 ? values[0] : Math.max(values[0], values[1] - .001));
      }} />
      <div className="flex justify-between text-[10px] tabular-nums text-muted-foreground"><span>0:00</span><span>{blurTimecode(p.duration)}</span></div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1"><TimeField label="start" value={blur.start} onCommit={start => { if (start < 0 || start >= Math.min(blur.end, p.duration)) return false; changeRange(start, blur.end); return true; }} /><Button size="xs" variant="outline" className="w-full" title={`use preview position ${blurTimecode(p.time)}`} disabled={p.time >= Math.min(blur.end, p.duration)} onClick={() => changeRange(p.time, blur.end)}>start here</Button></div>
        <div className="space-y-1"><TimeField label="end" value={blur.end} onCommit={end => { if (end <= blur.start || end > Math.max(p.duration, blur.end)) return false; p.onChange(blur.id, { end }); p.onSeek(Math.min(end - Math.min(.001, (end - blur.start) / 2), p.duration)); return true; }} /><Button size="xs" variant="outline" className="w-full" title={`use preview position ${blurTimecode(p.time)}`} disabled={p.time <= blur.start} onClick={() => p.onChange(blur.id, { end: Math.max(blur.start + minimum, p.time) })}>end here</Button></div>
      </div>
      <div className="flex flex-wrap gap-1"><Button size="xs" variant="outline" onClick={() => changeRange(0, p.duration)}>whole video</Button><Button size="xs" variant="outline" onClick={() => changeRange(clipStart, clipEnd)}>this clip</Button></div>
    </div>
    {status !== 'inside' && <div className="blur-range-notice" role="status">
      <p>{outside ? 'outside video' : `past video end · visible until ${blurTimecode(p.duration)}`}</p>
      <p className="text-xs text-muted-foreground">{outside ? 'this range starts after the video ends.' : `saved end: ${blurTimecode(blur.end)}. the rest is past the video end.`} the saved range is kept when you trim.</p>
      <Button size="xs" variant="outline" onClick={() => { const range = fitBlurRange(blur, p.duration); changeRange(range.start, range.end); }}>fit to video</Button>
    </div>}
    <div className="space-y-1"><div className="flex justify-between text-xs"><span className="font-medium">strength</span><span className="tabular-nums text-muted-foreground">{blur.strength}%</span></div><BlurSlider labels={['blur strength']} value={[blur.strength]} max={100} step={1} onCheckpoint={p.onCheckpoint} onChange={values => p.onChange(blur.id, { strength: Math.max(1, values[0]) }, false)} /></div>
  </div>;
}

export default function BlurControls(p: Props) {
  const index = p.edits.blurs.findIndex(b => b.id === p.selected), blur = p.edits.blurs[index];
  const list = useRef<HTMLDivElement>(null);
  const listObserver = useRef<ResizeObserver | null>(null);
  const revealSelected = useCallback((element: HTMLDivElement | null) => {
    listObserver.current?.disconnect();
    list.current = element;
    if (!element) return;
    const scroll = () => {
      const selected = element.querySelector<HTMLElement>('[data-selected=true]');
      if (!selected) return;
      const left = selected.offsetLeft, right = left + selected.offsetWidth;
      if (left < element.scrollLeft) element.scrollLeft = left;
      if (right > element.scrollLeft + element.clientWidth) element.scrollLeft = right - element.clientWidth;
    };
    scroll();
    listObserver.current = new ResizeObserver(scroll); listObserver.current.observe(element);
  }, [p.selected]);
  useEffect(() => revealSelected(list.current), [revealSelected, p.open, p.edits.blurs.length]);
  return <Popover open={p.open} onOpenChange={p.onOpenChange}>
    <PopoverTrigger render={<Button size="xs" variant="ghost" />} aria-label="blur video"><ScanEye /><span className="hidden sm:inline">blur</span>{p.edits.blurs.length > 0 && <span className="blur-count">{p.edits.blurs.length}</span>}</PopoverTrigger>
    <PopoverPopup side="top" align="end" sideOffset={12} className="blur-popover w-[56rem] max-w-[calc(100vw-2rem)]" aria-label="blur controls" data-editor-history>
      <div className="blur-editor-header mb-3 flex items-center justify-between gap-2"><PopoverTitle className="text-sm">blur areas</PopoverTitle><div className="flex items-center gap-1">
        <Button size="icon-sm" variant="ghost" aria-label="undo blur edit" disabled={!p.canUndo} onClick={p.onUndo}><Undo2 /></Button><Button size="icon-sm" variant="ghost" aria-label="redo blur edit" disabled={!p.canRedo} onClick={p.onRedo}><Redo2 /></Button>
        {p.edits.blurs.length > 0 && <Button size="xs" variant="outline" aria-label="add blur" title="add blur" onClick={p.onAdd}><Plus /><span className="hidden sm:inline">add blur</span></Button>}<PopoverClose render={<Button size="icon-sm" variant="ghost" />} aria-label="close blur"><X /></PopoverClose></div></div>
      <div className="blur-workspace">
        <div className="blur-preview-pane">
          <BlurEditorPreview source={p.source} edits={p.edits} time={p.time} selected={p.selected} videoRef={p.videoRef} onSelect={id => p.onSelect(id, false)} onChange={p.onChange} onCheckpoint={p.onCheckpoint} onDelete={p.onDelete} />
          <div className="mt-2 space-y-1"><div className="flex items-center justify-between text-[10px] text-muted-foreground"><span>preview position</span><span className="font-mono tabular-nums">{blurTimecode(p.time)} / {blurTimecode(p.duration)}</span></div><BlurSlider labels={['blur preview position']} value={[clamp(p.time, 0, p.duration)]} max={p.duration} step={Math.min(.01, p.duration / 100)} onChange={values => p.onSeek(values[0])} /></div>
          <p className="blur-preview-hint mt-2 text-[11px] text-muted-foreground">drag the rectangle; use corners to resize. times stay fixed when clips change.</p>
        </div>
        {p.edits.blurs.length === 0 ? <div className="blur-empty"><p className="text-sm font-medium">hide an area of your video</p><p className="mt-1 text-xs text-muted-foreground">add a blur, place the rectangle, then choose when it appears.</p><Button size="sm" variant="outline" className="mt-3" onClick={p.onAdd}><Plus />add your first blur</Button></div> : <div className="blur-manager">
          <div ref={revealSelected} className="blur-list" role="group" aria-label="existing blurs">{p.edits.blurs.map((item, i) => {
            const status = blurRangeStatus(item, p.duration);
            return <button key={item.id} type="button" className="blur-list-item" data-selected={item.id === p.selected} aria-pressed={item.id === p.selected} aria-label={`select ${blurName(item, i)}`} aria-describedby={`blur-description-${item.id}`} onClick={() => p.onSelect(item.id)}>
              <span className="blur-region-mini" aria-hidden="true"><i style={{ left: `${item.x * 100}%`, top: `${item.y * 100}%`, width: `${item.width * 100}%`, height: `${item.height * 100}%` }} /></span>
              <span className="min-w-0"><span className="block truncate text-xs font-medium">{blurName(item, i)}</span><span id={`blur-description-${item.id}`} className="block text-[10px] tabular-nums text-muted-foreground"><span className="block whitespace-nowrap">{blurTimecode(item.start)}–{blurTimecode(item.end)}</span>{status !== 'inside' && <span className="block text-warning-foreground">{status === 'outside' ? 'outside video' : 'past video end'}</span>}</span></span>
            </button>;
          })}</div>
          {blur && <BlurSettings key={blur.id} blur={blur} index={index} {...p} />}
        </div>}
      </div>
    </PopoverPopup>
  </Popover>;
}
