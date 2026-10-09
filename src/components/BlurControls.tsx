import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { Check, Plus, ScanEye, Timer, Trash2 } from 'lucide-react';
import type { Blur, Edits, Source } from '../types';
import { blurName, blurRangeStatus, blurTimecode, fitBlurRange } from '../blur';
import { Button } from './ui/button';
import { SliderPrimitive } from './ui/slider';
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from './ui/popover';
import { Menu, MenuPopup, MenuItem, MenuTrigger } from './ui/menu';
import BlurAreaPreview from './BlurAreaPreview';

type Props = {
  source: Source; edits: Edits; videoRef: RefObject<HTMLVideoElement | null>; time: number; clipIndex: number;
  visible: Blur[]; selected: string; open: boolean; duration: number;
  onOpenChange: (open: boolean) => void; onSelect: (id: string) => void; onAdd: () => void;
  onDone: () => void; onTiming: () => void; onDelete: () => void;
  onChange: (id: string, patch: Partial<Blur>, record?: boolean) => void; onCheckpoint: () => void;
};

export default function BlurControls(p: Props) {
  const gesture = useRef(false), chips = useRef<HTMLDivElement>(null), blurs = p.edits.blurs;
  const blur = blurs.find(item => item.id === p.selected);
  const outside = blurs.filter(item => blurRangeStatus(item, p.duration) === 'outside');
  const items = blur && !p.visible.some(item => item.id === blur.id) ? [...p.visible, blur] : p.visible;
  const status = blur && blurRangeStatus(blur, p.duration);
  useEffect(() => {
    const row = chips.current, item = row?.querySelector<HTMLElement>('[data-selected=true]');
    if (!row || !item) return;
    const reveal = () => {
      const bounds = row.getBoundingClientRect(), selected = item.getBoundingClientRect();
      if (selected.left < bounds.left + 2) row.scrollLeft -= bounds.left + 2 - selected.left;
      else if (selected.right > bounds.right - 2) row.scrollLeft += selected.right - bounds.right + 2;
    };
    reveal(); const observer = new ResizeObserver(reveal); observer.observe(row);
    return () => observer.disconnect();
  }, [p.selected, p.open]);
  return <Popover open={p.open} onOpenChange={(open, details) => {
    if (!open && details.reason === 'escape-key') p.onDone(); else p.onOpenChange(open);
  }}>
    <PopoverTrigger render={<Button size="xs" variant="ghost" />} aria-label="blur" title="blur areas">
      <ScanEye /><span className="hidden sm:inline">blur</span>{p.visible.length > 0 && <span className="tabular-nums">{p.visible.length}</span>}
    </PopoverTrigger>
    <PopoverPopup side="top" align="start" sideOffset={12} className="blur-popover w-80 max-w-[calc(100vw-2rem)]" data-editor-history>
      <div className="mb-3 flex items-center justify-between"><PopoverTitle className="text-sm">blur · clip {p.clipIndex + 1}</PopoverTitle><Button size="xs" variant="ghost" aria-label="done editing blur" onClick={p.onDone}><Check />done</Button></div>
      <div className="mb-3 flex items-center gap-1">
        <div ref={chips} className="blur-effect-chips" role="group" aria-label="blurs on selected clip">{items.map(item => {
          const label = blurName(item, blurs.indexOf(item));
          return <Button key={item.id} size="xs" variant={blur?.id === item.id ? 'outline' : 'ghost'} className="blur-effect-chip" data-selected={blur?.id === item.id} aria-label={`edit ${label}`} aria-pressed={blur?.id === item.id} title={`${label} · ${blurTimecode(item.start)}–${blurTimecode(item.end)}`} onClick={() => p.onSelect(item.id)}>
            <span className="blur-region-mini" aria-hidden="true"><i style={{ left: `${item.x * 100}%`, top: `${item.y * 100}%`, width: `${item.width * 100}%`, height: `${item.height * 100}%` }} /></span>{label}
          </Button>;
        })}</div>
        <Button size={items.length ? 'icon-xs' : 'xs'} variant="outline" aria-label="add blur" onClick={p.onAdd}><Plus />{!items.length && 'add blur'}</Button>
      </div>
      <BlurAreaPreview source={p.source} edits={p.edits} time={p.time} selected={p.selected} videoRef={p.videoRef} onSelect={p.onSelect} onChange={p.onChange} onCheckpoint={p.onCheckpoint} onDelete={p.onDelete} />
      {blur && <>
        <div className="blur-strength mt-4"><span className="text-xs text-muted-foreground">strength</span>
          <SliderPrimitive.Root className="blur-slider" min={1} max={100} step={1} value={blur.strength}
            onPointerDownCapture={() => { gesture.current = false; }} onKeyDownCapture={() => { gesture.current = false; }}
            onValueChange={value => {
              const strength = Number(value); if (strength === blur.strength) return;
              if (!gesture.current) { p.onCheckpoint(); gesture.current = true; }
              p.onChange(blur.id, { strength }, false);
            }}>
            <SliderPrimitive.Control className="blur-slider-control"><SliderPrimitive.Track className="blur-slider-track"><SliderPrimitive.Indicator className="blur-slider-indicator" /><SliderPrimitive.Thumb className="blur-slider-thumb" aria-label="blur strength" getAriaValueText={(_, value) => `${value}%`} /></SliderPrimitive.Track></SliderPrimitive.Control>
          </SliderPrimitive.Root><span className="w-8 shrink-0 text-xs tabular-nums">{blur.strength}%</span>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2"><Button size="sm" variant="outline" aria-label="edit blur timing" onClick={p.onTiming}><Timer />edit timing</Button><Button size="icon-sm" variant="ghost" aria-label="delete blur" onClick={p.onDelete}><Trash2 /></Button></div>
        {status !== 'inside' && <p className="mt-2 text-xs text-muted-foreground">{status === 'outside' ? 'outside video' : 'past video end'} <Button size="xs" variant="link" onClick={() => { p.onChange(blur.id, fitBlurRange(blur, p.duration)); p.onSelect(blur.id); }}>fit to video</Button></p>}
      </>}
      {outside.length > 0 && <Menu><MenuTrigger render={<Button size="xs" variant="ghost" className="mt-2 text-muted-foreground" />} aria-label="blurs outside video">{outside.length} outside video</MenuTrigger><MenuPopup align="end" data-editor-history>{outside.map(item => <MenuItem key={item.id} onClick={() => p.onSelect(item.id)}>{blurName(item, blurs.indexOf(item))} · {blurTimecode(item.start)}–{blurTimecode(item.end)}</MenuItem>)}</MenuPopup></Menu>}
    </PopoverPopup>
  </Popover>;
}
