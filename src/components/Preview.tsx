import { Play, Pause } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import { cropPixels, canvasSize, placement, clipDuration } from '../types';
import { zoomViewport } from '../zoom';
import type { Clip, Edits, Source } from '../types';
import { drawAnnotation, svgMatrix } from '../effects';

type Props = {
  source: Source; edits: Edits; clip?: Clip; time: number; editing: boolean; playing: boolean; url: string; videoRef: RefObject<HTMLVideoElement | null>;
  onLoaded: () => void; onToggle: () => void;
};
export default function Preview({ source, edits, clip, time, editing, playing, url, videoRef, ...events }: Props) {
  const frame = useRef<HTMLDivElement>(null), overlay = useRef<HTMLCanvasElement>(null);
  const previousPlayback = useRef({ playing, url });
  const [showPlaybackFeedback, setShowPlaybackFeedback] = useState(false);
  useEffect(() => {
    const previous = previousPlayback.current;
    previousPlayback.current = { playing, url };
    if (previous.url !== url || previous.playing === playing) {
      setShowPlaybackFeedback(false);
      return;
    }
    setShowPlaybackFeedback(true);
    const timer = window.setTimeout(() => setShowPlaybackFeedback(false), 500);
    return () => window.clearTimeout(timer);
  }, [playing, url]);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const output = canvasSize(source, edits), base = cropPixels(source, edits.crop), pos = placement(source, edits, output);
  const index = Math.max(0, edits.clips.findIndex(c => c.id === clip?.id));
  const elapsed = time - edits.clips.slice(0, index).reduce((total, c) => total + clipDuration(c, edits), 0);
  const crop = zoomViewport(source, edits, index, elapsed, editing);
  const ratio = output.width / output.height;
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setSize({ width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // Existing projects retain their annotations and color treatment.
  useEffect(() => {
    const c = overlay.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(size.width * dpr); c.height = Math.round(size.height * dpr);
    const ctx = c.getContext('2d')!; ctx.scale(dpr, dpr);
    edits.annotations.forEach(a => drawAnnotation(ctx, a, size.width, size.height));
  }, [edits.annotations, size]);
  const sourceStyle: CSSProperties = { width: `${pos.width / output.width * 100}%`, height: `${pos.height / output.height * 100}%`, left: `${pos.x / output.width * 100}%`, top: `${pos.y / output.height * 100}%` };
  const videoStyle: CSSProperties = { width: `${source.width / base.width * 100}%`, height: `${source.height / base.height * 100}%`, transformOrigin: '0 0', willChange: playing ? 'transform' : undefined, transform: `scale(${base.width / crop.width}, ${base.height / crop.height}) translate(${-crop.x / source.width * 100}%, ${-crop.y / source.height * 100}%)`, filter: 'url(#video-treatment)' };
  return <div className="preview-stage">
    <svg width="0" height="0" className="filter-definitions" aria-hidden="true"><defs><filter id="video-treatment" colorInterpolationFilters="sRGB"><feColorMatrix type="matrix" values={svgMatrix(edits)} /></filter></defs></svg>
    <div className="preview-boundary"><div ref={frame} className="composition rounded-lg" style={{ aspectRatio: ratio, '--ratio': ratio, background: edits.canvas.background } as CSSProperties}>
      <div className="source-window" style={sourceStyle}><video ref={videoRef} src={url || undefined} style={videoStyle} playsInline preload="auto" onLoadedMetadata={events.onLoaded} onClick={events.onToggle} /></div>
      <div className="preview-playback-state" aria-hidden="true" data-visible={showPlaybackFeedback}>
        {playing ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
      </div>
      <canvas ref={overlay} className="annotation-overlay" aria-hidden="true" />
    </div></div>
  </div>;
}
