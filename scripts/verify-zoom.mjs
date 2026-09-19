import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { select } from './ui.mjs';

const sample = process.env.VIDEO_SAMPLE;
if (!sample) throw Error('Set VIDEO_SAMPLE to an 8-second video.');
const out = process.env.VERIFY_OUTPUT || '/tmp/snip-zoom', app = process.env.APP_URL || 'http://127.0.0.1:5195';
mkdirSync(out, { recursive: true });
const browser = await chromium.connectOverCDP(process.env.CDP_URL || 'http://127.0.0.1:19384');
const contexts = [], errors = [], report = [];
const button = (p, name) => p.getByRole('button', { name, exact: true });
const log = (check, details = {}) => { report.push({ check, ...details }); console.log('PASS', check, details); };
const blur = p => p.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
async function fresh(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'dark', acceptDownloads: true, ...options });
  contexts.push(context);
  const page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', e => errors.push(e.message));
  await page.goto(app); await page.waitForFunction(() => !document.querySelector('#video-file')?.disabled);
  return page;
}
async function open(p, file = sample) {
  await p.locator('#video-file').setInputFiles({ name: 'demo.mp4', mimeType: 'video/mp4', buffer: readFileSync(file) });
  await p.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
}
async function seek(p, seconds) {
  const head = p.getByRole('slider', { name: 'Seek video', exact: true });
  await head.focus(); await head.press('Home');
  for (let i = 0; i < Math.floor(seconds); i++) await head.press('Shift+ArrowRight');
  for (let i = 0; i < Math.round(seconds % 1 * 30); i++) await head.press('ArrowRight');
  await blur(p);
  await p.waitForFunction(() => !document.querySelector('video').seeking);
  return Number(await head.getAttribute('aria-valuenow'));
}
async function stored(p) {
  await p.getByRole('status').filter({ hasText: 'Saved on this device' }).waitFor();
  return p.evaluate(() => new Promise((resolve, reject) => {
    const r = indexedDB.open('snip-local-project', 1);
    r.onsuccess = () => { const db = r.result, t = db.transaction('project'), e = t.objectStore('project').get('edits'); e.onsuccess = () => resolve(e.result); t.oncomplete = () => db.close(); };
    r.onerror = () => reject(r.error);
  }));
}
async function close(p) {
  await button(p, 'Close clip actions').click(); await p.locator('[data-slot=popover-popup]').waitFor({ state: 'hidden' }); await blur(p);
}
async function rightClick(p, index) {
  const box = await p.locator('.timeline-clip').nth(index).boundingBox();
  // A real pointer also exercises right-clicking where the playhead overlays a clip.
  await p.mouse.click(box.x + 60, box.y + 25, { button: 'right' });
  await p.getByText(`Clip ${index + 1}`, { exact: true }).waitFor();
  await p.locator('[data-slot=popover-popup]').evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(a => a.finished.catch(() => {}))));
}
async function zoom(p, scale) {
  const slider = p.getByRole('slider', { name: 'Zoom', exact: true });
  await slider.focus(); await slider.press('Home');
  for (let i = 0; i < Math.round((scale - 1) / .05); i++) await slider.press('ArrowRight');
}
async function custom(p, value) {
  await p.getByRole('combobox', { name: 'Clip speed', exact: true }).click();
  await p.getByRole('option', { name: 'Custom…', exact: true }).click();
  const field = p.getByRole('spinbutton', { name: 'Custom speed', exact: true });
  await field.fill(String(value)); await field.press('Enter'); return field;
}
async function download(p, name, run) {
  const waiting = p.waitForEvent('download', { timeout: 180000 }); await run();
  const d = await waiting, file = path.join(out, name); await d.saveAs(file); assert.equal(await d.failure(), null); return file;
}
function project(edits, file) {
  const video = readFileSync(file), manifest = Buffer.from(JSON.stringify({ savedAt: new Date().toISOString(), source: { name: 'gradient.mp4', type: 'video/mp4', size: video.length }, edits }));
  const header = Buffer.alloc(16); header.write('SNIPFILE'); header.writeUInt32LE(2, 8); header.writeUInt32LE(manifest.length, 12);
  return Buffer.concat([header, manifest, video]);
}
let p;
try {
  p = await fresh(); await open(p); await seek(p, 2); await button(p, 'Split').click(); await seek(p, 6); await p.keyboard.press('s');
  await rightClick(p, 1);
  await p.getByText('Clip 2', { exact: true }).waitFor();
  await select(p, 'Clip speed', '1.75'); assert.equal((await stored(p)).clips[1].speed, 1.75);
  const input = await custom(p, 1.37); assert.equal((await stored(p)).clips[1].speed, 1.37);
  for (const value of ['', '0', '4.1', '-1']) {
    await input.fill(value); await input.press('Enter'); await p.getByRole('alert').getByText('Enter a speed from 0.25× to 4×.').waitFor();
    assert.equal((await stored(p)).clips[1].speed, 1.37);
  }
  await input.fill('1.63'); await input.press('Tab'); assert.equal((await stored(p)).clips[1].speed, 1.63);
  await close(p); await p.locator('.timeline-clip').nth(1).focus(); await p.keyboard.press('Shift+F10');
  await p.getByText('Clip 2', { exact: true }).waitFor(); assert.equal(await input.inputValue(), '1.63');
  await close(p); await p.locator('.timeline-clip').nth(0).dblclick({ position: { x: 50, y: 20 } }); await p.getByText('Clip 1', { exact: true }).waitFor();
  assert.equal((await stored(p)).clips[0].speed, undefined); await close(p);
  await p.locator('.timeline-clip').nth(1).click({ position: { x: 60, y: 25 } }); await blur(p); await p.keyboard.press(']'); assert.equal((await stored(p)).clips[1].speed, 1.75);
  await p.keyboard.press('['); assert.equal((await stored(p)).clips[1].speed, 1.5);
  log('Right-click, double-click and Shift+F10 open the chosen clip; 1.75× and custom speeds persist, validate and support adjacent speed shortcuts');

  await rightClick(p, 1); await zoom(p, 2);
  assert.equal(await p.getByRole('slider', { name: /Horizontal|Vertical/ }).count(), 0);
  const area = p.getByRole('group', { name: 'Zoom area', exact: true });
  const original = await area.locator('canvas').evaluate(c => {
    const pixels = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    return { width: c.width, height: c.height, varied: new Set(pixels).size > 10 };
  });
  assert(Math.abs(original.width / original.height - 16 / 9) < .01); assert(original.varied);
  const composition = await p.locator('.composition').boundingBox(), box = await area.boundingBox();
  for (const [x, y] of [[-40, -40], [box.width + 40, box.height + 40]]) {
    const selection = await p.locator('[data-zoom-selection]').boundingBox();
    assert(Math.abs(selection.width / box.width - .5) < .01); assert(Math.abs(selection.height / box.height - .5) < .01);
    const before = (await stored(p)).clips[1].zoom;
    await p.mouse.move(selection.x + selection.width / 2, selection.y + selection.height / 2); await p.mouse.down();
    await p.mouse.move(box.x + x, box.y + y, { steps: 8 }); await p.mouse.up();
    assert.deepEqual((await stored(p)).clips[1].zoom, { scale: 2, x: x < 0 ? 0 : 1, y: y < 0 ? 0 : 1 });
    await close(p); await button(p, 'Undo').click(); assert.deepEqual((await stored(p)).clips[1].zoom, before);
    await rightClick(p, 1);
  }
  await area.focus(); await area.press('Home'); await area.press('Shift+ArrowRight'); await area.press('ArrowUp');
  assert.deepEqual((await stored(p)).clips[1].zoom, { scale: 2, x: .6, y: .49 });
  const after = await p.locator('.composition').boundingBox(); assert.equal(after.width, composition.width); assert.equal(after.height, composition.height);
  await p.screenshot({ path: path.join(out, 'zoom-selection-dark.png'), fullPage: true });
  await p.setViewportSize({ width: 390, height: 844 });
  await p.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth); await p.screenshot({ path: path.join(out, 'zoom-selection-mobile.png'), fullPage: true });
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  log('Original-frame selection is visible, keeps its aspect ratio, clamps to all edges and moves with keyboard; one drag is one undo and output dimensions stay unchanged');

  if (process.env.FFMPEG_PATH && process.env.FFPROBE_PATH) {
    const ffmpeg = process.env.FFMPEG_PATH, ffprobe = process.env.FFPROBE_PATH, fixture = path.join(out, 'gradient.mp4');
    // A static gradient makes crop/position errors measurable independently of decoder frame timing.
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', "nullsrc=s=640x360:r=30,geq=r='255*X/W':g='255*Y/H':b='128+50*sin(X/40)'", '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '8', '-c:v', 'libx264', '-crf', '14', '-pix_fmt', 'yuv420p', '-c:a', 'aac', fixture]);
    p = await fresh(); await open(p, fixture); const edits = await stored(p);
    edits.clips = [
      { id: 'wide', start: 0, end: 2 },
      { id: 'left', start: 2, end: 4, speed: 1.75, zoom: { scale: 2, x: 0, y: 0 } },
      { id: 'right', start: 4, end: 6, speed: 1.37, zoom: { scale: 2, x: 1, y: 1 } },
      { id: 'wide-again', start: 6, end: 8 },
    ];
    await p.locator('#project-file').setInputFiles({ name: 'gradient.snip', mimeType: 'application/octet-stream', buffer: project(edits, fixture) });
    await p.waitForFunction(() => document.querySelectorAll('.timeline-clip').length === 4);
    const boundaries = [0, 2, 2 + 2 / 1.75, 2 + 2 / 1.75 + 2 / 1.37];
    const rects = [[0, 0, 640, 360], [0, 0, 320, 180], [320, 180, 320, 180], [0, 0, 640, 360]];
    const viewportAt = t => {
      const index = boundaries.findLastIndex(start => start <= t + .00001), from = rects[Math.max(0, index - 1)], to = rects[index];
      const progress = Math.min(1, Math.max(0, (t - boundaries[index]) / .55));
      const eased = progress ** 3 * (progress * (progress * 6 - 15) + 10);
      const width = from[2] * (to[2] / from[2]) ** eased, height = from[3] * (to[3] / from[3]) ** eased;
      const center = axis => from[axis] + from[axis + 2] / 2 + (to[axis] + to[axis + 2] / 2 - from[axis] - from[axis + 2] / 2) * eased;
      return [center(0) - width / 2, center(1) - height / 2, width, height];
    };
    for (const t of [2, 2.1, 2.2, 2.4, boundaries[2] + .13, boundaries[3] + .13, boundaries[3] + .4]) {
      const actualTime = await seek(p, t), expected = viewportAt(actualTime);
      const actual = await p.locator('video').evaluate(v => {
        const full = v.getBoundingClientRect(), view = v.parentElement.getBoundingClientRect();
        return [(view.x - full.x) / full.width * 640, (view.y - full.y) / full.height * 360, view.width / full.width * 640, view.height / full.height * 360];
      });
      actual.forEach((v, i) => assert(Math.abs(v - expected[i]) < .1, `Preview viewport at ${actualTime}: ${actual} vs ${expected}`));
    }
    log('Seeking shows the correct eased zoom-in, pan and zoom-out at clip boundaries without changing sequence length');
    await blur(p);
    const saved = await download(p, 'zoom-custom.snip', () => p.keyboard.press('Control+s'));
    await p.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await p.context().setOffline(true); await p.reload(); await p.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
    await p.locator('#project-file').setInputFiles({ name: 'zoom-custom.snip', mimeType: 'application/octet-stream', buffer: readFileSync(saved) });
    assert.deepEqual((await stored(p)).clips, edits.clips);
    await button(p, 'Export video').click(); await select(p, 'Export resolution', 'original');
    const encoded = await download(p, 'zoom-custom.mp4', () => button(p, 'Export & download').click());
    const probe = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-show_frames', '-of', 'json', encoded], { maxBuffer: 8e6 }));
    const video = probe.streams.find(s => s.codec_type === 'video'), audio = probe.streams.find(s => s.codec_type === 'audio');
    assert.equal(video.width, 640); assert.equal(video.height, 360); assert.equal(audio.codec_name, 'aac');
    assert(Math.abs(Number(probe.format.duration) - (boundaries[3] + 2)) < .08);
    assert(Math.abs(Number(video.duration) - Number(audio.duration)) < .08);
    const frames = probe.frames.filter(f => f.media_type === 'video'), results = [];
    for (const wanted of [2.09, 2.21, boundaries[2] + .1, boundaries[2] + .21, boundaries[3] + .1, boundaries[3] + .21]) {
      const n = frames.findIndex(f => Number(f.best_effort_timestamp_time) >= wanted), t = Number(frames[n].best_effort_timestamp_time);
      const [x, y, w, h] = viewportAt(t);
      const actual = execFileSync(ffmpeg, ['-v', 'error', '-i', encoded, '-vf', `select=eq(n\\,${n}),scale=80:45`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
      const expected = execFileSync(ffmpeg, ['-v', 'error', '-i', fixture, '-vf', `crop=${Math.round(w)}:${Math.round(h)}:${Math.round(x)}:${Math.round(y)},scale=80:45`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
      assert.equal(actual.length, expected.length);
      let difference = 0; for (let i = 0; i < actual.length; i++) difference += Math.abs(actual[i] - expected[i]); difference /= actual.length;
      assert(difference < 3.5, `Transition frame ${t} differs from independent crop by ${difference}`);
      results.push({ at: t, meanPixelDifference: difference });
    }
    log('Offline original-size export preserves custom speed, audio sync and project settings; six transition frames match independent crops', { duration: probe.format.duration, frames: results });
  }
  assert.deepEqual(errors, []); log('No browser errors');
  writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
} catch (error) {
  if (p) { console.error(await p.locator('body').innerText()); await p.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }); }
  throw error;
} finally { for (const c of contexts) await c.close(); await browser.close(); }
