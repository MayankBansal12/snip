import { clamp, fullCrop } from './types';
import type { Crop } from './types';

export function cropForRatio(sourceRatio: number, ratio: number | null): Crop {
  if (!ratio) return { ...fullCrop };
  const width = Math.min(1, ratio / sourceRatio), height = Math.min(1, sourceRatio / ratio);
  return { x: (1 - width) / 2, y: (1 - height) / 2, width, height };
}

export function moveCrop(crop: Crop, dx: number, dy: number): Crop {
  return { ...crop, x: clamp(crop.x + dx, 0, 1 - crop.width), y: clamp(crop.y + dy, 0, 1 - crop.height) };
}

export function resizeCrop(crop: Crop, corner: string, dx: number, dy: number, ratio: number | null, sourceRatio: number): Crop {
  const west = corner.includes('w'), north = corner.includes('n');
  const anchorX = west ? crop.x + crop.width : crop.x, anchorY = north ? crop.y + crop.height : crop.y;
  const maxWidth = west ? anchorX : 1 - anchorX, maxHeight = north ? anchorY : 1 - anchorY;
  let width = clamp(crop.width + (west ? -dx : dx), Math.min(.02, maxWidth), maxWidth);
  let height = clamp(crop.height + (north ? -dy : dy), Math.min(.02, maxHeight), maxHeight);
  if (ratio) {
    const normalizedRatio = ratio / sourceRatio;
    if (Math.abs(dx) >= Math.abs(dy)) height = width / normalizedRatio;
    else width = height * normalizedRatio;
    const scale = Math.min(1, maxWidth / width, maxHeight / height);
    width *= scale; height *= scale;
  }
  return { x: west ? anchorX - width : anchorX, y: north ? anchorY - height : anchorY, width, height };
}
