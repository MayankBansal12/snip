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
  if (!await page.getByRole('dialog', { name: 'blur areas' }).isVisible()) await button('blur video').click();
  await page.getByRole('dialog', { name: 'blur areas' }).waitFor();
}
async function closeBlur() {
  await button('close blur').click();
  await page.getByRole('dialog', { name: 'blur areas' }).waitFor({ state: 'hidden' });
}
async function timeField(name, value) {
  const input = page.getByRole('textbox', { name: `blur ${name}`, exact: true });
  await input.fill(value); await input.press('Enter');
}
async function previewAt(time) {
  const control = page.getByRole('slider', { name: 'blur preview position', exact: true });
  const surface = control.locator('xpath=ancestor::*[contains(@class,"blur-slider-control")]');
  await surface.scrollIntoViewIfNeeded();
  const box = await surface.boundingBox();
  await surface.click({position:{x:8+(box.width-16)*time/4,y:box.height/2}});
  await page.waitForFunction(time => Math.abs(Number(document.querySelector('[aria-label="blur preview position"]')?.getAttribute("aria-valuenow"))-time)<.02,time);
}
try {
  await page.goto(process.env.APP_URL || 'http://127.0.0.1:5198');
  await page.locator('#video-file').setInputFiles({ name: 'source.mp4', mimeType: 'video/mp4', buffer: readFileSync(sample) });
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  await openBlur();
  assert.equal((await stored()).blurs.length, 0, 'Opening blur must not create an edit');
  await page.getByRole('slider', { name: 'blur preview position', exact: true }).press('End');
  await button('add your first blur').click();
  await waitStored('e.blurs.length === 1');
  const first = (await stored()).blurs[0];
  assert.equal(first.start, 0); assert.equal(first.end, 4);
  const area = page.getByRole('group', { name: 'blur 1 area' });
  const strength = page.getByRole('slider', { name: 'blur strength', exact: true });
  await strength.press('ArrowRight'); await waitStored('e.blurs[0].strength === 51');
  await strength.press('Control+z'); await waitStored('e.blurs[0].strength === 50');
  await area.click();
  assert.equal(await button('redo blur edit').isDisabled(), false, 'Selecting an area must preserve redo');
  await area.press('Control+Shift+z'); await waitStored('e.blurs[0].strength === 51');
  await area.press('Control+z'); await waitStored('e.blurs[0].strength === 50');
  await area.press('Backspace'); await waitStored('e.blurs.length === 0');
  await button('undo blur edit').click(); await waitStored('e.blurs.length === 1');
  const before = await area.boundingBox();
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down(); await page.mouse.move(before.x + before.width / 2 + 25, before.y + before.height / 2 + 15, { steps: 5 }); await page.mouse.up();
  await waitStored(`e.blurs[0].x > ${first.x}`);
  const moved = (await stored()).blurs[0];
  await button('resize blur 1 se').press('ArrowRight');
  await waitStored(`e.blurs[0].width > ${moved.width}`);
  await closeBlur();
  await button('undo').click(); await waitStored(`e.blurs[0].width === ${moved.width}`);
  await button('undo').click(); await waitStored(`e.blurs[0].x === ${first.x}`);
  await button('redo').click(); await waitStored(`e.blurs[0].x === ${moved.x}`);
  await button('redo').click();
  await openBlur();
  await page.getByRole('textbox', { name: 'blur name', exact: true }).fill('email');
  await page.getByRole('textbox', { name: 'blur name', exact: true }).press('Enter');
  await waitStored('e.blurs[0].name === "email"');
  const nameInput = page.getByRole('textbox', { name: 'blur name', exact: true });
  await nameInput.fill('discarded draft'); await nameInput.press('Escape');
  assert.equal(await nameInput.inputValue(), 'email');
  assert.equal(await page.getByRole('dialog', { name: 'blur areas' }).isVisible(), true);
  await timeField('start', '0:01.00'); await timeField('end', '0:03.00');
  const startInput = page.getByRole('textbox', { name: 'blur start', exact: true });
  await startInput.fill('0:2'); await startInput.press('Escape');
  assert.equal(await startInput.inputValue(), '0:01.00');
  assert.equal(await page.getByRole('dialog', { name: 'blur areas' }).isVisible(), true);
  await waitStored('e.blurs[0].start === 1 && e.blurs[0].end === 3');
  await page.getByRole('slider', { name: 'blur preview position', exact: true }).press('Home');
  assert.equal(await page.locator('.composition .blur-window').count(), 0);
  assert.equal(await page.getByRole('group', { name: 'email area' }).getAttribute('data-inactive'), 'true');
  await page.getByRole('slider', { name: 'blur range start', exact: true }).press('ArrowRight');
  await waitStored('Math.abs(e.blurs[0].start - 1.01) < 0.0001');
  await previewAt(1.5); await button('start here').click();
  await waitStored('Math.abs(e.blurs[0].start - 1.5) < 0.02');
  await previewAt(2.5); await button('end here').click();
  await waitStored('Math.abs(e.blurs[0].end - 2.5) < 0.02');
  await button('whole video').click(); await waitStored('e.blurs[0].start === 0 && e.blurs[0].end === 4');
  await button('this clip').click();
  await timeField('start', '0:01.00'); await timeField('end', '0:03.00');
  await button('add blur').click(); await waitStored('e.blurs.length === 2');
  await timeField('start', '0:02.50'); await timeField('end', '0:03.50');
  await waitStored('e.blurs[1].start === 2.5 && e.blurs[1].end === 3.5');
  await button('select email').click();
  assert.equal(await page.getByRole('textbox', { name: 'blur name', exact: true }).inputValue(), 'email');
  await button('select blur 1').click();
  await page.getByRole('slider', { name: 'blur strength', exact: true }).press('ArrowRight');
  await waitStored('e.blurs[1].strength === 51');
  await closeBlur(); await button('undo').click(); await waitStored('e.blurs[1].strength === 50');
  // Drags update the range without opening a popup in the middle of the gesture.
  const bar = await page.locator('.blur-bar').nth(1).boundingBox();
  await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2); await page.mouse.down();
  await page.mouse.move(bar.x + bar.width / 2 - 30, bar.y + bar.height / 2); await page.mouse.up();
  await waitStored('e.blurs[1].start < 2.5');
  assert.equal(await page.getByRole('dialog', { name: 'blur areas' }).isVisible(), false);
  await button('undo').click(); await waitStored('e.blurs[1].start === 2.5');
  await page.locator('.blur-bar').first().press('Enter');
  await page.getByRole('dialog', { name: 'blur areas' }).waitFor(); await closeBlur();

  // Trimming the tail exposes both a partial range and a fully outside range.
  const retained = (await stored()).blurs;
  const track = await page.locator('.clip-track').boundingBox(), handle = await page.getByRole('slider', { name: 'Clip 1 end' }).boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 - track.width / 2, handle.y + handle.height / 2); await page.mouse.up();
  await waitStored('Math.abs(e.clips[0].end - 2) < 0.01');
  assert.deepEqual((await stored()).blurs, retained);
  assert.equal(await page.locator('.blur-bar[data-clipped=true]').count(), 1);
  assert.equal(await page.locator('.blur-bar[data-outside=true]').count(), 1);
  await openBlur(); await button('select email').click();
  await page.getByRole('status').filter({ hasText: 'visible until' }).waitFor();
  await page.getByRole('slider', { name: 'blur range start', exact: true }).press('ArrowRight');
  await waitStored('e.blurs[0].start > 1 && e.blurs[0].end === 3');
  await button('undo blur edit').click(); await waitStored('e.blurs[0].start === 1 && e.blurs[0].end === 3');
  await button('fit to video').click(); await waitStored('e.blurs[0].start === 1 && Math.abs(e.blurs[0].end - 2) < 0.01');
  await button('select blur 1').click();
  await page.getByRole('status').filter({ hasText: 'this range starts after the video ends' }).waitFor();
  await button('fit to video').click(); await waitStored('Math.abs(e.blurs[1].start - 1) < 0.01 && Math.abs(e.blurs[1].end - 2) < 0.01');
  await closeBlur();
  await button('undo').click(); await waitStored('e.blurs[1].start === 2.5');
  await button('undo').click(); await waitStored('e.blurs[0].end === 3');
  await button('undo').click(); await waitStored('e.clips[0].end === 4');
  assert.deepEqual((await stored()).blurs, retained);
  // A head trim also leaves independent output timestamps unchanged.
  const head = await page.getByRole('slider', { name: 'Clip 1 start' }).boundingBox();
  await page.mouse.move(head.x + head.width / 2, head.y + head.height / 2); await page.mouse.down();
  await page.mouse.move(head.x + head.width / 2 + track.width / 4, head.y + head.height / 2); await page.mouse.up();
  await waitStored('Math.abs(e.clips[0].start - 1) < 0.01');
  assert.deepEqual((await stored()).blurs, retained);
  await button('undo').click(); await waitStored('e.clips[0].start === 0');

  await page.reload(); await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  await openBlur(); assert.equal(await button('select email').count(), 1);
  await button('select email').click();
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1280 ? 900 : width === 390 ? 844 : 700 });
    await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const popup = await page.getByRole('dialog', { name: 'blur areas' }).boundingBox();
    assert(popup.x >= -1 && popup.x + popup.width <= width + 1);
    await page.screenshot({ path: `${out}/editor-${width}.png`, fullPage: true });
    await strength.scrollIntoViewIfNeeded();
    const previewBox = await page.locator('.blur-editor-preview').boundingBox(), popupBox = await page.getByRole('dialog', { name: 'blur areas' }).boundingBox();
    assert(previewBox.y >= popupBox.y && previewBox.y + previewBox.height <= popupBox.y + popupBox.height, 'Preview must remain visible while adjusting strength');
    const listStyle = await page.locator('.blur-list').evaluate(element => ({ background: getComputedStyle(element).backgroundColor, overflow: getComputedStyle(element.parentElement).overflowX }));
    assert.notEqual(listStyle.background, 'rgba(0, 0, 0, 0)', 'Sticky list must hide scrolling settings behind it');
    assert.equal(listStyle.overflow, 'hidden', 'Settings should not have a horizontal scrollbar');
  }
  await button('add blur').click(); await waitStored('e.blurs.length === 3');
  const selectedBounds = await page.locator('.blur-list-item[data-selected=true]').boundingBox(), listBounds = await page.locator('.blur-list').boundingBox();
  assert(selectedBounds.x >= listBounds.x - 1 && selectedBounds.x + selectedBounds.width <= listBounds.x + listBounds.width + 1, 'Selected blur must scroll into view');
  await closeBlur(); await openBlur();
  await page.waitForFunction(() => {
    const list = document.querySelector('.blur-list'), item = list?.querySelector('[data-selected=true]');
    if (!item) return false;
    const bounds = list.getBoundingClientRect(), selected = item.getBoundingClientRect();
    return selected.left >= bounds.left - 1 && selected.right <= bounds.right + 1;
  });
  const reopenedBounds = await page.locator('.blur-list-item[data-selected=true]').boundingBox(), reopenedList = await page.locator('.blur-list').boundingBox();
  assert(reopenedBounds.x >= reopenedList.x - 1 && reopenedBounds.x + reopenedBounds.width <= reopenedList.x + reopenedList.width + 1, 'Reopening must reveal the selected blur');
  await button('undo blur edit').click(); await waitStored('e.blurs.length === 2');
  await button('select email').click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await button('delete blur').click(); await waitStored('e.blurs.length === 1');
  assert.equal(await button('select blur 1').count(), 1, 'Deleting another blur must not rename this blur');
  await closeBlur(); await button('undo').click(); await waitStored('e.blurs.length === 2');
  // On touch screens, short bars are covered by enlarged handles; a tap must still open them.
  const touchContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  try {
    const touchPage = await touchContext.newPage();
    touchPage.on('pageerror', error => errors.push(error.message));
    await touchPage.goto(process.env.APP_URL || 'http://127.0.0.1:5198');
    await touchPage.locator('#video-file').setInputFiles(sample);
    await touchPage.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
    await touchPage.getByRole('button', { name: 'blur video', exact: true }).click();
    await touchPage.getByRole('button', { name: 'add your first blur', exact: true }).click();
    for (const [name, value] of [['start', '2'], ['end', '2.1']]) {
      const field = touchPage.getByRole('textbox', { name: `blur ${name}`, exact: true });
      await field.fill(value); await field.press('Enter');
    }
    await touchPage.getByRole('button', { name: 'close blur', exact: true }).click();
    await touchPage.locator('.blur-bar').tap();
    await touchPage.getByRole('dialog', { name: 'blur areas' }).waitFor();
    assert.equal(await touchPage.getByRole('textbox', { name: 'blur name', exact: true }).inputValue(), 'blur 1');
  } finally { await touchContext.close(); }
  console.log('VERIFY popover, named regions, visual timing, trim handling, undo, persistence and responsive layout passed');

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
    for (const [time, active] of [[.25, []], [.75, [0]], [1.25, [0, 1]], [2, [1]], [2.75, []]]) {
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
