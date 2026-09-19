import { ArrowUpRight, Check, MousePointer2, PenLine, RectangleHorizontal, RotateCcw, Trash2, Type } from 'lucide-react';
import { useRef } from 'react';
import { canvasSize, cropPixels, fullCrop, outputSize, placement, ratios, uid } from '../types';
import type { Annotation, Edits, Source, Tool } from '../types';
import { filters } from '../effects';
import type { DrawMode } from './Preview';
import EditorSelect from './EditorSelect';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Field, FieldLabel, FieldDescription } from './ui/field';
import { Input } from './ui/input';
import { Slider } from './ui/slider';
import { Switch } from './ui/switch';
import { Separator } from './ui/separator';
import { Textarea } from './ui/textarea';
import { Tabs, TabsList, TabsTab } from './ui/tabs';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from './ui/empty';

type Props = { hidden: boolean; onClose: () => void; source: Source; edits: Edits; tool: Tool; selectedAnnotation: string | null; drawMode: DrawMode; drawColor: string; thumbnail?: string; onUpdate: (patch: Partial<Edits>, record?: boolean) => void; onCheckpoint: () => void; onAnnotation: (id: string | null) => void; onDrawMode: (mode: DrawMode) => void; onDrawColor: (color: string) => void };
const names: Record<Tool, string> = { canvas: 'Frame', crop: 'Crop', filters: 'Filters', annotate: 'Annotate', speed: 'Speed' };
const intros: Record<Tool, string> = { canvas: 'Make room for your story.', crop: 'Bring the details into focus.', filters: 'Find the right atmosphere.', annotate: 'Point out what matters.', speed: 'Set your own pace.' };
const filterCSS: Record<string, string> = { Original: 'none', Mono: 'grayscale(1)', Warm: 'sepia(.3) saturate(1.2)', Cool: 'saturate(.8) hue-rotate(12deg)', Soft: 'contrast(.85) brightness(1.1)', Vivid: 'saturate(1.4) contrast(1.1)' };
const presets = [{ name: 'Original', ratio: null, label: 'Original' }, { name: '16:9', ratio: 16/9, label: 'Landscape' }, { name: '9:16', ratio: 9/16, label: 'Portrait' }, { name: '1:1', ratio: 1, label: 'Square' }, { name: '4:5', ratio: 4/5, label: 'Social' }, { name: '4:3', ratio: 4/3, label: 'Classic' }, { name: '21:9', ratio: 21/9, label: 'Wide' }, { name: 'Custom', ratio: null, label: 'Custom' }];

function PropertySlider({ label, value, min, max, onChange, onCheckpoint, suffix = '' }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void; onCheckpoint: () => void; suffix?: string }) {
  const changing = useRef(false);
  return <Field className="gap-4">
    <div className="flex w-full items-center justify-between"><FieldLabel>{label}</FieldLabel><Badge variant="outline" className="font-mono tabular-nums">{value}{suffix}</Badge></div>
    <Slider aria-label={label} value={value} min={min} max={max}
      onValueChange={next => { if (!changing.current) { onCheckpoint(); changing.current = true; } onChange(Array.isArray(next) ? next[0] : next); }}
      onValueCommitted={() => { changing.current = false; }} />
  </Field>;
}

