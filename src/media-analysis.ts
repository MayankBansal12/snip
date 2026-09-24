import { ALL_FORMATS, BlobSource, EncodedPacketSink, Input } from 'mediabunny';

const MAX_FRAMES = 1_000_000;

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
    let count = 0, first = Infinity, videoEnd = 0, minDuration = Infinity, maxDuration = 0;
    const times: number[] = [];
    for await (const packet of new EncodedPacketSink(track).packets(undefined, undefined, { metadataOnly: true })) {
      count++; first = Math.min(first, packet.timestamp);
      videoEnd = Math.max(videoEnd, packet.timestamp + packet.duration);
      times.push(packet.timestamp);
      minDuration=Math.min(minDuration,packet.duration);maxDuration=Math.max(maxDuration,packet.duration);
      if (count > MAX_FRAMES) throw new Error('Export details exceed the frame indexing limit.');
      if (count % 4000 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (!count) throw new Error('The exported file has no video frames.');
    times.sort((a,b) => a-b);
    let min = minDuration, max = maxDuration;
    for (let i = 1; i < times.length; i++) { const gap = times[i] - times[i-1]; min = Math.min(min,gap); max = Math.max(max,gap); }
    const duration = await input.computeDuration();
    const audio = await input.getPrimaryAudioTrack();
    return { duration, width: await track.getDisplayWidth(), height: await track.getDisplayHeight(), frameCount: count,
      frameRate: count / Math.max(videoEnd - first, .001),
      // WebM quantizes timestamps to milliseconds; alternating 33/34ms is still CFR.
      variable: count > 1 && max - min > Math.max(.0011, min * .01), videoCodec: await track.getCodec() ?? 'unknown',
      audio: audio ? { codec: await audio.getCodec() ?? 'unknown', sampleRate: await audio.getSampleRate(), channels: await audio.getNumberOfChannels() } : null };
  } finally { input.dispose(); }
}
