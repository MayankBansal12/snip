import { useEffect, useRef, useState } from 'react';
import type { PointerEvent, RefObject } from 'react';
import { clamp, clipCrop, defaultZoom } from '../types';
import type { Clip, ClipZoom, Edits, Source } from '../types';

type Props = {
  source: Source; edits: Edits; clip: Clip; videoRef: RefObject<HTMLVideoElement | null>;
  onChange: (zoom: ClipZoom, record?: boolean) => void; onCheckpoint: () => void;
};
export default function ZoomArea({ source, edits, clip, videoRef, onChange, onCheckpoint }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ pointer: number; x: number; y: number; zoom: ClipZoom; width: number; height: number } | null>(null);
  const zoom = clip.zoom ?? defaultZoom, crop = clipCrop(edits, clip);
  useEffect(() => {
    const video = videoRef.current, target = canvas.current;
    if (!video || !target) return;
    target.width = Math.min(640, source.width);
    target.height = Math.max(1, Math.round(target.width * source.height / source.width));
    const draw = () => { if (video.readyState >= 2) target.getContext('2d')?.drawImage(video, 0, 0, target.width, target.height); };
    draw(); video.addEventListener('seeked', draw); video.addEventListener('loadeddata', draw);
    return () => { video.removeEventListener('seeked', draw); video.removeEventListener('loadeddata', draw); };
  }, [source, videoRef, clip.id]);

  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || drag.current || zoom.scale <= 1) return;
    event.preventDefault(); event.stopPropagation(); event.currentTarget.focus({ preventScroll: true }); onCheckpoint();
    const bounds = event.currentTarget.getBoundingClientRect();
    const within = event.target instanceof Element && !!event.target.closest('[data-zoom-selection]');
    const initial = within ? zoom : {
      ...zoom,
      x: clamp(((event.clientX - bounds.left) / bounds.width - edits.crop.x - crop.width / 2) / (edits.crop.width - crop.width), 0, 1),
      y: clamp(((event.clientY - bounds.top) / bounds.height - edits.crop.y - crop.height / 2) / (edits.crop.height - crop.height), 0, 1),
    };
    drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, zoom: initial, width: bounds.width, height: bounds.height };
    if (!within) onChange(initial, false);
    setDragging(true); event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    const dx = (event.clientX - current.x) / current.width, dy = (event.clientY - current.y) / current.height;
    onChange({ ...current.zoom,
      x: clamp(current.zoom.x + dx / (edits.crop.width - crop.width), 0, 1),
      y: clamp(current.zoom.y + dy / (edits.crop.height - crop.height), 0, 1),
    }, false);
  };
  const end = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointer !== event.pointerId) return;
    drag.current = null; setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return <div className="space-y-2">
    <div className="zoom-area" role="group" tabIndex={0} aria-label="Zoom area" aria-describedby="zoom-area-help" data-dragging={dragging} style={{ aspectRatio: source.width / source.height }}
      onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}
      onKeyDown={event => {
        if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        const step = event.shiftKey ? .1 : .01;
        onChange(event.key === 'Home' ? { ...zoom, x: .5, y: .5 } : { ...zoom,
          x: clamp(zoom.x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0), 0, 1),
          y: clamp(zoom.y + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0), 0, 1),
        });
      }}>
      <canvas ref={canvas} className="size-full" aria-hidden="true" />
      <div data-zoom-selection className="zoom-selection" style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` }} />
    </div>
    <p id="zoom-area-help" className="text-xs text-muted-foreground">Drag the box to choose what stays in view.<span className="sr-only"> Arrow keys move it. Shift moves faster. Home centers it.</span></p>
  </div>;
}
