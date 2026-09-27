import { useEffect, useRef, useState } from 'react';
import type { PointerEvent, RefObject } from 'react';
import { Crop as CropIcon, Scaling, RotateCcw } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog, DialogPopup, DialogHeader, DialogTitle, DialogDescription, DialogPanel, DialogFooter } from './ui/dialog';
import EditorSelect from './EditorSelect';
import { canvasSize, cropPixels, fullCrop, placement, ratios } from '../types';
import type { Crop, Edits, Source } from '../types';
import { cropForRatio, moveCrop, resizeCrop } from '../crop';

type Props = { source: Source; edits: Edits; videoRef: RefObject<HTMLVideoElement | null>; onUpdate: (patch: Partial<Edits>) => void; onPause: () => void };

export default function CanvasControls({ source, edits, videoRef, onUpdate, onPause }: Props) {
  const [open, setOpen] = useState<'crop' | 'dimensions' | null>(null);
  const [crop, setCrop] = useState<Crop>(edits.crop), [aspect, setAspect] = useState(edits.cropAspect);
  const [canvas, setCanvas] = useState(edits.canvas);
  const [width, setWidth] = useState(''), [height, setHeight] = useState('');
  const image = useRef<HTMLCanvasElement>(null), surface = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointer: number; x: number; y: number; width: number; height: number; crop: Crop; corner: string | null } | null>(null);
  const sourceRatio = source.width / source.height;
  const cropRatio = aspect === 'Free' ? null : aspect === 'Original' ? sourceRatio : ratios[aspect];
  const output = canvasSize(source, edits);
  const customWidth = Number(width), customHeight = Number(height);
  const valid = [customWidth, customHeight].every(n => Number.isInteger(n) && n >= 2 && n <= 8192 && n % 2 === 0);
  const draftCanvas = canvas.aspect === 'Custom' ? { ...canvas, ratio: null, outputWidth: customWidth, outputHeight: customHeight } : canvas;
  const draftSize = canvas.aspect === 'Custom' && !valid ? null : canvasSize(source, { ...edits, canvas: draftCanvas });
  const draftPlacement = draftSize ? placement(source, { ...edits, canvas: draftCanvas }, draftSize) : null;
  const showBackground = canvas.fit === 'fit' && draftSize && draftPlacement &&
    (draftPlacement.width < draftSize.width || draftPlacement.height < draftSize.height);
  const show = (kind: 'crop' | 'dimensions') => {
    onPause(); setCrop({ ...edits.crop }); setAspect(edits.cropAspect); setCanvas({ ...edits.canvas });
    setWidth(String(output.width)); setHeight(String(output.height)); setOpen(kind);
  };
  useEffect(() => {
    if (open !== 'crop') return;
    // Dialog contents mount after the open state changes.
    const draw = () => {
      const target = image.current, video = videoRef.current;
      if (!target || !video || video.readyState < 2) return;
      target.width = Math.min(960, source.width); target.height = Math.round(target.width / sourceRatio);
      target.getContext('2d')?.drawImage(video, 0, 0, target.width, target.height);
    };
    const frame = requestAnimationFrame(draw);
    const video = videoRef.current; video?.addEventListener('seeked', draw);
    return () => { cancelAnimationFrame(frame); video?.removeEventListener('seeked', draw); drag.current = null; };
  }, [open, source, sourceRatio, videoRef]);
  const start = (event: PointerEvent, corner: string | null) => {
    if (event.button !== 0 || drag.current || !surface.current) return;
    event.preventDefault(); event.stopPropagation();
    const rect = surface.current.getBoundingClientRect();
    drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, width: rect.width, height: rect.height, crop, corner };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent) => {
    const d = drag.current; if (!d || event.pointerId !== d.pointer) return;
    const dx = (event.clientX - d.x) / d.width, dy = (event.clientY - d.y) / d.height;
    setCrop(d.corner ? resizeCrop(d.crop, d.corner, dx, dy, cropRatio, sourceRatio) : moveCrop(d.crop, dx, dy));
  };
  const end = () => { drag.current = null; };
  const pixels = cropPixels(source, crop);
  const canResetCrop = crop.x > 1e-7 || crop.y > 1e-7 || crop.width < 1 - 1e-7 || crop.height < 1 - 1e-7;
  const changedCrop = JSON.stringify(crop) !== JSON.stringify(edits.crop) || aspect !== edits.cropAspect;
  return <>
    <div className="viewer-tools flex shrink-0 items-center gap-1">
      <Button size="xs" variant="ghost" className="max-sm:px-1" onClick={() => show('crop')} aria-label="crop video"><CropIcon /><span className="hidden sm:inline">crop</span></Button>
      <Button size="xs" variant="ghost" className="max-sm:px-1" onClick={() => show('dimensions')} aria-label="video dimensions"><Scaling /><span className="hidden sm:inline">dimensions</span><span className="ml-1 hidden font-mono text-[10px] text-muted-foreground sm:inline">{output.width} × {output.height}</span></Button>
    </div>
    <Dialog open={open !== null} onOpenChange={value => { if (!value) setOpen(null); }}>
      <DialogPopup className={open === 'crop' ? 'sm:max-w-2xl' : undefined} closeProps={{ 'aria-label': 'close video settings' }}>
        <DialogHeader><DialogTitle>{open === 'crop' ? 'crop video' : 'video dimensions'}</DialogTitle><DialogDescription>{open === 'crop' ? 'choose what stays in the frame. applies to every clip.' : 'set the shape and size of your video. applies to every clip.'}</DialogDescription></DialogHeader>
        <DialogPanel>
          {open === 'crop' ? <div className="space-y-4">
            <EditorSelect label="crop aspect ratio" value={aspect} options={['Free', 'Original', ...Object.keys(ratios)].map(value => ({ value, label: value === 'Free' ? 'freeform' : value.toLowerCase() }))} onChange={value => { setAspect(value); if(value !== 'Free') setCrop(cropForRatio(sourceRatio, value === 'Original' ? sourceRatio : ratios[value])); }} />
            <div className="crop-surface" ref={surface} style={{ aspectRatio: sourceRatio, width: `min(100%, ${45 * sourceRatio}svh)` }}>
              <canvas ref={image} aria-hidden="true" />
              <div className="crop-selection" style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` }} role="group" tabIndex={0} aria-label="crop area" aria-describedby="crop-help"
                onPointerDown={event => start(event, null)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}
                onKeyDown={event => {
                  if(event.target !== event.currentTarget || !event.key.startsWith('Arrow')) return;
                  event.preventDefault(); event.stopPropagation(); const step = event.shiftKey ? .05 : .01;
                  setCrop(moveCrop(crop, event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0, event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0));
                }}>
                <span className="crop-grid" aria-hidden="true" />
                {(['nw','ne','sw','se'] as const).map(corner => <button key={corner} type="button" className={`crop-corner ${corner}`} aria-label={`resize crop ${corner}`} onPointerDown={event => start(event, corner)} onKeyDown={event => {
                  if(!event.key.startsWith('Arrow')) return; event.preventDefault(); event.stopPropagation(); const step = event.shiftKey ? .05 : .01;
                  setCrop(resizeCrop(crop, corner, event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0, event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0, cropRatio, sourceRatio));
                }} />)}
              </div>
            </div>
            <div className="flex items-center justify-between gap-2"><p id="crop-help" className="text-xs text-muted-foreground">drag to move; use corners to resize.<span className="sr-only"> arrow keys move the focused area or corner. shift moves faster.</span></p><span className="shrink-0 font-mono text-xs text-muted-foreground">{pixels.width} × {pixels.height}</span></div>
          </div> : <div className="space-y-4">
            <div className="space-y-2"><div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"><span className="text-xs font-medium">aspect ratio</span>{draftSize && <span className="font-mono text-xs text-muted-foreground" aria-live="polite">{draftSize.width} × {draftSize.height} px</span>}</div><EditorSelect label="video aspect ratio" value={canvas.aspect} options={['Original', ...Object.keys(ratios), 'Custom'].map(value => ({value, label:value === 'Original' ? 'original · follow crop' : value === 'Custom' ? 'custom size' : value}))} onChange={value => setCanvas({ ...canvas, aspect: value, ratio: value === 'Original' ? null : value === 'Custom' ? canvas.ratio : ratios[value], outputWidth: undefined, outputHeight: undefined })} /></div>
            {canvas.aspect === 'Custom' && <><div className="grid grid-cols-2 gap-3">
              <label className="space-y-2 text-xs font-medium">width (px)<Input aria-label="video width" type="number" min={2} max={8192} step={2} value={width} aria-invalid={!valid} onChange={event => setWidth(event.target.value)} /></label>
              <label className="space-y-2 text-xs font-medium">height (px)<Input aria-label="video height" type="number" min={2} max={8192} step={2} value={height} aria-invalid={!valid} onChange={event => setHeight(event.target.value)} /></label>
            </div><p className={`text-xs ${valid ? 'text-muted-foreground' : 'text-destructive-foreground'}`} role={valid ? undefined : 'status'}>use even numbers from 2 to 8192 pixels.</p></>}
            <div className="space-y-2"><label className="text-xs font-medium">framing</label><EditorSelect label="video framing" value={canvas.fit} options={[{value:'fit',label:'fit · show the whole crop'},{value:'fill',label:'fill · cover the frame'}]} onChange={fit => setCanvas({...canvas,fit:fit as 'fit'|'fill'})} /></div>
            {showBackground && <label className="flex items-center justify-between text-xs font-medium">background<input type="color" aria-label="video background" value={canvas.background} onChange={event => setCanvas({...canvas,background:event.target.value})} className="h-8 w-10 cursor-pointer rounded border bg-transparent p-1" /></label>}
          </div>}
        </DialogPanel>
        <DialogFooter className={open === 'crop' ? 'flex-row justify-end' : undefined}>{open === 'crop' && canResetCrop && <Button variant="ghost" onClick={() => { setCrop({ ...fullCrop }); setAspect('Free'); }}><RotateCcw />reset crop</Button>}<Button disabled={open === 'dimensions' && canvas.aspect === 'Custom' && !valid} onClick={() => {
          if(open === 'crop') { if(changedCrop) onUpdate({crop,cropAspect:aspect}); }
          else {
            const next = canvas.aspect === 'Custom' ? {...canvas, ratio:null, outputWidth:customWidth, outputHeight:customHeight} : canvas;
            if(JSON.stringify(next) !== JSON.stringify(edits.canvas)) onUpdate({canvas:next,resolution:'original'});
          }
          setOpen(null);
        }}>{open === 'crop' ? 'apply crop' : 'apply dimensions'}</Button></DialogFooter>
      </DialogPopup>
    </Dialog>
  </>;
}
