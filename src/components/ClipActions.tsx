import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import { Merge, RotateCcw, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { Button } from './ui/button';
import { Field, FieldLabel, FieldDescription, FieldError } from './ui/field';
import { Input } from './ui/input';
import { Slider } from './ui/slider';
import { Separator } from './ui/separator';
import { Popover, PopoverClose, PopoverDescription, PopoverPopup, PopoverTitle, PopoverTrigger } from './ui/popover';
import EditorSelect from './EditorSelect';
import IconButton from './IconButton';
import ZoomArea from './ZoomArea';
import { canMergeClips, clipSpeed, defaultZoom, speedPresets, MIN_SPEED, MAX_SPEED } from '../types';
import type { Clip, Edits, Source } from '../types';

type Props = {
  source: Source; videoRef: RefObject<HTMLVideoElement | null>; edits: Edits; selected: string; open: boolean; onOpenChange: (open: boolean) => void;
  onChange: (patch: Partial<Clip>, record?: boolean) => void; onCheckpoint: () => void;
  onMerge: (index: number) => void; onDelete: () => void;
};
export default function ClipActions(p: Props) {
  const index = p.edits.clips.findIndex(c => c.id === p.selected), clip = p.edits.clips[index];
  const speed = clip ? clipSpeed(clip, p.edits) : 1;
  const [custom, setCustom] = useState(!speedPresets.includes(speed));
  const [draft, setDraft] = useState(String(speed)), [speedError, setSpeedError] = useState('');
  useEffect(() => { setCustom(!speedPresets.includes(speed)); setDraft(String(speed)); setSpeedError(''); }, [p.selected, p.open]);
  if (!clip) return null;
  const zoom = clip.zoom ?? defaultZoom;
  const adjusted = speed !== 1 || zoom.scale !== 1;
  const mergeIndex = canMergeClips(clip, p.edits.clips[index + 1], p.edits) ? index
    : canMergeClips(p.edits.clips[index - 1], clip, p.edits) ? index - 1 : -1;
  const applyCustom = () => {
    const value = Number(draft);
    if (!draft.trim() || !Number.isFinite(value) || value < MIN_SPEED || value > MAX_SPEED) {
      setSpeedError(`Enter a speed from ${MIN_SPEED}× to ${MAX_SPEED}×.`); return;
    }
    setSpeedError('');
    if (value !== speed) p.onChange({ speed: value });
  };
  const reset = () => { setCustom(false); setDraft('1'); setSpeedError(''); p.onChange({ speed: 1, zoom: { ...defaultZoom } }); };
  return <Popover triggerId="clip-actions-trigger" open={p.open} onOpenChange={p.onOpenChange}>
    <PopoverTrigger id="clip-actions-trigger" render={<Button size="sm" variant="ghost" />} aria-label="Clip actions"><SlidersHorizontal /><span className="hidden sm:inline">Clip actions</span></PopoverTrigger>
    <PopoverPopup side="top" align="start" sideOffset={12} className="w-72 max-w-[calc(100vw-2rem)] max-h-(--available-height) [&_[data-slot=popover-viewport]]:max-h-[calc(var(--available-height)-2px)]">
      <div className="mb-4 flex items-center justify-between gap-3"><PopoverTitle className="text-sm">Clip {index + 1}</PopoverTitle><div className="flex items-center gap-1">{adjusted && <IconButton label="Reset clip adjustments" size="icon-sm" onClick={reset}><RotateCcw /></IconButton>}<PopoverClose render={<Button variant="ghost" size="icon-sm" />} aria-label="Close clip actions"><X /></PopoverClose></div></div>
      <PopoverDescription className="sr-only">Adjust this clip’s speed and zoom, or delete it.</PopoverDescription>
      <div className="space-y-5">
        <Field><FieldLabel>Speed</FieldLabel><EditorSelect label="Clip speed" value={custom ? 'custom' : String(speed)} options={[...speedPresets.map(value => ({ value: String(value), label: `${value}×` })), { value: 'custom', label: 'Custom…' }]} onChange={value => {
          setSpeedError(''); setCustom(value === 'custom');
          if (value === 'custom') setDraft(String(speed)); else p.onChange({ speed: Number(value) });
        }} /></Field>
        {custom && <Field invalid={!!speedError}><FieldLabel>Custom speed</FieldLabel><Input type="number" inputMode="decimal" min={MIN_SPEED} max={MAX_SPEED} step="any" aria-label="Custom speed" aria-labelledby="" value={draft} onChange={event => { setDraft(event.target.value); setSpeedError(''); }} onBlur={applyCustom} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); applyCustom(); } }} /><FieldDescription>{MIN_SPEED}×–{MAX_SPEED}× · Enter to apply</FieldDescription>{speedError && <FieldError match role="alert">{speedError}</FieldError>}</Field>}
        <Field><div className="flex w-full items-center justify-between"><FieldLabel>Zoom</FieldLabel><span className="text-xs tabular-nums text-muted-foreground">{Number(zoom.scale.toFixed(2))}×</span></div><Slider min={1} max={4} step={.05} value={zoom.scale} onPointerDown={p.onCheckpoint} onKeyDown={event => { if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(event.key)) p.onCheckpoint(); }} onValueChange={value => p.onChange({ zoom: { ...zoom, scale: Array.isArray(value) ? value[0] : value } }, false)} /></Field>
        {zoom.scale > 1 && <ZoomArea source={p.source} edits={p.edits} clip={clip} videoRef={p.videoRef} onCheckpoint={p.onCheckpoint} onChange={(zoom, record = true) => p.onChange({ zoom }, record)} />}
      </div>
      <Separator className="my-4" />
      <div className="flex flex-col gap-1">
        {mergeIndex >= 0 && <Button variant="ghost" size="sm" className="justify-start" onClick={() => p.onMerge(mergeIndex)}><Merge />Merge with {mergeIndex === index - 1 ? 'previous' : 'next'} clip</Button>}
        <Button variant="ghost" size="sm" className="justify-start text-destructive-foreground" onClick={p.onDelete}><Trash2 />Delete clip</Button>
      </div>
    </PopoverPopup>
  </Popover>;
}
