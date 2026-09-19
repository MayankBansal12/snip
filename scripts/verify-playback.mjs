import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const sample = process.env.VIDEO_SAMPLE;
if (!sample) throw Error('Set VIDEO_SAMPLE to an 8-second video.');
const app = process.env.APP_URL || 'http://127.0.0.1:5195', out = process.env.VERIFY_OUTPUT || '/tmp/snip-playback';
mkdirSync(out, { recursive: true });
const browser = await chromium.connectOverCDP(process.env.CDP_URL || 'http://127.0.0.1:19384');
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage();
const errors = [], report = [];
page.on('pageerror', e => errors.push(e.message)); page.setDefaultTimeout(15000);
await page.addInitScript(() => {
  const raf = window.requestAnimationFrame.bind(window), cancel = window.cancelAnimationFrame.bind(window), pending = new Map(); let next = 0;
  // Throttle frame callbacks without blocking decoding or native media events.
  window.requestAnimationFrame = callback => {
    const id = ++next, timer = setTimeout(() => {
      const native = raf(t => { pending.delete(id); callback(t); }); pending.set(id, { native });
    }, window.__frameDelay || 0);
    pending.set(id, { timer }); return id;
  };
  window.cancelAnimationFrame = id => { const item = pending.get(id); if (item) { clearTimeout(item.timer); if (item.native) cancel(item.native); pending.delete(id); } };
  window.addEventListener('timeupdate', e => { if (window.__suppressTimeUpdate) e.stopImmediatePropagation(); }, true);
});
const log = (check, details = {}) => { report.push({ check, ...details }); console.log('PASS', check, details); };
const button = name => page.getByRole('button', { name, exact: true });
let base;
function project(clips) {
  const video = readFileSync(sample), manifest = Buffer.from(JSON.stringify({ savedAt: new Date().toISOString(), source: { name: 'playback.mp4', type: 'video/mp4', size: video.length }, edits: { ...base, clips } }));
  const header = Buffer.alloc(16); header.write('SNIPFILE'); header.writeUInt32LE(2, 8); header.writeUInt32LE(manifest.length, 12);
  return Buffer.concat([header, manifest, video]);
}
async function load(clips) {
  await page.evaluate(() => { window.__frameDelay = 0; window.__suppressTimeUpdate = false; window.__pauseAtSeek = false; });
  await page.locator('#project-file').setInputFiles({ name: 'playback.snip', mimeType: 'application/octet-stream', buffer: project(clips) });
  await page.getByRole('status').filter({ hasText: 'Saved on this device' }).waitFor();
  await page.waitForFunction(() => { const v = document.querySelector('video'); return v?.readyState >= 2 && !v.seeking; });
  await page.evaluate(() => {
    window.__events = []; window.__visited = [];
    const video = document.querySelector('video');
    const observe = () => { const label = document.querySelector('.timeline-clip.selected')?.getAttribute('aria-label'); if (label && !window.__visited.includes(label)) window.__visited.push(label); };
    window.__observer?.disconnect(); window.__observer = new MutationObserver(observe);
    window.__observer.observe(document.querySelector('.clip-track'), { subtree: true, attributes: true, attributeFilter: ['aria-pressed'] }); observe();
    window.__cleanup?.();
    const log = e => {
      window.__events.push({ event: e.type, time: video.currentTime, rate: video.playbackRate, paused: video.paused });
      if (e.type === 'seeking' && window.__pauseAtSeek && video.currentTime >= 2) {
        window.__pauseAtSeek = false; document.querySelector('button[aria-label="Pause"]')?.click();
      }
    };
    const events = ['play', 'pause', 'seeking', 'seeked', 'ended', 'ratechange'];
    for (const name of events) video.addEventListener(name, log);
    window.__cleanup = () => { for (const name of events) video.removeEventListener(name, log); };
  });
}
async function finish(clips) {
  await page.waitForFunction(() => {
    const head = document.querySelector('[aria-label="Seek video"]');
    return document.querySelector('video').paused && Math.abs(Number(head.getAttribute('aria-valuemax')) - Number(head.getAttribute('aria-valuenow'))) < .00001;
  });
  await button('Play').waitFor();
  const data = await page.evaluate(() => ({ events: window.__events, visited: window.__visited }));
  for (let i = 0; i < clips.length; i++) assert(data.visited.some(s => s.startsWith(`Clip ${i + 1},`)), `Skipped clip ${i + 1}: ${JSON.stringify(data)}`);
  return data;
}
try {
  await page.goto(app); await button('Open a video').waitFor();
  await page.locator('#video-file').setInputFiles({ name: 'sample.mp4', mimeType: 'video/mp4', buffer: readFileSync(sample) });
  await page.getByRole('status').filter({ hasText: 'Saved on this device' }).waitFor();
  base = await page.evaluate(() => new Promise(resolve => { const r = indexedDB.open('snip-local-project', 1); r.onsuccess = () => { const db = r.result, t = db.transaction('project'), e = t.objectStore('project').get('edits'); e.onsuccess = () => resolve(e.result); t.oncomplete = () => db.close(); }; }));
  const adjacent = [
    { id: 'a', start: 0, end: .2, speed: 4 },
    { id: 'b', start: .2, end: .4, speed: .25, zoom: { scale: 2, x: 0, y: 0 } },
    { id: 'c', start: .4, end: .6, speed: 1.75, zoom: { scale: 3, x: 1, y: 1 } },
    { id: 'd', start: .6, end: 1, speed: 1.37 },
  ];
  await load(adjacent); await button('Play').click(); const first = await finish(adjacent);
  assert(!first.events.some(e => e.event === 'seeking' && e.time < .999), JSON.stringify(first.events));
  for (const rate of [.25, 1.75, 1.37]) assert(first.events.some(e => e.event === 'ratechange' && e.rate === rate));
  await button('Play').click(); await finish(adjacent);
  log('Short adjoining clips with speeds from 0.25× to 4× and different zooms play and replay without boundary seeks');

  const gaps = [
    { id: 'a', start: 0, end: .3, speed: 4 },
    { id: 'b', start: 2, end: 2.4, speed: .5, zoom: { scale: 2, x: .2, y: .8 } },
    { id: 'c', start: 4, end: 4.1, speed: 4, zoom: { scale: 3, x: 1, y: 1 } },
    { id: 'd', start: 6, end: 7, speed: 1.37 },
  ];
  await load(gaps); await button('Play').click(); const trimmed = await finish(gaps);
  for (const start of [2, 4, 6]) assert(trimmed.events.some(e => e.event === 'seeking' && Math.abs(e.time - start) < .01));
  log('Playback crosses trimmed gaps with changing speed and zoom, visits every clip and stops at the edited end');

  const late = [ { id: 'a', start: 7, end: 7.6, speed: 4 }, { id: 'b', start: 7.8, end: 8, speed: .5, zoom: { scale: 2, x: 1, y: 1 } } ];
  await load(late); await page.evaluate(() => { window.__frameDelay = 1200; }); await button('Play').click(); await finish(late);
  log('Delayed animation frames do not strand playback at a clip boundary; media progress events keep the sequence moving');
  await load(late); await page.evaluate(() => { window.__frameDelay = 1200; window.__suppressTimeUpdate = true; });
  await button('Play').click(); const recovered = await finish(late);
  assert(recovered.events.some(e => e.event === 'play' && e.rate === .5));
  log('A native source-ended event recovers the next clip even when frame callbacks and timeupdate both miss the boundary');

  await load(gaps); await page.evaluate(() => { window.__pauseAtSeek = true; }); await button('Play').click();
  await page.waitForFunction(() => !window.__pauseAtSeek && document.querySelector('video').paused && !document.querySelector('video').seeking);
  const stopped = await page.locator('video').evaluate(v => v.currentTime); await page.waitForTimeout(450);
  assert.equal(await page.locator('video').evaluate(v => v.paused), true); assert(Math.abs(await page.locator('video').evaluate(v => v.currentTime) - stopped) < .01);
  await button('Play').click(); await finish(gaps);
  log('Pausing during a gap seek cancels automatic resume; an explicit Play continues the sequence');
  assert.deepEqual(errors, []); log('No browser errors');
  writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
} catch (error) {
  writeFileSync(path.join(out, 'failure.json'), JSON.stringify(await page.evaluate(() => ({ events: window.__events, visited: window.__visited, text: document.body.innerText })), null, 2)); throw error;
} finally { await context.close(); await browser.close(); }
