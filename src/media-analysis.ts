import { ALL_FORMATS, BlobSource, EncodedPacketSink, Input } from 'mediabunny';
import type { Source } from './types';
import type { FrameIndex } from './frame-timing';

const MAX_FRAMES = 1_000_000;
const indexes = new WeakMap<Blob, Promise<FrameIndex>>();
export function getFrameIndex(source: Source): Promise<FrameIndex> {
  let result = indexes.get(source.file);
  if (!result) {
    result = (async () => {
      const input = new Input({ source: new BlobSource(source.file), formats: ALL_FORMATS });
      try {
        const tracks = await input.getVideoTracks(), track = tracks[0];
        if (tracks.length !== 1 || !track || !['avc','hevc','vp8','vp9','av1'].includes(await track.getCodec() ?? ''))
          throw new Error('Frame indexing is unavailable for this video format.');
        const times: number[] = [];
        for await (const packet of new EncodedPacketSink(track).packets(undefined, undefined, { metadataOnly: true })) {
          if (!Number.isFinite(packet.timestamp) || packet.timestamp < -1e-7) throw new Error('This video uses an unsupported timestamp offset.');
          times.push(Math.max(0, packet.timestamp));
          if (times.length > MAX_FRAMES) throw new Error('This video exceeds the one-million-frame indexing limit.');
          // Let input and cancellation/UI events run on long indexes.
          if (times.length % 4000 === 0) await new Promise(resolve => setTimeout(resolve, 0));
        }
        times.sort((a, b) => a - b);
        if (!times.length || times[0] > 1e-7 || times.some((t, i) => i > 0 && t <= times[i - 1]))
          throw new Error('This video has ambiguous frame timestamps.');
        if (times.at(-1)! >= source.duration) throw new Error('Video timestamps do not match its playback duration.');
        return { times: Float64Array.from(times), end: source.duration };
      } finally { input.dispose(); }
    })();
    indexes.set(source.file, result);
  }
  return result;
}

export type ExportDetails = {
  duration: number; width: number; height: number; frameCount: number; frameRate: number; variable: boolean;
  videoCodec: string; audio: { codec: string; sampleRate: number; channels: number } | null;
};
/** Inspect the completed bytes, never infer output properties from requested settings. */
export async function inspectExport(file: Blob): Promise<ExportDetails> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('The exported file has no video track.');
    let count = 0, first = Infinity, last = -Infinity, videoEnd = 0;
    const times: number[] = [];
    for await (const packet of new EncodedPacketSink(track).packets(undefined, undefined, { metadataOnly: true })) {
      count++; first = Math.min(first, packet.timestamp); last = Math.max(last, packet.timestamp);
      videoEnd = Math.max(videoEnd, packet.timestamp + packet.duration);
      times.push(packet.timestamp);
      if (count > MAX_FRAMES) throw new Error('Export details exceed the frame indexing limit.');
      if (count % 4000 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (!count) throw new Error('The exported file has no video frames.');
    times.sort((a,b) => a-b);
    let min = Infinity, max = 0;
    for (let i = 1; i < times.length; i++) { const gap = times[i] - times[i-1]; min = Math.min(min,gap); max = Math.max(max,gap); }
    const duration = await input.computeDuration();
    const audio = await input.getPrimaryAudioTrack();
    return { duration, width: await track.getDisplayWidth(), height: await track.getDisplayHeight(), frameCount: count,
      frameRate: count > 1 ? (count - 1) / (last - first) : 1 / Math.max(videoEnd - first, .001),
      // WebM quantizes timestamps to milliseconds; alternating 33/34ms is still CFR.
      variable: count > 2 && max - min > Math.max(.0011, min * .01), videoCodec: await track.getCodec() ?? 'unknown',
      audio: audio ? { codec: await audio.getCodec() ?? 'unknown', sampleRate: await audio.getSampleRate(), channels: await audio.getNumberOfChannels() } : null };
  } finally { input.dispose(); }
}
