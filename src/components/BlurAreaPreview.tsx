import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { canvasSize, clipDuration, placement, toSourceTime, sequenceDuration } from '../types';
import type { Blur, Edits, Source } from '../types';
import { zoomViewport } from '../zoom';
import { drawAnnotation } from '../effects';
import BlurArea from './BlurArea';

type Props = { source: Source; edits: Edits; time: number; selected: string; videoRef: RefObject<HTMLVideoElement | null>;
  onSelect: (id: string) => void; onChange: (id: string, patch: Partial<Blur>, record?: boolean) => void; onCheckpoint: () => void; onDelete: () => void };

export default function BlurAreaPreview({ source, edits, time, selected, videoRef, ...events }: Props) {
  const frame = useRef<HTMLDivElement>(null), picture = useRef<HTMLCanvasElement>(null), annotations = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const output = canvasSize(source, edits), ratio = output.width / output.height;
  useEffect(() => {
    const element = frame.current; if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const video = videoRef.current, canvas = picture.current, overlay = annotations.current; if (!video || !canvas || !overlay) return;
    canvas.width = Math.max(2, Math.round(Math.min(640, output.width))); canvas.height = Math.max(2, Math.round(canvas.width / ratio));
    overlay.width = canvas.width; overlay.height = canvas.height;
    const ctx = canvas.getContext('2d')!, position = placement(source, edits, canvas);
    const location = toSourceTime(time, edits), elapsed = time - edits.clips.slice(0, location.index).reduce((sum, clip) => sum + clipDuration(clip, edits), 0);
    const view = zoomViewport(source, edits, location.index, elapsed);
    const draw = () => {
      if (video.readyState < 2 || video.seeking) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(video, view.x, view.y, view.width, view.height, position.x, position.y, position.width, position.height);
    };
    draw(); video.addEventListener('seeked', draw); video.addEventListener('loadeddata', draw);
    const overlayContext = overlay.getContext('2d')!;
    edits.annotations.forEach(a => drawAnnotation(overlayContext, a, canvas.width, canvas.height));
    return () => { video.removeEventListener('seeked', draw); video.removeEventListener('loadeddata', draw); };
  }, [edits, source, videoRef, time, output.width, ratio]);
  return <div className="space-y-2">
    <div className="blur-area-wrap"><div ref={frame} className="blur-area-preview" style={{ aspectRatio: ratio, width: `min(100%, ${24 * ratio}svh, ${180 * ratio}px)`, background: edits.canvas.background }}>
      <canvas ref={picture} className="size-full" aria-hidden="true" style={{ filter: 'url(#video-treatment)' }} />
      <BlurArea blurs={edits.blurs} time={time} duration={sequenceDuration(edits)} width={size.width} height={size.height} editing selectable selected={selected} {...events} />
      <canvas ref={annotations} className="annotation-overlay" aria-hidden="true" />
    </div></div>
    {selected && <p className="text-xs text-muted-foreground">drag the box · use corners to resize</p>}
  </div>;
}
