import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const out = process.env.VERIFY_OUTPUT || '/tmp/snip-blur';
mkdirSync(out, { recursive: true });
const sample = `${out}/source.mp4`;
execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', "nullsrc=s=320x180:r=20:d=4,geq=lum='if(mod(floor(X/4)+floor(Y/4),2),235,16)':cb=128:cr=128", '-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv420p', sample]);
const browser = await chromium.connectOverCDP(process.env.CDP_URL || 'http://127.0.0.1:9223');
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.text().startsWith('VERIFY')) console.log(message.text()); });
page.setDefaultTimeout(15000);
const button = name => page.getByRole('button', { name, exact: true });
const stored = () => page.evaluate(async () => (await (await import('/src/storage.ts')).restoreProject()).edits);
async function waitStored(check) {
  await page.waitForFunction(async predicate => {
    const edits = (await (await import('/src/storage.ts')).restoreProject())?.edits;
    return edits && new Function('e', `return ${predicate}`)(edits);
  }, check);
}

async function openBlur() {
  if (await button('blur').getAttribute('aria-expanded') !== 'true') await button('blur').click();
  await page.locator('.blur-popover').waitFor({ state: 'visible' });
}
async function addBlur() { await openBlur(); await button('add blur').click(); }
async function editBlur(name) { await openBlur(); await button(`edit ${name}`).click(); }
async function doneBlur() { await openBlur(); await button('done editing blur').click(); await page.locator('.blur-popover').waitFor({ state: 'hidden' }); }
async function timingBlur() { await button('edit blur timing').click(); await page.locator('.blur-popover').waitFor({ state: 'hidden' }); }
async function arrow(name, key, count = 1) {
  const handle = page.getByRole('slider', { name, exact: true });
  for (let i = 0; i < count; i++) await handle.press(key);
}
try {
  await page.goto(process.env.APP_URL || 'http://127.0.0.1:5198');
  await page.locator('#video-file').setInputFiles(sample);
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  assert.equal(await page.locator('.blur-bar').count(), 0);
  assert.equal(await page.locator('.blur-context').count(), 0);
  assert.equal(await page.getByText('no blur on this clip', { exact: true }).count(), 0);
  await openBlur(); assert.equal((await stored()).blurs.length, 0, 'Opening blur must not create an area');
  await addBlur(); await waitStored('e.blurs.length === 1');
  const first = (await stored()).blurs[0];
  assert.equal(first.start, 0); assert.equal(first.end, 4);
  assert.equal(await page.locator('video').count(), 1);
  assert.equal(await page.locator('.blur-bar').count(), 1);
  assert.equal(await page.getByRole('textbox', { name: 'blur name' }).count(), 0);
  assert.equal(await page.locator('.composition .blur-selection[data-editing=true]').count(), 0, 'The main preview must stay clean');
  await doneBlur();
  const seekEnd = page.getByRole('slider', { name: 'seek video', exact: true });
  await seekEnd.press('End');
  assert.equal(await page.locator('.composition .blur-window').count(), 1, 'Seeking to the end must keep the last frame blurred');
  await openBlur();
  assert.equal(await seekEnd.getAttribute('aria-valuenow'), '4', 'Opening blur at the end must not jump back to its start');
  assert.equal(await page.locator('.blur-area-preview .blur-window').count(), 1);
  assert.equal(await page.getByRole('group', { name: 'blur 1 area', exact: true }).getAttribute('data-inactive'), 'false');
  await doneBlur();
  await seekEnd.press('ArrowLeft'); await seekEnd.press('ArrowLeft');
  await button('play').click();
  await button('play').waitFor({ state: 'visible' });
  assert.equal(await seekEnd.getAttribute('aria-valuenow'), '4');
  assert.equal(await page.locator('.composition .blur-window').count(), 1, 'Playback completion must leave its final frame blurred');
  await seekEnd.press('Home'); await openBlur();
  const area = page.getByRole('group', { name: 'blur 1 area' });
  const before = await area.boundingBox();
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down(); await page.mouse.move(before.x + before.width / 2 + 15, before.y + before.height / 2 + 10, { steps: 5 }); await page.mouse.up();
  await waitStored(`e.blurs[0].x > ${first.x}`);
  const moved = (await stored()).blurs[0];
  await button('resize blur 1 se').press('ArrowRight'); await waitStored(`e.blurs[0].width > ${moved.width}`);
  await area.press('Control+z'); await waitStored(`e.blurs[0].width === ${moved.width}`);
  await area.press('Control+z'); await waitStored(`e.blurs[0].x === ${first.x}`);
  await area.click(); assert.equal(await button('redo').isDisabled(), false, 'Selection must preserve redo');
  await area.press('Control+Shift+z'); await waitStored(`e.blurs[0].x === ${moved.x}`);
  const strength = page.getByRole('slider', { name: 'blur strength', exact: true });
  await strength.press('ArrowRight'); await waitStored('e.blurs[0].strength === 51');
  await strength.press('Control+z'); await waitStored('e.blurs[0].strength === 50');
  await strength.press('Control+Shift+z'); await waitStored('e.blurs[0].strength === 51');
  await timingBlur();
  await arrow('blur 1 start', 'ArrowRight', 10); await arrow('blur 1 end', 'ArrowLeft', 10);
  await waitStored('Math.abs(e.blurs[0].start - 1) < .001 && Math.abs(e.blurs[0].end - 3) < .001');
  await doneBlur(); assert.equal(await page.locator('.blur-bar').count(), 0);
  await seekEnd.press('End');
  assert.equal(await page.locator('.composition .blur-window').count(), 0, 'A blur that ends before the video must not reappear');
  await page.getByRole('slider', { name: 'seek video', exact: true }).press('Home');
  assert.equal(await page.locator('.composition .blur-window').count(), 0);
  await editBlur('blur 1'); assert.equal(await area.getAttribute('data-inactive'), 'false', 'Selecting an inactive blur should seek into its range');
  await addBlur(); await waitStored('e.blurs.length === 2');
  assert.equal((await stored()).blurs[1].start, 0); assert.equal((await stored()).blurs[1].end, 4);
  assert.equal(await page.locator('.blur-bar').count(), 1, 'Only the selected blur has a range bar');
  await timingBlur();
  await arrow('blur 2 start', 'ArrowRight', 25); await arrow('blur 2 end', 'ArrowLeft', 5);
  await waitStored('Math.abs(e.blurs[1].start - 2.5) < .001 && Math.abs(e.blurs[1].end - 3.5) < .001');
  const retained = (await stored()).blurs;
  await doneBlur();
  const track = await page.locator('.clip-track').boundingBox(), handle = await page.getByRole('slider', { name: 'Clip 1 end', exact: true }).boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 - track.width / 2, handle.y + handle.height / 2); await page.mouse.up();
  await waitStored('Math.abs(e.clips[0].end - 2) < .01');
  await waitStored('e.blurs.length === 1 && Math.abs(e.blurs[0].start - 1) < .001 && Math.abs(e.blurs[0].end - 2) < .01');
  await button('undo').click(); await waitStored('e.clips[0].end === 4 && e.blurs.length === 2');
  assert.deepEqual((await stored()).blurs, retained);
  await editBlur('blur 1'); await doneBlur();
  await page.getByRole('button', { name: 'edit blur 1 in preview', exact: true }).click();
  await page.locator('.blur-popover').waitFor({ state: 'visible' });
  await timingBlur();
  const film = await page.locator('.clip-track').boundingBox();
  await page.locator('.timeline-clip').click({ position: { x: film.width * .65, y: 32 } });
  assert.equal(await page.locator('.blur-bar').count(), 1, 'Scrubbing must keep timing editable');
  await doneBlur();
  await page.getByRole('slider', { name: 'seek video', exact: true }).press('Home');
  await page.getByRole('slider', { name: 'seek video', exact: true }).press('Shift+ArrowRight');
  await button('split').click(); await waitStored('e.clips.length === 2');
  await addBlur(); await waitStored('e.blurs.length === 3');
  assert.equal((await stored()).blurs[2].start, 1); assert.equal((await stored()).blurs[2].end, 4);
  await doneBlur();
  const originalY = (await page.locator('.clip-track').boundingBox()).y;
  await page.locator('.timeline-clip').first().click();
  assert(Math.abs((await page.locator('.clip-track').boundingBox()).y - originalY) < 1);
  assert.equal(await page.getByText('no blur on this clip', { exact: true }).count(), 0);
  assert.equal(await page.locator('.timeline-clip.selected .clip-effects-indicator').count(), 0);
  await openBlur(); assert.equal(await button('edit blur 3').count(), 0, 'Popover effects are scoped to the clip');
  await doneBlur();
  await page.locator('.timeline-clip').nth(1).click();
  assert.equal(await page.locator('.timeline-clip.selected .clip-effects-indicator').innerText(), '3');
  await editBlur('blur 3');
  for (const [width, height] of [[1280, 900], [390, 844], [320, 700]]) {
    await page.setViewportSize({ width, height });
    await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const popup = await page.locator('.blur-popover').boundingBox();
    assert(popup.x >= 0 && popup.x + popup.width <= width + 1);
    assert(popup.y >= 0 && popup.y + popup.height <= height + 1);
    await page.waitForFunction(() => {
      const row = document.querySelector('.blur-effect-chips'), selected = row?.querySelector('[data-selected=true]');
      if (!selected) return false;
      const r = row.getBoundingClientRect(), s = selected.getBoundingClientRect();
      return s.left >= r.left && s.right <= r.right;
    });
    await page.screenshot({ path: `${out}/popover-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await button('delete blur').click(); await waitStored('e.blurs.length === 2');
  await page.locator('.blur-popover').press('Control+z'); await waitStored('e.blurs.length === 3');
  await page.keyboard.press('Escape'); await page.locator('.blur-popover').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.blur-bar').count(), 0);
  await page.reload(); await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  assert.equal((await stored()).blurs.length, 3); assert.equal(await page.locator('.blur-bar').count(), 0);
  console.log('VERIFY compact blur popover, geometry, timing, undo, clean timeline and persistence passed');

  for (const [width, height] of [[320, 700], [390, 844]]) {
    const touchContext = await browser.newContext({ viewport: { width, height }, hasTouch: true });
    try {
      const touch = await touchContext.newPage();
      touch.on('pageerror', error => errors.push(error.message));
      await touch.goto(process.env.APP_URL || 'http://127.0.0.1:5198');
      await touch.locator('#video-file').setInputFiles(sample);
      await touch.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
      const seek = touch.getByRole('slider', { name: 'seek video', exact: true });
      await seek.press('Home'); await seek.press('Shift+ArrowRight');
      await touch.getByRole('button', { name: 'split', exact: true }).click();
      await touch.locator('.timeline-toolbar').scrollIntoViewIfNeeded();
      const hitTargets = await touch.locator('.timeline-toolbar button').evaluateAll(buttons => buttons.filter(b => !b.disabled && b.getClientRects().length).map(b => {
        const r = b.getBoundingClientRect();
        return { name: b.getAttribute('aria-label') || b.textContent, correct: document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('button') === b };
      }));
      assert(hitTargets.every(b => b.correct), `${width}px toolbar targets overlap: ${JSON.stringify(hitTargets)}`);
      const tap = async name => {
        const box = await touch.getByRole('button', { name, exact: true }).boundingBox();
        await touch.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      };
      await tap('blur');
      await touch.locator('.blur-popover').waitFor({ state: 'visible' });
      await tap('add blur');
      await touch.waitForFunction(async () => {
        const e = (await (await import('/src/storage.ts')).restoreProject())?.edits;
        return e?.clips.length === 2 && e.blurs.length === 1;
      });
      const slider = touch.getByRole('slider', { name: 'blur strength', exact: true });
      await slider.press('ArrowRight');
      await touch.waitForFunction(async () => (await (await import('/src/storage.ts')).restoreProject())?.edits.blurs[0].strength === 51);
      await tap('edit blur timing'); await touch.locator('.blur-popover').waitFor({ state: 'hidden' });
      await touch.getByRole('slider', { name: 'blur 1 start', exact: true }).press('ArrowRight');
      await touch.waitForFunction(async () => (await (await import('/src/storage.ts')).restoreProject())?.edits.blurs[0].start > 1);
      await touch.screenshot({ path: `${out}/timing-touch-${width}.png`, fullPage: true });
      await tap('blur'); await tap('done editing blur');
      await touch.locator('.timeline-toolbar').scrollIntoViewIfNeeded();
      await tap('merge');
      await touch.waitForFunction(async () => {
        const e = (await (await import('/src/storage.ts')).restoreProject())?.edits;
        return e?.clips.length === 1 && e.blurs.length === 1;
      });
    } finally { await touchContext.close(); }
  }
  console.log('VERIFY touch popover, strength, timeline timing and toolbar at 320px and 390px');

  const boundaryContext = await browser.newContext();
  try {
    const boundary = await boundaryContext.newPage();
    boundary.on('pageerror', error => errors.push(error.message));
    await boundary.goto(process.env.APP_URL || 'http://127.0.0.1:5198');
    await boundary.locator('#video-file').setInputFiles(sample);
    await boundary.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
    const seek = boundary.getByRole('slider', { name: 'seek video', exact: true });
    const b = name => boundary.getByRole('button', { name, exact: true });
    await seek.press('Home'); await seek.press('Shift+ArrowRight'); await seek.press('Shift+ArrowRight');
    await b('split').click(); await boundary.locator('.timeline-clip').first().click();
    await b('blur').click(); await b('add blur').click(); await b('done editing blur').click();
    await seek.press('Home'); await seek.press('Shift+ArrowRight'); await seek.press('Shift+ArrowRight');
    assert.equal(await boundary.locator('.composition .blur-window').count(), 0, 'The next clip must be clear at a cut');
    await b('blur').click(); await b('add blur').click(); await b('done editing blur').click();
    await b('speed 1×').click(); await b('2×').click(); await b('close speed').click();
    await seek.press('End');
    assert.equal(await seek.getAttribute('aria-valuenow'), '3');
    assert.equal(await boundary.locator('.composition .blur-window').count(), 1, 'The final frame stays covered after changing speed');
    await boundary.getByRole('slider', { name: 'Clip 2 end', exact: true }).press('ArrowLeft');
    await seek.press('End');
    assert.equal(await seek.getAttribute('aria-valuenow'), '2.95');
    assert.equal(await boundary.locator('.composition .blur-window').count(), 1, 'The final frame stays covered after trimming');
  } finally { await boundaryContext.close(); }
  console.log('VERIFY blur persists at playback end, seek end, speed and trim boundaries; cuts stay exclusive');

  const outputs = await page.evaluate(async bytes => {
    const { readMetadata } = await import('/src/media.ts');
    const { defaults } = await import('/src/types.ts');
    const { exportVideo, canCopyPicture } = await import('/src/export.ts');
    const { nativeExport } = await import('/src/native-export.ts');
    const { createProjectFile, readProjectFile } = await import('/src/project-file.ts');
    const source = await readMetadata(new File([new Uint8Array(bytes)], 'source.mp4', { type: 'video/mp4' }));
    const edits = { ...defaults(4), clips: [{ id: 'a', start: 0, end: 2, speed: 2 }, { id: 'b', start: 2, end: 4 }], blurs: [
      { id: 'one', x: .1, y: .15, width: .3, height: .4, start: .5, end: 1.5, strength: 80 },
      { id: 'two', x: .6, y: .3, width: .25, height: .45, start: 1, end: 2.5, strength: 60 },
      { id: 'overlap', x: .3, y: .4, width: .35, height: .2, start: 1.1, end: 1.4, strength: 90 },
      { id: 'tiny', x: .99, y: .99, width: .005, height: .005, start: 0, end: .1, strength: 100 },
      { id: 'ending', x: .6, y: .3, width: .25, height: .45, start: 2.9, end: 3, strength: 60 },
    ] };
    if (canCopyPicture(source, { ...defaults(4), blurs: edits.blurs })) throw Error('Blur bypassed rendering');
    const project = createProjectFile(source, edits);
    const restored = await readProjectFile(new File([project.blob], project.name));
    if (JSON.stringify(restored.edits.blurs) !== JSON.stringify(edits.blurs)) throw Error('Project file lost blurs');
    const result = {};
    const native = await nativeExport(source, edits, () => {}, async () => null, new AbortController().signal);
    if (!native) throw Error('Native blur export unavailable');
    result.native = Array.from(new Uint8Array(await native.arrayBuffer()));
    console.log('VERIFY native rendered');
    for (const format of ['mp4', 'webm']) {
      const blob = await exportVideo(source, { ...edits, format }, () => {});
      result[format] = Array.from(new Uint8Array(await blob.arrayBuffer()));
      console.log('VERIFY ' + format + ' rendered');
    }
    return result;
  }, Array.from(readFileSync(sample)));

  const frame = (file, time) => execFileSync('ffmpeg', ['-v', 'error', '-ss', String(time), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1e6 });
  const sharp = frame(sample, .25);
  const difference = (actual, bounds) => {
    let sum = 0, count = 0;
    for (let y = bounds[1]; y < bounds[3]; y++) for (let x = bounds[0]; x < bounds[2]; x++) {
      const i = (y * 320 + x) * 3; sum += Math.abs(actual[i] - sharp[i]); count++;
    }
    return sum / count;
  };
  const regions = [[40, 35, 100, 65], [205, 65, 260, 120], [8, 140, 45, 170]];
  for (const [name, bytes] of Object.entries(outputs)) {
    const file = `${out}/${name}.${name === 'webm' ? 'webm' : 'mp4'}`;
    writeFileSync(file, Buffer.from(bytes));
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', file]));
    const video = probe.streams.find(s => s.codec_type === 'video');
    assert.equal(video.width, 320); assert.equal(video.height, 180);
    for (const [time, active] of [[.25, []], [.75, [0]], [1.25, [0, 1]], [2, [1]], [2.75, []], [2.95, [1]]]) {
      const actual = frame(file, time);
      regions.forEach((region, index) => {
        const diff = difference(actual, region);
        assert(active.includes(index) ? diff > 65 : diff < 12, `${name} at ${time}s, region ${index}: difference ${diff}`);
      });
    }
  }
  assert.deepEqual(errors, []);
  console.log('VERIFY blur pixels and timing passed for native MP4, FFmpeg MP4 and WebM');
} catch(error) {
  await page.screenshot({path:`${out}/failure.png`,fullPage:true});console.log(await page.locator("body").ariaSnapshot());throw error;
} finally {
  await context.close(); await browser.close();
}
