import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

// Run against Vite with a CDP browser, FFmpeg and ffprobe available.
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
const out = process.env.VERIFY_OUTPUT || '/tmp/snip-export-avc';
mkdirSync(out, { recursive: true });
const input = `${out}/source.mp4`;
execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=1', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', input]);
// Decoder configuration from the rejected export (no video content).
const malformed = '016400280301001a6767640028acd94078020fea10000003001001e84800f18319600100076868ebe3cb22c0';
const browser = await chromium.connectOverCDP(process.env.CDP_URL || 'http://127.0.0.1:9231');
try {
  for (const mode of ['valid', 'invalid', 'invalid-on-flush']) {
    const context = await browser.newContext();
    try {
      await context.addInitScript(({ mode, malformed }) => {
        window.nativePackets = 0;
        const Encoder = VideoEncoder;
        window.VideoEncoder = class extends Encoder {
          constructor(init) {
            super({ ...init, output(chunk, meta) {
              window.nativePackets++;
              const corrupt = mode === 'invalid' || (mode === 'invalid-on-flush' && window.flushing);
              if (corrupt && meta?.decoderConfig) {
                meta = { ...meta, decoderConfig: { ...meta.decoderConfig,
                  description: Uint8Array.from(malformed.match(/../g), hex => parseInt(hex, 16)) } };
              }
              init.output(chunk, meta);
            } });
          }
          flush() { window.flushing = true; return super.flush().finally(() => { window.flushing = false; }); }
        };
      }, { mode, malformed });
      const page = await context.newPage();
      await page.goto(process.env.APP_URL || 'http://127.0.0.1:5220');
      const results = await page.evaluate(async ({ bytes, malformed, mode }) => {
        const { validAvcDescription } = await import('/src/avc.ts');
        const bad = Uint8Array.from(malformed.match(/../g), hex => parseInt(hex, 16));
        if (validAvcDescription(bad)) throw Error('Accepted the rejected export header');
        // Fixing reserved bits alone must not hide duplicated NAL headers.
        bad[4] |= 0xfc; bad[5] |= 0xe0;
        if (validAvcDescription(bad)) throw Error('Accepted duplicated SPS header');
        // Use an otherwise valid record so truncation tests exercise length
        // checks rather than failing early on the already-malformed SPS.
        const good = Uint8Array.from('0164000dffe1001a6764000dacd941419f9f0110000003001000000303c0f142996001000668ebe3cb22c0'.match(/../g), hex => parseInt(hex, 16));
        if (!validAvcDescription(good.buffer)) throw Error('Rejected valid header');
        const padded = new Uint8Array(good.length + 8); padded.set(good, 4);
        if (!validAvcDescription(new DataView(padded.buffer, 4, good.length))) throw Error('Ignored buffer view bounds');
        for (let n = 0; n < good.length; n++) {
          if (validAvcDescription(good.subarray(0, n))) throw Error('Accepted truncated header');
        }
        for (const [index, value] of [[0, 0], [4, 0xfe], [5, 0xe0], [6, 255], [8, 0x68], [9, 0x67], [34, 0], [37, 0x67]]) {
          const corrupted = good.slice(); corrupted[index] = value;
          if (validAvcDescription(corrupted)) throw Error(`Accepted invalid header field at ${index}`);
        }
        const { readMetadata } = await import('/src/media.ts');
        const { defaults } = await import('/src/types.ts');
        const { exportVideo } = await import('/src/export.ts');
        const source = await readMetadata(new File([new Uint8Array(bytes)], 'source.mp4', { type: 'video/mp4' }));
        const outputs = [];
        // Exercise direct YUV and canvas paths, plus metadata arriving at flush.
        for (const canvas of [false, true]) {
          window.nativePackets = 0;
          const edits = defaults(source.duration);
          edits.clips = [{ ...edits.clips[0], start: .1, end: mode === 'invalid-on-flush' ? .13 : .8 }];
          if (canvas) edits.canvas = { ...edits.canvas, ratio: 1, aspect: '1:1' };
          const stages = [];
          const blob = await exportVideo(source, edits, (_, stage) => stages.push(stage));
          outputs.push({ bytes: Array.from(new Uint8Array(await blob.arrayBuffer())),
            fallback: stages.includes('Preparing compatible video export'), nativePackets: window.nativePackets, canvas });
        }
        return outputs;
      }, { bytes: Array.from(readFileSync(input)), malformed, mode });
      for (const result of results) {
        assert(result.nativePackets > 0, 'The native encoder must actually run');
        assert.equal(result.fallback, mode !== 'valid', 'Invalid metadata must trigger FFmpeg fallback');
        const output = `${out}/${mode}-${result.canvas ? 'canvas' : 'direct'}.mp4`;
        writeFileSync(output, Buffer.from(result.bytes));
        const probe = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_streams', '-of', 'json', output]));
        const video = probe.streams.find(stream => stream.codec_type === 'video');
        assert.equal(video.width, result.canvas ? 180 : 320);
        assert.equal(video.height, 180);
        assert.equal(probe.streams.find(stream => stream.codec_type === 'audio')?.codec_name, 'aac', 'Fallback must preserve audio');
        // A stricter header parser catches the real defect even when playback succeeds.
        execFileSync(ffmpeg, ['-v', 'error', '-xerror', '-i', output, '-c:v', 'copy', '-bsf:v', 'trace_headers', '-f', 'null', '-']);
        execFileSync(ffmpeg, ['-v', 'error', '-xerror', '-i', output, '-f', 'null', '-']);
      }
      console.log('PASS', mode, 'direct/canvas export and valid H.264 headers');
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
