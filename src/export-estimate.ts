import { outputSize, sequenceDuration } from './types';
import type { Edits, Source } from './types';

export type SizeEstimate = { min: number; max: number };

/** A quick planning range, not an encoder prediction or a file-size limit. */
export function estimateExportSize(source: Source, edits: Edits): SizeEstimate {
  const output = outputSize(source, edits);
  const keptSeconds = edits.clips.reduce((total, clip) => total + clip.end - clip.start, 0);
  const duration = sequenceDuration(edits);
  // Source byte density provides a rough content-complexity hint. Compression
  // doesn't scale linearly with pixels, so retain some cost when downscaling.
  const pixelRatio = output.width * output.height / (source.width * source.height);
  const quality = edits.quality === 'maximum' ? 1.4 : .65;
  let videoBytes = source.file.size * keptSeconds / source.duration * Math.pow(pixelRatio, .8) * quality;
  if (edits.format === 'webm') {
    // VP8 uses a bitrate budget in export.ts, unlike the MP4 CRF-only encoder.
    const budget = output.width * output.height * (edits.quality === 'maximum' ? .24 : .1) * 30 * duration / 8;
    videoBytes = Math.min(videoBytes * 1.2, budget);
  }
  // MP4 retimes existing video frames. Speed primarily changes audio duration,
  // rather than proportionally adding/removing encoded video frames.
  const audioBytes = edits.muted ? 0 : duration * (edits.format === 'mp4' ? 256_000 : 192_000) / 8;
  const overhead = 4096 + duration * 1024;
  // Source codecs, motion, zoom and grading can all change compression. Audio
  // is optional, so it is included only in the upper end of this broad range.
  return { min: Math.ceil(videoBytes * .3 + overhead), max: Math.ceil((videoBytes * 2 + audioBytes) * 1.03 + overhead) };
}

export function formatSizeEstimate({ min, max }: SizeEstimate) {
  const unit = max >= 1024 ** 3 ? 1024 ** 3 : max >= 1024 ** 2 ? 1024 ** 2 : 1024;
  const label = unit === 1024 ** 3 ? 'GB' : unit === 1024 ** 2 ? 'MB' : 'KB';
  const round = (bytes: number, up: boolean) => {
    const value = bytes / unit, step = 10 ** (Math.floor(Math.log10(value)) - 1);
    return Number(((up ? Math.ceil(value / step) : Math.floor(value / step)) * step).toPrecision(2));
  };
  return `${round(min, false)}–${round(max, true)} ${label}`;
}
