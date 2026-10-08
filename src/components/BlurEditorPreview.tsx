import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import { canvasSize, clipDuration, placement, toSourceTime } from '../types';
import type { Blur, Edits, Source } from '../types';
import { zoomViewport } from '../zoom';
import { drawAnnotation } from '../effects';
import BlurArea from './BlurArea';

type Props = { source: Source; edits: Edits; time: number; selected: string; videoRef: RefObject<HTMLVideoElement | null>;
  onSelect: (id: string) => void; onChange: (id: string, patch: Partial<Blur>, record?: boolean) => void; onCheckpoint: () => void; onDelete: () => void };
export default function BlurEditorPreview({ source, edits, time, selected, videoRef, ...events }: Props) {
  const surface = useRef<HTMLDivElement>(null), picture = useRef<HTMLCanvasElement>(null), annotations = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const output = canvasSize(source, edits), ratio = output.width / output.height;
  useEffect(() => {
    const element = surface.current; if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const video = videoRef.current, target = picture.current, overlay = annotations.current; if (!video || !target || !overlay) return;
    target.width = Math.max(2, Math.round(Math.min(960, output.width))); target.height = Math.max(2, Math.round(target.width / ratio));
    overlay.width = target.width; overlay.height = target.height;
    const ctx = target.getContext('2d')!, position = placement(source, edits, target);
    const location = toSourceTime(time, edits), elapsed = time - edits.clips.slice(0, location.index).reduce((sum, clip) => sum + clipDuration(clip, edits), 0);
    const view = zoomViewport(source, edits, location.index, elapsed);
    const draw = () => {
      if (video.readyState < 2 || video.seeking) return;
      ctx.fillStyle = edits.canvas.background; ctx.fillRect(0, 0, target.width, target.height);
      ctx.drawImage(video, view.x, view.y, view.width, view.height, position.x, position.y, position.width, position.height);
    };
    draw(); video.addEventListener('seeked', draw); video.addEventListener('loadeddata', draw);
    const overlayContext = overlay.getContext('2d')!;
    edits.annotations.forEach(a => drawAnnotation(overlayContext, a, target.width, target.height));
    return () => { video.removeEventListener('seeked', draw); video.removeEventListener('loadeddata', draw); };
  }, [edits, source, videoRef, time, output.width, ratio]);
  return <div className="blur-editor-preview-wrap">
    <div ref={surface} className="blur-editor-preview" style={{ aspectRatio: ratio, width: `min(100%, ${28 * ratio}svh)`, '--blur-ratio': ratio } as CSSProperties}>
      <canvas ref={picture} className="blur-editor-picture" aria-hidden="true" style={{ filter: 'url(#video-treatment)' }} />
      <BlurArea blurs={edits.blurs} time={time} width={size.width} height={size.height} editing selected={selected} {...events} />
      <canvas ref={annotations} className="annotation-overlay" aria-hidden="true" />
    </div>
  </div>;
}
