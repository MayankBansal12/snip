import { memo } from 'react';
import type { Clip } from '../types';
export type Thumbnail = { url: string; time: number };
export default memo(function ClipThumbnails({ clip, frames, count }: { clip: Clip; frames: Thumbnail[]; count: number }) {
  return <div className="clip-thumbnails">{Array.from({ length: count }, (_, i) => {
    const sample = clip.start + (i + .5) / count * (clip.end - clip.start);
    const image = frames.reduce<Thumbnail | undefined>((best, f) => !best || Math.abs(f.time - sample) < Math.abs(best.time - sample) ? f : best, undefined);
    return image ? <img key={i} src={image.url} alt="" draggable={false} /> : <span key={i} />;
  })}</div>;
});
