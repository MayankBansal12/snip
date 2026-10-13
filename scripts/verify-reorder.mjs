import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const sample = process.env.VIDEO_SAMPLE;
if (!sample) throw Error('Set VIDEO_SAMPLE to an 8-second video with audio.');
const out = process.env.VERIFY_OUTPUT || '/tmp/snip-reorder';
mkdirSync(out, { recursive: true });
const browser = await chromium.connectOverCDP(process.env.CDP_URL || 'http://127.0.0.1:9223');
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const page = await context.newPage(), errors = [], checks = [];
page.on('pageerror', e => errors.push(e.message));
const button = name => page.getByRole('button', { name, exact: true });
const log = name => { checks.push(name); console.log('PASS', name); };
const stored = () => page.evaluate(() => new Promise(resolve => {
  const r = indexedDB.open('snip-local-project', 1);
  r.onsuccess = () => { const db = r.result, t = db.transaction('project'), q = t.objectStore('project').get('edits'); q.onsuccess = () => resolve(q.result); t.oncomplete = () => db.close(); };
}));
async function waitStore(predicate) {
  for (let i = 0; i < 100; i++) { const e = await stored(); if (e && predicate(e)) return e; await page.waitForTimeout(50); }
  throw Error('stored edits did not match');
}
async function order(ids) {
  await waitStore(e => JSON.stringify(e.clips.map(c => c.id)) === JSON.stringify(ids));
  assert.deepEqual(await page.locator('.timeline-clip').evaluateAll(els => els.map(e => e.dataset.clipId)), ids);
}
const clip = id => page.locator(`[data-clip-id="${id}"]`);
async function dragStart(id) {
  const box = await clip(id).locator('.clip-reorder').boundingBox();
  assert(box, 'drag handle is visible');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  return box;
}
async function dragTo(id, x, y) { await dragStart(id); await page.mouse.move(x, y, { steps: 12 }); await page.mouse.up(); }
async function menu(id, name) { await clip(id).focus(); await button('move clip').click(); await page.getByRole('menuitem', { name, exact: true }).click(); }
async function saveDownload(download, file) {
  if (process.env.DOWNLOAD_FS_ROOT) {
    const downloadPath = await download.path();
    assert.equal(await download.failure(), null);
    copyFileSync(path.join(process.env.DOWNLOAD_FS_ROOT, downloadPath), file);
  } else await download.saveAs(file);
}
async function key(value) { await page.evaluate(() => document.activeElement?.blur()); await page.keyboard.press(value); }
async function seek(seconds) {
  const head = page.getByRole('slider', { name: 'seek video', exact: true });
  await head.focus(); await head.press('Home'); for (let i = 0; i < seconds; i++) await head.press('Shift+ArrowRight');
}
try {
  await page.goto(process.env.APP_URL || 'http://127.0.0.1:5199');
  await page.locator('#video-file').setInputFiles(sample);
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  assert(await button('move clip').isDisabled());
  assert.equal(await page.locator('.clip-reorder').count(), 0);
  for (const t of [2, 4, 6]) { await seek(t); await button('split').click(); }
  const base = await waitStore(e => e.clips.length === 4), ids = base.clips.map(c => c.id);
  await clip(ids[1]).focus(); await key('x'); await key('z');
  const adjusted = await waitStore(e => e.clips[1].speed === 1.25 && e.clips[1].zoom?.scale === 1.25);
  await page.waitForFunction(() => document.querySelectorAll('.clip-thumbnails img').length >= 4);
  const box = await page.locator('.clip-track').boundingBox();
  await dragStart(ids[1]); await page.mouse.move(box.x + box.width - 4, box.y + 25, { steps: 15 });
  assert.equal(await page.locator('.clip-drop-slot').count(), 1);
  await page.waitForTimeout(50);
  const lifted = await page.locator('.clip-drag-preview').boundingBox();
  await page.mouse.move(box.x + box.width - 14, box.y + 35); await page.waitForTimeout(50);
  const followed = await page.locator('.clip-drag-preview').boundingBox();
  assert(Math.abs(followed.x - lifted.x + 10) < 1 && Math.abs(followed.y - lifted.y - 10) < 1, 'preview follows pointer 1:1 even within the same destination');
  await order(ids); // No live mutation while dragging.
  await page.mouse.up(); await order([ids[0], ids[2], ids[3], ids[1]]);
  assert.equal(await clip(ids[1]).getAttribute('aria-pressed'), 'true');
  assert(Math.abs(await page.locator('video').evaluate(v => v.currentTime) - 2) < .02);
  assert.deepEqual((await stored()).clips.at(-1), adjusted.clips[1]);
  log('Drag inserts across multiple clips, preserves adjustments, and follows the moved clip');
  await button('undo').click(); await order(ids); await button('redo').click(); await order([ids[0], ids[2], ids[3], ids[1]]);
  await button('undo').click(); await order(ids);
  log('Each drop is one undo step and redo restores the insertion');
  await dragTo(ids[3], box.x + 3, box.y + 25); await order([ids[3], ...ids.slice(0, 3)]);
  await button('undo').click(); await order(ids);
  log('Dragging last to first inserts rather than swapping endpoints');
  const body = await clip(ids[2]).boundingBox();
  await page.mouse.move(body.x + body.width / 2, body.y + 20); await page.mouse.down();
  await page.mouse.move(box.x + 4, body.y + 20, { steps: 12 });
  await page.locator('.clip-drag-preview').waitFor(); await page.waitForTimeout(180);
  assert(await page.locator('.clip-drag-preview .clip-thumbnails img').count() > 0);
  assert.equal(await clip(ids[2]).evaluate(el => getComputedStyle(el).opacity), '0');
  assert(await clip(ids[0]).evaluate(el => el.getBoundingClientRect().x) > box.x + 40);
  await order(ids);
  await page.mouse.up(); await order([ids[2], ids[0], ids[1], ids[3]]);
  await button('undo').click(); await order(ids);
  log('Dragging the clip body lifts real thumbnails and makes neighbors move aside without editing until drop');
  await dragStart(ids[0]); await page.mouse.move(box.x + box.width - 5, box.y + 25, { steps: 8 }); await page.keyboard.press('Escape'); await page.mouse.up(); await order(ids);
  await page.locator('.clip-drop-slot,.clip-drag-preview').waitFor({ state: 'hidden' });
  await dragTo(ids[0], box.x + box.width - 5, box.y - 120); await order(ids);
  await dragStart(ids[0]); await page.mouse.up(); await order(ids);
  await dragTo(ids[0], box.x + box.width * .1, box.y + 25); await order(ids);
  await button('undo').click(); await waitStore(e => e.clips[1].zoom?.scale === 1); await button('redo').click(); await waitStore(e => e.clips[1].zoom?.scale === 1.25);
  log('Escape, outside drops, clicks and same-position drops add no undo entry');
  await menu(ids[1], 'move to last'); await order([ids[0], ids[2], ids[3], ids[1]]);
  await menu(ids[1], 'move to first'); await order([ids[1], ids[0], ids[2], ids[3]]);
  await button('move clip').click(); assert.equal(await page.getByRole('menuitem', { name: 'move earlier', exact: true }).getAttribute('aria-disabled'), 'true');
  await page.keyboard.press('Escape'); await menu(ids[1], 'move later'); await order(ids);
  await menu(ids[1], 'move earlier'); await order([ids[1], ids[0], ids[2], ids[3]]);
  await key('Alt+ArrowDown'); await order(ids);
  log('All four menu actions, boundary disabling and existing shortcuts work');
  await seek(1);
  const overlap = await clip(ids[0]).locator('.clip-reorder').boundingBox();
  assert(await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.clip-reorder'), { x: overlap.x + overlap.width / 2, y: overlap.y + overlap.height / 2 }));
  await dragTo(ids[0], box.x + box.width - 5, box.y + 25); await order([...ids.slice(1), ids[0]]);
  await button('undo').click(); await order(ids);
  log('Drag handle wins hit testing when the playhead crosses its center');
  await seek(0); await key('Space'); await page.waitForFunction(() => !document.querySelector('video').paused);
  await button('move clip').click(); await page.waitForTimeout(2200);
  assert(await page.locator('video').evaluate(v => v.paused));
  await page.getByRole('menuitem', { name: 'move to last', exact: true }).click(); await order([...ids.slice(1), ids[0]]);
  assert.equal(await clip(ids[0]).getAttribute('aria-pressed'), 'true');
  assert(Math.abs(await page.locator('video').evaluate(v => v.currentTime)) < .02);
  await button('undo').click(); await order(ids);
  log('Opening Move pauses playback and keeps its target fixed across clip boundaries');
  // Menu operates on selection even when the playhead is in a different clip.
  await seek(0); await clip(ids[2]).focus(); await menu(ids[2], 'move to first'); await order([ids[2], ids[0], ids[1], ids[3]]);
  assert.equal(await clip(ids[2]).getAttribute('aria-pressed'), 'true'); await button('undo').click(); await order(ids);
  await button('timeline zoom').click(); await page.getByRole('menuitemradio', { name: '4× closer', exact: true }).click();
  await page.locator('.timeline-scroll').evaluate(e => e.scrollLeft = 0);
  const view = await page.locator('.timeline-scroll').boundingBox();
  await dragStart(ids[0]); await page.mouse.move(view.x + view.width - 8, box.y + 25, { steps: 10 });
  await page.waitForTimeout(1500);
  assert(await page.locator('.timeline-scroll').evaluate(e => e.scrollLeft > 100));
  await page.keyboard.press('Escape'); await page.mouse.up(); await order(ids);
  await button('timeline zoom').click(); await page.getByRole('menuitemradio', { name: 'fit timeline', exact: true }).click();
  log('Dragging near the viewport edge scrolls a zoomed timeline; cancellation preserves order');
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 }); await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await menu(ids[0], 'move to last'); await order([...ids.slice(1), ids[0]]);
    await button('undo').click(); await order(ids);
    await page.screenshot({ path: path.join(out, `reorder-${width}.png`), fullPage: true });
  }
  log('Move menu remains reachable at 320, 390 and 768px without overflow');
  await page.setViewportSize({ width: 390, height: 844 }); await seek(0);
  const badge = await clip(ids[0]).locator('.clip-reorder').boundingBox(), ruler = await page.locator('.ruler').boundingBox();
  await page.mouse.click(badge.x + badge.width / 2, ruler.y + 6);
  assert(await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.clip-reorder'), { x: badge.x + badge.width / 2, y: badge.y + badge.height / 2 }));
  log('Settled motion leaves the mobile number badge above a crossing playhead');
  await page.setViewportSize({ width: 1280, height: 900 });
  await clip(ids[2]).focus(); // Touch users select a clip before its grip is revealed.
  const touchSession = await context.newCDPSession(page);
  const handle = await clip(ids[2]).locator('.clip-reorder').boundingBox(), track = await page.locator('.clip-track').boundingBox();
  await touchSession.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }] });
  await touchSession.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: track.x + 5, y: track.y + 25 }] });
  await touchSession.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await order([ids[2], ids[0], ids[1], ids[3]]);
  log('Real Chromium touch events reorder through the grip');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const beforeReduced = (await stored()).clips.map(c => c.id), reducedTrack = await page.locator('.clip-track').boundingBox();
  await dragTo(ids[3], reducedTrack.x + 5, reducedTrack.y + 25); await order([ids[3], ...beforeReduced.filter(id => id !== ids[3])]);
  await page.locator('.clip-drag-preview').waitFor({ state: 'hidden' });
  await button('undo').click(); await order(beforeReduced); await page.emulateMedia({ reducedMotion: 'no-preference' });
  log('Reduced motion keeps drag feedback and insertion while skipping settling animations');
  const expected = (await stored()).clips;
  const saving = page.waitForEvent('download'); await key('Control+s'); const project = await saving;
  const projectFile = path.join(out, 'reordered.snip'); await saveDownload(project, projectFile);
  const file = readFileSync(projectFile), length = file.readUInt32LE(12);
  assert.deepEqual(JSON.parse(file.subarray(16, 16 + length)).edits.clips, expected);
  await page.reload(); await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2); await order(expected.map(c => c.id));
  await page.locator('#project-file').setInputFiles(projectFile); await page.getByText('project opened', { exact: true }).waitFor(); await order(expected.map(c => c.id));
  log('Autosave refresh and portable project round trip retain clip order and adjustments');
  await seek(0); await key('Space'); await page.waitForFunction(() => document.querySelector('video').ended || Number(document.querySelector('[aria-label="seek video"]').getAttribute('aria-valuenow')) > 7.5, null, { timeout: 20000 });
  await key('Space');
  log('Reordered sequence plays through backwards source jumps and mixed speeds');
  for (const format of ['mp4', 'webm']) {
    await button('export video').click();
    if (format === 'webm') {
      await page.getByRole('combobox', { name: 'export format', exact: true }).click();
      await page.getByRole('option', { name: 'webm · vp8', exact: true }).click();
    }
    const exporting = page.waitForEvent('download', { timeout: 180000 }); await button('export & download').click();
    const exported = await exporting, exportFile = path.join(out, `reordered.${format}`); await saveDownload(exported, exportFile);
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', exportFile], { encoding: 'utf8' }));
    assert(probe.streams.some(s => s.codec_type === 'audio'));
    assert(Math.abs(Number(probe.format.duration) - 7.6) < .1);
    const frame = (file, time) => execFileSync('ffmpeg', ['-v', 'error', '-ss', String(time), '-i', file, '-frames:v', '1', '-vf', 'scale=64:36', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    for (const [sequenceTime, sourceTime] of [[.5, 4.5], [2.5, .5], [6.6, 7]]) {
      const actual = frame(exportFile, sequenceTime), reference = frame(sample, sourceTime);
      let difference = 0; for (let i = 0; i < actual.length; i++) difference += Math.abs(actual[i] - reference[i]);
      assert(difference / actual.length < 12, `${format} export frame at ${sequenceTime}s follows reordered source (${difference / actual.length})`);
    }
    log(`${format.toUpperCase()} has expected duration, audio, and independently verified reordered frames`);
    await button('back to editing').click(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
  }
  assert.deepEqual(errors, []);
  writeFileSync(path.join(out, 'report.json'), JSON.stringify({ checks, errors }, null, 2));
} finally { await context.close(); await browser.close(); }
