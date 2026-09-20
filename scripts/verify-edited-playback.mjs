import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { select } from './ui.mjs';

const sample = process.env.VIDEO_SAMPLE;
if (!sample) throw Error('Set VIDEO_SAMPLE to an 8-second video.');
const out = process.env.VERIFY_OUTPUT || '/tmp/snip-edited-playback';
mkdirSync(out, { recursive: true });
const browser = await chromium.connectOverCDP(process.env.CDP_URL || 'http://127.0.0.1:19384');
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'dark', acceptDownloads: true });
const page = await context.newPage(), errors = [], results = [];
page.setDefaultTimeout(15000); page.on('pageerror', e => errors.push(e.message));
const button = name => page.getByRole('button', { name, exact: true });
const blur = () => page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
async function seek(seconds) {
  const head = page.getByRole('slider', { name: 'Seek video', exact: true });
  await head.focus(); await head.press('Home');
  for (let i = 0; i < Math.floor(seconds); i++) await head.press('Shift+ArrowRight');
  for (let i = 0; i < Math.round(seconds % 1 * 30); i++) await head.press('ArrowRight');
  await blur(); await page.waitForFunction(() => !document.querySelector('video').seeking);
}
async function actions(index) {
  const box = await page.locator('.timeline-clip').nth(index).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + 25, { button: 'right' });
  await page.getByText(`Clip ${index + 1}`, { exact: true }).waitFor();
  await page.locator('[data-slot=popover-popup]').evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(a => a.finished.catch(() => {}))));
}
async function close() {
  await button('Close clip actions').click(); await page.locator('[data-slot=popover-popup]').waitFor({ state: 'hidden' }); await blur();
}
async function stored() {
  await page.getByRole('status').filter({ hasText: 'Saved on this device' }).waitFor();
  return page.evaluate(() => new Promise(resolve => {
    const r = indexedDB.open('snip-local-project', 1);
    r.onsuccess = () => { const db = r.result, t = db.transaction('project'), e = t.objectStore('project').get('edits'); e.onsuccess = () => resolve(e.result); t.oncomplete = () => db.close(); };
  }));
}
async function play(label, fromStart = true) {
  if (fromStart) await seek(0);
  await page.evaluate(() => {
    const v = document.querySelector('video'), start = performance.now();
    const trace = [], events = [], visited = [], shown = [];
    let previousTime = v.currentTime, lastProgress = start, lastPicture = start, maxProgressGap = 0, maxPictureGap = 0, frame;
    const state = () => {
      const head = document.querySelector('[aria-label="Seek video"]');
      return { wall: (performance.now() - start) / 1000, source: v.currentTime, sequence: Number(head.getAttribute('aria-valuenow')), total: Number(head.getAttribute('aria-valuemax')), rate: v.playbackRate, selected: document.querySelector('.timeline-clip.selected')?.getAttribute('aria-label'), paused: v.paused, seeking: v.seeking, ready: v.readyState };
    };
    const mediaEvent = e => events.push({ event: e.type, ...state() });
    const names = ['play', 'playing', 'pause', 'seeking', 'seeked', 'waiting', 'stalled', 'ended', 'error', 'ratechange'];
    for (const name of names) v.addEventListener(name, mediaEvent);
    const picture = (now, data) => {
      maxPictureGap = Math.max(maxPictureGap, now - lastPicture); lastPicture = now;
      shown.push({ wall: (now - start) / 1000, source: data.mediaTime }); frame = v.requestVideoFrameCallback(picture);
    };
    frame = v.requestVideoFrameCallback(picture);
    window.__playRun = { done: false };
    const finish = reason => {
      clearInterval(timer); v.cancelVideoFrameCallback(frame);
      for (const name of names) v.removeEventListener(name, mediaEvent);
      window.__playRun = { done: true, reason, trace, events, visited, displayedFrames: shown.length, maxProgressGapMs: maxProgressGap, maxPictureGapMs: maxPictureGap };
    };
    const timer = setInterval(() => {
      const s = state(), now = performance.now(); trace.push(s);
      if (s.selected && !visited.includes(s.selected)) visited.push(s.selected);
      if (Math.abs(s.source - previousTime) > .0001) { maxProgressGap = Math.max(maxProgressGap, now - lastProgress); lastProgress = now; previousTime = s.source; }
      if (s.paused && s.sequence >= s.total - .001) return finish('completed');
      if (s.wall > 1 && s.paused) return finish('unexpected pause');
      if (now - lastProgress > 2000) return finish('media time stalled');
      if (now - lastPicture > 2000) return finish('displayed frames stalled');
      if (s.wall > s.total * 3 + 10) finish('timeout');
    }, 50);
  });
  await button('Play').click();
  await page.waitForFunction(() => window.__playRun.done, {}, { timeout: 120000 });
  const run = await page.evaluate(() => window.__playRun);
  results.push({ label, ...run }); writeFileSync(path.join(out, 'runs.json'), JSON.stringify(results, null, 2));
  assert.equal(run.reason, 'completed', `${label}: ${run.reason}`);
  assert.equal(run.visited.length, 4, `${label}: missed a clip`);
  assert(run.displayedFrames > 30, `${label}: too few presented video frames`);
  console.log('PASS', label, JSON.stringify({ seconds: run.trace.at(-1).wall, clips: run.visited, displayedFrames: run.displayedFrames, maxProgressGapMs: run.maxProgressGapMs, maxPictureGapMs: run.maxPictureGapMs }));
}
try {
  await page.goto(process.env.APP_URL || 'http://127.0.0.1:5195'); await button('select your video').waitFor();
  const fileDialog = page.waitForEvent('filechooser'); await button('select your video').click();
  await (await fileDialog).setFiles({ name: 'four-clip-test.mp4', mimeType: 'video/mp4', buffer: readFileSync(sample) });
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  for (const second of [2, 4, 6]) { await seek(second); await button('Split').click(); }
  assert.equal(await page.locator('.timeline-clip').count(), 4);
  for (const [index, speed, scale, x, y] of [[1, '1.75', 2, 0, 0], [2, '0.5', 3, 1, 1], [3, 'custom', 1.5, .5, .5]]) {
    await actions(index);
    if (speed === 'custom') {
      await page.getByRole('combobox', { name: 'Clip speed', exact: true }).click(); await page.getByRole('option', { name: 'Custom…', exact: true }).click();
      const input = page.getByRole('spinbutton', { name: 'Custom speed', exact: true }); await input.fill('1.37'); await input.press('Enter');
    } else await select(page, 'Clip speed', speed);
    const slider = page.getByRole('slider', { name: 'Zoom', exact: true }); await slider.focus(); await slider.press('Home');
    for (let i = 0; i < Math.round((scale - 1) / .05); i++) await slider.press('ArrowRight');
    const area = await page.getByRole('group', { name: 'Zoom area', exact: true }).boundingBox(), selection = await page.locator('[data-zoom-selection]').boundingBox();
    await page.mouse.move(selection.x + selection.width / 2, selection.y + selection.height / 2); await page.mouse.down();
    await page.mouse.move(area.x + area.width * x, area.y + area.height * y, { steps: 8 }); await page.mouse.up();
    await close();
  }
  console.log('CREATED through upload, split buttons, speed controls and dragged zoom selections', JSON.stringify((await stored()).clips));
  await play('Four adjoining clips with zoom, 1.75×, 0.5× and custom 1.37× speed');
  await play('Replay from the edited end', false);
  // Trim with the visible clip handles, retaining the original edit interactions.
  for (const [index, edge, key, count] of [[0, 'end', 'ArrowLeft', 1], [1, 'end', 'ArrowLeft', 3], [2, 'start', 'ArrowRight', 2], [3, 'start', 'ArrowRight', 1]]) {
    await actions(index); await close();
    const handle = page.getByRole('slider', { name: `Clip ${index + 1} ${edge}`, exact: true }); await handle.focus();
    for (let i = 0; i < count; i++) await handle.press(key);
  }
  await blur(); const edits = await stored(); writeFileSync(path.join(out, 'edits.json'), JSON.stringify(edits, null, 2));
  await page.screenshot({ path: path.join(out, 'four-clips.png'), fullPage: true });
  await play('Four clips with three trimmed gaps, zoom and speed changes');
  const session = await context.newCDPSession(page); await session.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  await play('The same edited sequence with 6× CPU slowdown');
  await session.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await blur(); const downloading = page.waitForEvent('download'); await page.keyboard.press('Control+s');
  const saved = await downloading, file = path.join(out, 'four-clip-playback.snip'); await saved.saveAs(file); assert.equal(await saved.failure(), null);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller); await context.setOffline(true); await page.reload();
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2 && !document.querySelector('video').seeking);
  await play('Offline playback after refresh restores all four clips');
  await page.locator('#project-file').setInputFiles({ name: 'four-clip-playback.snip', mimeType: 'application/octet-stream', buffer: readFileSync(file) });
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2 && !document.querySelector('video').seeking);
  assert.deepEqual((await stored()).clips, edits.clips);
  await play('Offline playback after importing the saved project');
  assert.deepEqual(errors, []);
  writeFileSync(path.join(out, 'report.json'), JSON.stringify({ app: await page.locator('script[type=module]').getAttribute('src'), clips: edits.clips, runs: results.map(({ label, reason, displayedFrames, maxProgressGapMs, maxPictureGapMs }) => ({ label, reason, displayedFrames, maxProgressGapMs, maxPictureGapMs })), errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }); console.error(await page.locator('body').innerText()); throw error;
} finally { await context.close(); await browser.close(); }
