import { useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';

type Position = { id: string; base: number; target: number };
type Item = { element: HTMLElement; base: number; position: number; target: number; velocity: number };

// Retarget critically damped springs from their current position and velocity.
// Base positions may change on drop; transforms compensate before the next paint.
export function useClipLayout(track: RefObject<HTMLDivElement | null>, positions: Position[], dragging: boolean, width: number) {
  const items = useRef(new Map<string, Item>()), frame = useRef(0), wasDragging = useRef(false), previousWidth = useRef(width);
  const key = JSON.stringify(positions);
  useLayoutEffect(() => {
    cancelAnimationFrame(frame.current);
    const animate = (dragging || wasDragging.current) && previousWidth.current === width && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    wasDragging.current = dragging; previousWidth.current = width;
    const ids = new Set(positions.map(p => p.id));
    for (const id of items.current.keys()) if (!ids.has(id)) items.current.delete(id);
    const elements = new Map(Array.from(track.current?.children ?? []).map(el => [(el as HTMLElement).dataset.clipId, el as HTMLElement]));
    for (const p of positions) {
      const element = elements.get(p.id);
      if (!element) continue;
      const item = items.current.get(p.id) ?? { element, base: p.base, position: p.base, target: p.target, velocity: 0 };
      item.element = element; item.base = p.base; item.target = p.target;
      if (!animate) { item.position = p.target; item.velocity = 0; }
      element.style.transform = Math.abs(item.position - item.base) < .01 ? '' : `translate3d(${item.position - item.base}px,0,0)`;
      items.current.set(p.id, item);
    }
    if (!animate) return;
    let previous = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - previous) / 1000, .032); previous = now;
      let moving = false;
      for (const item of items.current.values()) {
        // Closed-form critically damped spring, stable even after a slow frame.
        const omega = 28, delta = item.position - item.target, carry = item.velocity + omega * delta, decay = Math.exp(-omega * dt);
        item.position = item.target + (delta + carry * dt) * decay;
        item.velocity = (item.velocity - omega * carry * dt) * decay;
        if (Math.abs(item.position - item.target) < .1 && Math.abs(item.velocity) < .5) { item.position = item.target; item.velocity = 0; }
        else moving = true;
        item.element.style.transform = Math.abs(item.position - item.base) < .01 ? '' : `translate3d(${item.position - item.base}px,0,0)`;
      }
      if (moving) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  // The serialized layout only changes when the insertion slot changes, not for every pointer frame.
  }, [key, dragging, width]);
  useLayoutEffect(() => () => cancelAnimationFrame(frame.current), []);
}
