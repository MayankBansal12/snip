import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Run against the Vite dev server with FFmpeg and ffprobe available.
const out = process.env.VERIFY_OUTPUT || '/tmp/snip-export-compatibility';
mkdirSync(out, { recursive: true });
const sample = path.join(out, 'source.mp4'), output = path.join(out, 'export.mp4');
// A fractional, variable frame rate reproduces the screen recording's timing.
execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', [
  '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=1220000/215149:duration=17',
  '-vf', "select='not(eq(mod(n,7),5))'", '-fps_mode', 'vfr', '-enc_time_base', '1:1220000',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', sample,
]);
const browser = await chromium.connectOverCDP(process.env.CDP_URL || 'http://127.0.0.1:19384');
const context = await browser.newContext(), page = await context.newPage();
try {
  await page.goto(process.env.APP_URL || 'http://127.0.0.1:5198');
  const result = await page.evaluate(async bytes => {
    const { readMetadata } = await import('/src/media.ts');
    const { defaults, sequenceDuration } = await import('/src/types.ts');
    const { exportVideo } = await import('/src/export.ts');
    const source = await readMetadata(new File([new Uint8Array(bytes)], 'source.mp4', { type: 'video/mp4' }));
    const edits = { ...defaults(source.duration), clips: [
      { id: 'a', start: 0, end: 1.893518, speed: 1 },
      { id: 'b', start: 1.893518, end: 5.145782, speed: 1.5, zoom: { scale: 1.25, x: .6, y: .15 } },
      { id: 'c', start: 12.699312, end: 14.461, speed: 1 },
    ] };
    const blob = await exportVideo(source, edits, () => {});
    return { bytes: Array.from(new Uint8Array(await blob.arrayBuffer())), duration: sequenceDuration(edits) };
  }, Array.from(readFileSync(sample)));
  writeFileSync(output, Buffer.from(result.bytes));
  const probe = JSON.parse(execFileSync(process.env.FFPROBE_PATH || 'ffprobe', [
    '-v', 'error', '-show_streams', '-show_format', '-show_frames', '-of', 'json', output,
  ]));
  const video = probe.streams.find(stream => stream.codec_type === 'video');
  assert.equal(video.codec_name, 'h264');
  assert(video.level <= 41, `Small export must not require H.264 level ${video.level / 10}`);
  assert(Math.abs(Number(probe.format.duration) - result.duration) < .25, 'Export must preserve edited duration');
  const times = probe.frames.filter(frame => frame.media_type === 'video').map(frame => Number(frame.best_effort_timestamp_time));
  for (const start of [2.1, 4.25]) {
    const transition = times.filter(time => time >= start && time < start + .3);
    assert(transition.length >= 17, 'Camera motion must stay smooth on a sparse recording');
    assert(transition.slice(1).every((time, i) => time - transition[i] < .018), 'Transition frames must be at least 60 fps');
  }
  console.log('PASS: trimmed clips with speed and zoom export at a compatible H.264 level', { level: video.level, duration: probe.format.duration });
} finally { await context.close(); await browser.close(); }
