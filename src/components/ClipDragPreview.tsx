import { useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { createPortal } from 'react-dom';
import { clipSpeed } from '../types';
import type { Clip, Edits } from '../types';
import type { ClipDrop, ClipLanding } from '../hooks/useClipReorder';
import ClipThumbnails from './ClipThumbnails';
import type { Thumbnail } from './ClipThumbnails';

export default function ClipDragPreview({ drop, landing, clip, edits, frames, element, onFinish }: { element: RefObject<HTMLDivElement | null>; drop: ClipDrop; landing: ClipLanding | null; clip: Clip; edits: Edits; frames: Thumbnail[]; onFinish: () => void }) {
  const finish = useRef(onFinish); finish.current = onFinish;
  useLayoutEffect(() => {
    if (!landing || !element.current) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { finish.current(); return; }
    const animation = element.current.animate([
      { transform: `translate3d(${landing.originX}px,${landing.originY}px,0)`, opacity: 1 },
      { transform: `translate3d(${landing.x}px,${landing.y}px,0)`, opacity: 0 },
    ], { duration: 180, easing: 'cubic-bezier(.23,1,.32,1)' });
    animation.onfinish = () => finish.current();
    return () => animation.cancel();
  }, [landing]);
  return createPortal(<div ref={element} className="clip-drag-preview" data-valid={drop.valid} style={{ width: drop.width, transform: `translate3d(${drop.x}px,${drop.y}px,0)` }} aria-hidden="true">
    <ClipThumbnails clip={clip} frames={frames} count={Math.max(1, Math.ceil(drop.width / 65))} />
    <span className="clip-number">{String(drop.from + 1).padStart(2, '0')}{clipSpeed(clip, edits) !== 1 ? ` · ${clipSpeed(clip, edits)}×` : ''}</span>
  </div>, document.body);
}
