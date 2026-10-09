import { useRef } from 'react';
import { Check, Plus, ScanEye, Trash2 } from 'lucide-react';
import type { Blur } from '../types';
import { blurName, blurRangeStatus, blurTimecode, fitBlurRange } from '../blur';
import { Button } from './ui/button';
import { SliderPrimitive } from './ui/slider';
import { Menu, MenuPopup, MenuItem, MenuTrigger } from './ui/menu';

type Props = {
  blurs: Blur[]; visible: Blur[]; selected: string; editing: boolean; duration: number;
  onSelect: (id: string) => void; onDone: () => void; onDelete: () => void;
  onChange: (id: string, patch: Partial<Blur>, record?: boolean) => void; onCheckpoint: () => void;
};

export function AddBlurButton({ onAdd }: { onAdd: () => void }) {
  return <Button size="xs" variant="ghost" aria-label="add blur" title="add blur" onClick={onAdd}><ScanEye /><span className="hidden sm:inline">blur</span><Plus className="hidden size-3! sm:block" /></Button>;
}

export default function BlurControls(p: Props) {
  const gesture = useRef(false);
  const blur = p.editing ? p.blurs.find(item => item.id === p.selected) : undefined;
  const outside = p.blurs.filter(item => blurRangeStatus(item, p.duration) === 'outside');
  const items = blur && !p.visible.some(item => item.id === blur.id) ? [...p.visible, blur] : p.visible;
  if (!p.blurs.length) return null;
  const status = blur && blurRangeStatus(blur, p.duration);
  return <div className="blur-context" aria-label="clip blur effects" role="group">
    <div className="blur-context-row">
      <div className="blur-effect-chips" role="group" aria-label="blurs on selected clip">
        {!items.length && <span className="text-xs text-muted-foreground">no blur on this clip</span>}{items.map(item => {
          const index = p.blurs.findIndex(b => b.id === item.id), label = blurName(item, index);
          return <Button key={item.id} size="xs" variant={blur?.id === item.id ? 'outline' : 'ghost'} className="blur-effect-chip" data-selected={blur?.id === item.id} aria-label={`edit ${label}`} aria-pressed={blur?.id === item.id} title={`${label} · ${blurTimecode(item.start)}–${blurTimecode(item.end)}`} onClick={() => p.onSelect(item.id)}>
            <span className="blur-region-mini" aria-hidden="true"><i style={{ left: `${item.x * 100}%`, top: `${item.y * 100}%`, width: `${item.width * 100}%`, height: `${item.height * 100}%` }} /></span><span>{label}</span>
          </Button>;
        })}
      </div>
      {outside.length > 0 && <Menu><MenuTrigger render={<Button size="xs" variant="ghost" className="text-muted-foreground" />} aria-label="blurs outside video">{outside.length} outside video</MenuTrigger><MenuPopup align="end">{outside.map(item => <MenuItem key={item.id} onClick={() => p.onSelect(item.id)}>{blurName(item, p.blurs.indexOf(item))} · {blurTimecode(item.start)}–{blurTimecode(item.end)}</MenuItem>)}</MenuPopup></Menu>}
      {blur && <div className="blur-edit-actions">
        <div className="blur-strength"><span className="text-xs text-muted-foreground">strength</span>
          <SliderPrimitive.Root className="blur-slider" min={1} max={100} step={1} value={blur.strength}
            onPointerDownCapture={() => { gesture.current = false; }} onKeyDownCapture={() => { gesture.current = false; }}
            onValueChange={value => {
              const strength = Number(value); if (strength === blur.strength) return;
              if (!gesture.current) { p.onCheckpoint(); gesture.current = true; }
              p.onChange(blur.id, { strength }, false);
            }}>
            <SliderPrimitive.Control className="blur-slider-control"><SliderPrimitive.Track className="blur-slider-track"><SliderPrimitive.Indicator className="blur-slider-indicator" /><SliderPrimitive.Thumb className="blur-slider-thumb" aria-label="blur strength" getAriaValueText={(_, value) => `${value}%`} /></SliderPrimitive.Track></SliderPrimitive.Control>
          </SliderPrimitive.Root><span className="w-8 text-xs tabular-nums">{blur.strength}%</span>
        </div>
        <Button size="icon-xs" variant="ghost" aria-label="delete blur" onClick={p.onDelete}><Trash2 /></Button>
        <Button size="xs" variant="outline" aria-label="done editing blur" onClick={p.onDone}><Check />done</Button>
      </div>}
    </div>
    {blur && <div className="blur-context-hint" role="status">
      {status === 'inside' ? <span>resize the box in the preview · drag the range ends below to set timing</span> : <><span>{status === 'outside' ? 'outside video' : 'past video end'} · saved range {blurTimecode(blur.start)}–{blurTimecode(blur.end)}</span><Button size="xs" variant="link" onClick={() => { p.onChange(blur.id, fitBlurRange(blur, p.duration)); p.onSelect(blur.id); }}>fit to video</Button></>}
    </div>}
  </div>;
}
