import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const sample = process.env.VIDEO_SAMPLE;
if (!sample) throw new Error('Set VIDEO_SAMPLE to a local video.');
const app = process.env.APP_URL || 'http://127.0.0.1:5195';
const out = process.env.VERIFY_OUTPUT || '/tmp/snip-start-screen';
mkdirSync(out, { recursive: true });
const browser = await chromium.connectOverCDP(process.env.CDP_URL || 'http://127.0.0.1:19384');
const contexts = [], errors = [], report = [];
const log = check => { report.push({ check }); console.log('PASS', check); };
const bytes = readFileSync(sample).toString('base64');
const fixture = { name: 'pasted-video.mp4', type: 'video/mp4', bytes };
async function fresh() {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, colorScheme: 'dark' });
  contexts.push(context);
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(app);
  await page.waitForFunction(() => !document.querySelector('button[aria-label="Open a video"]')?.disabled);
  return page;
}
async function transfer(page, type, files = [], text = '') {
  return page.evaluate(({ type, files, text }) => {
    const data = new DataTransfer();
    if (text) data.setData('text/plain', text);
    for (const file of files) data.items.add(new File([Uint8Array.from(atob(file.bytes), c => c.charCodeAt(0))], file.name, { type: file.type }));
    const event = type === 'paste'
      ? new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
      : new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true });
    // Body intentionally sits outside React's root: pasting must work without focusing a control.
    (type === 'paste' ? document.body : document.querySelector('.app')).dispatchEvent(event);
    return event.defaultPrevented;
  }, { type, files, text });
}
async function loaded(page) {
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  assert.equal(await page.getByRole('banner').count(), 1);
  assert.equal(await page.locator('.start-screen').count(), 0);
}
try {
  const page = await fresh();
  assert.equal(await page.getByRole('banner').count(), 0);
  assert.equal(await page.getByRole('navigation').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Keyboard shortcuts', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button').count(), 3);
  assert.equal(await page.getByRole('heading', { name: 'snip.', exact: true }).count(), 1);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(out, 'start-dark.png'), fullPage: true });
  await page.getByRole('button', { name: 'Switch to light mode', exact: true }).click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  await page.screenshot({ path: path.join(out, 'start-light.png'), fullPage: true });
  await page.reload();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  log('Minimal start screen has only theme, upload, and open-project controls; theme persists');

  for (const viewport of [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const box = await page.getByRole('button', { name: 'Open a video', exact: true }).boundingBox();
    assert(box.width > 250 && box.x >= 0 && box.x + box.width <= viewport.width);
    await page.screenshot({ path: path.join(out, `start-${viewport.width}.png`), fullPage: true });
  }
  log('Start screen and upload target fit phones and landscape without horizontal overflow');

  assert.equal(await transfer(page, 'paste', [], 'ordinary clipboard text'), false);
  assert.equal(await page.getByRole('alert').count(), 0);
  await transfer(page, 'paste', [{ name: 'empty.mp4', type: 'video/mp4', bytes: '' }]);
  await page.getByRole('alert').filter({ hasText: 'This file is empty' }).waitFor();
  await page.getByRole('button', { name: 'Dismiss error', exact: true }).click();
  await transfer(page, 'paste', [{ name: 'image.png', type: 'image/png', bytes: 'eA==' }]);
  await page.getByRole('alert').filter({ hasText: 'Choose a video' }).waitFor();
  await page.getByRole('button', { name: 'Dismiss error', exact: true }).click();
  log('Text paste is left alone; unsupported and empty pasted files use existing validation');

  assert.equal(await transfer(page, 'paste', [{ name: 'image.png', type: 'image/png', bytes: 'eA==' }, fixture]), true);
  await loaded(page);
  assert.equal(await page.locator('.file-info').textContent().then(text => text.includes('pasted-video.mp4')), true);
  assert.equal(await page.locator('video').evaluate(video => video.duration), 8);
  assert.equal(await transfer(page, 'paste', [{ name: 'replacement.mp4', type: 'video/mp4', bytes: '' }]), false);
  assert.equal(await page.getByRole('alert').count(), 0);
  await page.reload();
  await loaded(page);
  assert.match(await page.locator('.file-info').textContent(), /pasted-video.mp4/);
  log('Pasting a video opens the editor, saves across refresh, and cannot replace an active project');

  const upload = await fresh();
  const choosing = upload.waitForEvent('filechooser');
  await upload.getByRole('button', { name: 'Open a video', exact: true }).click();
  await (await choosing).setFiles(sample);
  await loaded(upload);
  log('Clicking the upload area opens a file picker and imports a video');

  const drop = await fresh();
  await transfer(drop, 'drop', [{ ...fixture, name: 'dropped-video.mp4' }]);
  await loaded(drop);
  assert.match(await drop.locator('.file-info').textContent(), /dropped-video.mp4/);
  log('Dropping a video anywhere on the start screen imports it');

  const project = await fresh();
  const projectChooser = project.waitForEvent('filechooser');
  await project.getByRole('button', { name: 'Open project', exact: true }).click();
  assert.equal((await projectChooser).isMultiple(), false);
  log('Open project remains available through its file picker');
  assert.deepEqual(errors, []);
  log('No browser errors');
  writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
} finally {
  for (const context of contexts) await context.close();
  await browser.close();
}