export default function ToolPanel(p: Props) {
  const { source, edits, tool, onUpdate } = p;
  const custom = { width: edits.canvas.customWidth || 16, height: edits.canvas.customHeight || 9 };
  const annotation = edits.annotations.find(a => a.id === p.selectedAnnotation);
  const pixels = cropPixels(source, edits.crop), canvas = canvasSize(source, edits), output = outputSize(source, edits);
  const placed = placement(source, edits, canvas);
  const backgroundVisible = placed.width < canvas.width - 2 || placed.height < canvas.height - 2;
  const editAnnotation = (patch: Partial<Annotation>, record = true) => { if (annotation) onUpdate({ annotations: edits.annotations.map(a => a.id === annotation.id ? { ...a, ...patch } : a) }, record); };
  const addText = () => { const a: Annotation = { id: uid(), type: 'text', text: 'Your text', x: .5, y: .78, width: 0, height: 0, color: p.drawColor, size: .065 }; onUpdate({ annotations: [...edits.annotations, a] }); p.onAnnotation(a.id); p.onDrawMode('select'); };
  const chooseCrop = (aspect: string) => {
    if (aspect === 'Original') { onUpdate({ cropAspect: aspect, crop: { ...fullCrop } }); return; }
    if (aspect === 'Free') { onUpdate({ cropAspect: aspect }); return; }
    const r = ratios[aspect] / (source.width / source.height), width = Math.min(1,r), height = Math.min(1,1/r);
    onUpdate({ cropAspect: aspect, crop: { x: (1-width)/2, y: (1-height)/2, width, height } });
  };
  return <aside id="tool-settings" hidden={p.hidden} className="inspector flex flex-col gap-6" aria-label={`${names[tool]} settings`}>
    <div><div className="flex w-full items-center justify-between"><h2 className="text-base font-semibold">{names[tool]}</h2><Button className="min-[901px]:hidden" size="sm" variant="ghost" onClick={p.onClose} aria-label={`Close ${names[tool]} settings`}><Check />Done</Button></div><p className="mt-1 text-sm text-muted-foreground">{intros[tool]}</p></div>
    {tool === 'canvas' && <>
      <Field><FieldLabel>Aspect ratio</FieldLabel><EditorSelect label="Canvas aspect ratio" value={edits.canvas.aspect} options={presets.map(item => ({ value: item.name, label: `${item.label}${item.ratio ? ` · ${item.name}` : ''}` }))} onChange={aspect => { const preset = presets.find(item => item.name === aspect)!; onUpdate({ canvas: { ...edits.canvas, aspect, ratio: aspect === 'Custom' ? Math.max(.2,Math.min(5,custom.width/custom.height)) : preset.ratio }, resolution: 'original' }); }} /></Field>
      {edits.canvas.aspect === 'Custom' && <div className="grid grid-cols-2 gap-3">{(['width','height'] as const).map(key => <Field key={key}><FieldLabel>{key === 'width' ? 'Width' : 'Height'}</FieldLabel><Input aria-labelledby="" type="number" aria-label={`Canvas ratio ${key}`} min={1} max={8192} value={custom[key]} onChange={e => { const next = { ...custom, [key]: Math.max(1,Math.min(8192,Number(e.target.value)||1)) }, ratio = next.width/next.height; onUpdate({ canvas: { ...edits.canvas, customWidth: next.width, customHeight: next.height, ...(ratio >= .2 && ratio <= 5 ? { ratio } : {}) }, resolution: 'original' }); }} /></Field>)}<p className="col-span-2 text-xs text-muted-foreground">Ratio from 1:5 to 5:1</p></div>}
      <Field><FieldLabel>Video in frame</FieldLabel><Tabs className="w-full" value={edits.canvas.fit} onValueChange={fit => onUpdate({ canvas: { ...edits.canvas, fit: fit as 'fit' | 'fill' } })}><TabsList className="w-full"><TabsTab value="fit">Fit whole video</TabsTab><TabsTab value="fill">Fill frame</TabsTab></TabsList></Tabs></Field>
      <Separator />
      {edits.canvas.fit === 'fit' && <>
        <PropertySlider label="Inset" value={edits.canvas.inset} min={0} max={20} suffix="%" onCheckpoint={p.onCheckpoint} onChange={inset => onUpdate({ canvas: { ...edits.canvas, inset } },false)} />
        <Field><FieldLabel>Background</FieldLabel><div className="flex items-center gap-2">{['#171717','#ffffff','#e5e5e5','#c4d4df'].map(color => <Button key={color} size="icon" variant={edits.canvas.background === color ? 'secondary' : 'outline'} aria-label={`Background ${color}`} aria-pressed={edits.canvas.background === color} onClick={() => onUpdate({ canvas: { ...edits.canvas, background: color } })}><span className="size-4 rounded-sm border border-black/15" style={{ background: color }} /></Button>)}<Input aria-labelledby="" type="color" aria-label="Custom background color" value={edits.canvas.background} className="w-12 p-1" onChange={e => onUpdate({ canvas: { ...edits.canvas, background: e.target.value } })} /></div>{!backgroundVisible && <FieldDescription>Add an inset or change the ratio to reveal the background.</FieldDescription>}</Field>
        <Separator />
      </>}
      <Field><FieldLabel>Resolution</FieldLabel><EditorSelect label="Edit resolution" value={edits.resolution} options={[{ value: 'original', label: 'Original resolution' }, ...[2160,1440,1080,720,480,360].filter(n => n < Math.min(canvas.width,canvas.height)).map(n => ({ value: String(n), label: `${n}p` }))]} onChange={resolution => onUpdate({ resolution })} /><FieldDescription>{output.width} × {output.height} px</FieldDescription></Field>
    </>}
    {tool === 'crop' && <>
      <Field><FieldLabel>Crop ratio</FieldLabel><EditorSelect label="Crop ratio" value={edits.cropAspect} options={['Free','Original','1:1','16:9','9:16','4:3'].map(value => ({ value, label: value }))} onChange={chooseCrop} /></Field>
      <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">Selection</span><Badge variant="outline">{pixels.width} × {pixels.height}</Badge></div>
      <Separator /><p className="text-sm leading-relaxed text-muted-foreground">Drag the corners to resize. Drag inside the selection to reposition it.</p>
      <Button variant="outline" onClick={() => onUpdate({ crop: { ...fullCrop }, cropAspect: 'Free' })}><RotateCcw />Reset crop</Button>
    </>}
    {tool === 'filters' && <>
      <div className="filter-options grid grid-cols-2 gap-3">{filters.map(filter => <div key={filter} className="flex flex-col gap-2">{p.thumbnail && <img src={p.thumbnail} alt="" className="aspect-video w-full rounded-lg object-cover" style={{ filter: filterCSS[filter] }} />}<Button variant={edits.filter === filter ? 'secondary' : 'outline'} aria-pressed={edits.filter === filter} onClick={() => onUpdate({ filter })}>{edits.filter === filter && <Check />}{filter}</Button></div>)}</div>
      <Separator />
      <PropertySlider label="Intensity" value={edits.intensity} min={0} max={100} suffix="%" onCheckpoint={p.onCheckpoint} onChange={intensity => onUpdate({ intensity },false)} />
      <PropertySlider label="Brightness" value={edits.brightness} min={-30} max={30} onCheckpoint={p.onCheckpoint} onChange={brightness => onUpdate({ brightness },false)} />
      <PropertySlider label="Contrast" value={edits.contrast} min={-30} max={30} onCheckpoint={p.onCheckpoint} onChange={contrast => onUpdate({ contrast },false)} />
      <Button variant="outline" onClick={() => onUpdate({ filter: 'Original', intensity: 100, brightness: 0, contrast: 0 })}><RotateCcw />Reset filters</Button>
    </>}
    {tool === 'annotate' && <>
      <div className="flex items-center justify-between gap-2"><ToggleGroup aria-label="Annotation tools" value={[p.drawMode]} onValueChange={values => { if (values[0]) { p.onDrawMode(values[0] as DrawMode); if (values[0] !== 'select') p.onAnnotation(null); } }} variant="outline"><ToggleGroupItem value="select" aria-label="Select annotations"><MousePointer2 /></ToggleGroupItem>{([{ mode: 'arrow', icon: ArrowUpRight, label: 'Draw arrow' }, { mode: 'rectangle', icon: RectangleHorizontal, label: 'Draw rectangle' }, { mode: 'pen', icon: PenLine, label: 'Draw freehand' }] as const).map(({ mode, icon: Icon, label }) => <ToggleGroupItem key={mode} value={mode} aria-label={label}><Icon /></ToggleGroupItem>)}</ToggleGroup><Button size="icon" variant="outline" aria-label="Add text" onClick={addText}><Type /></Button></div>
      <Field><FieldLabel>Color</FieldLabel><div className="flex flex-wrap gap-2">{['#ffffff','#1a1d18','#e8e76a','#f599a7','#9bc772','#8eb8fa'].map(color => <Button key={color} size="icon-sm" variant={(annotation?.color||p.drawColor) === color ? 'secondary' : 'outline'} aria-label={`Annotation color ${color}`} aria-pressed={(annotation?.color||p.drawColor) === color} onClick={() => { p.onDrawColor(color); editAnnotation({ color }); }}><span className="size-4 rounded-sm border border-black/15" style={{ background: color }} /></Button>)}</div></Field>
      {annotation?.type === 'text' && <Field><FieldLabel>Text</FieldLabel><Textarea aria-labelledby="" aria-label="Annotation text" value={annotation.text} rows={3} maxLength={200} onFocus={p.onCheckpoint} onChange={e => editAnnotation({ text: e.target.value },false)} /></Field>}
      {annotation && <PropertySlider label={annotation.type === 'text' ? 'Text size' : 'Stroke width'} value={Math.round(annotation.size*1000)} min={annotation.type === 'text' ? 20 : 2} max={annotation.type === 'text' ? 160 : 20} onCheckpoint={p.onCheckpoint} onChange={v => editAnnotation({ size: v/1000 },false)} />}
      <Separator />
      {edits.annotations.length ? <div className="flex flex-col gap-3"><div className="flex items-center justify-between text-sm font-medium">On your video<Badge variant="secondary">{edits.annotations.length}</Badge></div><div className="annotation-list flex flex-col gap-1">{edits.annotations.map((a,i) => <Button key={a.id} variant={p.selectedAnnotation === a.id ? 'secondary' : 'ghost'} className="justify-start" onClick={() => { p.onAnnotation(a.id); p.onDrawMode('select'); }}><span className="size-2 shrink-0 rounded-full border" style={{ background: a.color }} /><span className="truncate">{a.type === 'text' ? a.text || 'Empty text' : `${a.type === 'pen' ? 'Drawing' : a.type[0].toUpperCase()+a.type.slice(1)} ${i+1}`}</span></Button>)}</div></div> : <Empty className="px-0 py-4 md:py-4"><EmptyHeader><EmptyMedia variant="icon"><PenLine /></EmptyMedia><EmptyTitle>No annotations yet</EmptyTitle><EmptyDescription>Add text or draw on the preview.</EmptyDescription></EmptyHeader></Empty>}
      {annotation && <Button variant="destructive-outline" onClick={() => { onUpdate({ annotations: edits.annotations.filter(a => a.id !== annotation.id) }); p.onAnnotation(null); }}><Trash2 />Delete annotation</Button>}
      <p className="text-xs leading-relaxed text-muted-foreground">Annotations stay visible throughout the video. Select one to move or edit it.</p>
    </>}
    {tool === 'speed' && <>
      <Field><FieldLabel>Playback speed</FieldLabel><EditorSelect label="Video speed" value={String(edits.speed)} options={[.25,.5,.75,1,1.25,1.5,2,3,4].map(speed => ({ value: String(speed), label: `${speed}×${speed === 1 ? ' · Normal' : ''}` }))} onChange={value => onUpdate({ speed: Number(value) })} /><FieldDescription>Applies to every clip. Audio follows along and keeps its pitch.</FieldDescription></Field>
      <Separator /><Field><div className="flex w-full items-center justify-between"><FieldLabel>Keep audio</FieldLabel><Switch aria-label="Keep audio" checked={!edits.muted} onCheckedChange={checked => onUpdate({ muted: !checked })} /></div><FieldDescription>Include the original sound in your export.</FieldDescription></Field>
    </>}
  </aside>;
}
