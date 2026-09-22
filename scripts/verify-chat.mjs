import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const sample = process.env.VIDEO_SAMPLE;
if (!sample) throw new Error('Set VIDEO_SAMPLE to an eight-second video with audio. This check makes live Jev requests.');
const browser = await chromium.connectOverCDP(process.env.CDP_URL || 'http://127.0.0.1:9223', { timeout: 10000 });
const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 1000 } });
const page = await context.newPage(); page.setDefaultTimeout(20000);
// Analytics is provided by Vercel, not the local preview server.
await page.route('**/_vercel/**', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
const errors = []; page.on('pageerror', error => errors.push(error.stack || error.message));
const output = process.env.VERIFY_OUTPUT || '/tmp/snip-chat-verification'; mkdirSync(output, { recursive: true });
const url = process.env.SNIP_URL || 'http://127.0.0.1:52945';
const chat = page.getByRole('region', { name: 'edit with chat' });
const prompt = page.getByRole('textbox', { name: 'what would you like to change?' });
const status = chat.locator('div[role=status]');
async function saved() {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('snip-local-project', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, read = db.transaction('project').objectStore('project').get('edits');
      read.onsuccess = () => { db.close(); resolve(read.result); }; read.onerror = () => reject(read.error);
    };
  }));
}
async function submit(text) {
  await prompt.fill(text);
  const response = page.waitForResponse(r => r.url().endsWith('/api/edit') && r.request().method() === 'POST');
  await prompt.press('Enter');
  const result = await response;
  await page.waitForFunction(() => !document.querySelector('[aria-label="cancel edit"]'));
  return { status: result.status(), result: await result.json() };
}
async function waitSaved(check) {
  for (let n = 0; n < 40; n++) { const result = await saved(); if (check(result)) return result; await page.waitForTimeout(50); }
  assert.fail('Expected edits were not saved');
}
try {
  await page.goto(url);
  await page.getByRole('button', { name: 'select your video', exact: true }).waitFor();
  await page.locator('#video-file').setInputFiles(sample);
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  await page.getByRole('tab', { name: 'chat', exact: true }).click();
  await page.screenshot({ path: `${output}/desktop.png`, fullPage: true });
  const original = await saved();
  const fast = await submit('make the video 2x faster');
  assert.equal(fast.status, 200, JSON.stringify(fast.result));
  await waitSaved(e => e.clips[0].speed === 2);
  assert.match(await status.innerText(), /speed 2×/);
  await chat.getByRole('button', { name: 'undo', exact: true }).click();
  await waitSaved(e => (e.clips[0].speed ?? e.speed) === 1);
  await chat.getByRole('button', { name: 'redo', exact: true }).click();
  await waitSaved(e => e.clips[0].speed === 2);
  await chat.getByRole('button', { name: 'undo', exact: true }).click();
  await waitSaved(e => (e.clips[0].speed ?? e.speed) === 1);
  console.log('PASS real Jev speed edit, one-step undo and redo');

  const plainSplit = await submit('split at 4 seconds');
  assert.equal(plainSplit.status, 200, JSON.stringify(plainSplit.result));
  await waitSaved(e => e.clips.length === 2 && e.clips[0].end === 4);
  await chat.getByRole('button', { name: 'undo', exact: true }).click();
  await waitSaved(e => e.clips.length === 1);
  console.log('PASS plain split prompt');

  const compound = await submit('split at 4 seconds and make the second clip 2x faster');
  assert.equal(compound.status, 200, JSON.stringify(compound.result));
  await waitSaved(e => e.clips.length === 2 && e.clips[1].speed === 2);
  const clipSelector = chat.getByRole('combobox', { name: 'inspect clip' });
  assert.match(await clipSelector.innerText(), /clip 2/);
  await clipSelector.click();
  await page.getByRole('option', { name: 'clip 1', exact: true }).click();
  assert.match(await clipSelector.innerText(), /clip 1/);
  await page.waitForFunction(() => document.querySelector('video').currentTime === 0);
  await page.getByRole('tab', { name: 'timeline', exact: true }).click();
  assert.equal(await page.locator('.timeline-clip').count(), 2);
  await page.getByRole('tab', { name: 'chat', exact: true }).click();
  await chat.getByRole('button', { name: 'undo', exact: true }).click();
  await waitSaved(e => e.clips.length === 1 && (e.clips[0].speed ?? e.speed) === 1);
  console.log('PASS compound edit is reflected in timeline and undone atomically');

  const centered = await submit('trim 5 seconds and apply 2x zoom in middle');
  assert.equal(centered.status, 200, JSON.stringify(centered.result));
  await waitSaved(e => e.clips[0].start === 5 && e.clips[0].zoom.scale === 2);
  assert.match(await status.innerText(), /removed first 5s.*center/);
  const positioned = await submit('zoom needs to be in top left side');
  assert.equal(positioned.status, 200, JSON.stringify(positioned.result));
  await waitSaved(e => e.clips[0].zoom.scale === 2 && e.clips[0].zoom.x === 0 && e.clips[0].zoom.y === 0);
  assert.equal(await page.locator('.source-window video').evaluate(v => v.style.transform), 'scale(2, 2) translate(0%, 0%)');
  const zoomButton = chat.getByRole('button', { name: 'zoom 2× · top left', exact: true });
  await zoomButton.click();
  const area = page.getByRole('group', { name: 'zoom area', exact: true });
  await area.waitFor();
  const selection = area.locator('[data-zoom-selection]');
  assert.deepEqual(await selection.evaluate(e => [e.style.left,e.style.top,e.style.width,e.style.height]), ['0%','0%','50%','50%']);
  assert(await area.locator('canvas').evaluate(c => new Set(c.getContext('2d').getImageData(0,0,c.width,c.height).data).size > 10));
  const frame = await area.boundingBox(), box = await selection.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(frame.x + frame.width, frame.y + frame.height, { steps: 5 }); await page.mouse.up();
  await waitSaved(e => e.clips[0].zoom.x === 1 && e.clips[0].zoom.y === 1);
  await page.screenshot({path:`${output}/zoom-focus.png`,fullPage:true});
  await page.getByRole('button', {name:'close zoom',exact:true}).click();
  await chat.getByRole('button', {name:'undo',exact:true}).click();
  await waitSaved(e => e.clips[0].zoom.x === 0 && e.clips[0].zoom.y === 0);
  await chat.getByRole('button', {name:'undo',exact:true}).click();
  await waitSaved(e => e.clips[0].zoom.x === .5 && e.clips[0].zoom.y === .5);
  await chat.getByRole('button', {name:'undo',exact:true}).click();
  await waitSaved(e => e.clips[0].start === 0 && (e.clips[0].zoom?.scale ?? 1) === 1);
  console.log('PASS exact trim/zoom prompts, visible focus, crop-box adjustment and one-step undo');

  const rejected = await submit('mute the audio and add subtitles');
  assert.equal(rejected.status, 422);
  assert.equal((await saved()).muted, original.muted);
  assert.equal(await prompt.inputValue(), 'mute the audio and add subtitles');
  console.log('PASS unsupported combined request changes nothing and retains prompt');

  let release, intercepted;
  const ready = new Promise(resolve => intercepted = resolve);
  await page.route('**/api/edit', async route => {
    const request = route.request().postDataJSON();
    await new Promise(resolve => { release = resolve; intercepted(); });
    await route.fulfill({ json: { batch: { requestId: request.requestId, sessionId: request.sessionId, revision: request.revision, commands: [{ action: 'setSpeed', clipId: request.project.selectedClip, speed: 3 }] }, summary: 'speed 3×' } });
  });
  await prompt.fill('make it 3x faster'); await prompt.press('Enter'); await ready;
  await page.getByRole('tab', { name: 'timeline', exact: true }).click();
  await page.getByRole('button', { name: 'mute video', exact: true }).click();
  release();
  await page.getByRole('tab', { name: 'chat', exact: true }).click();
  await status.getByText(/timeline changed/).waitFor();
  assert.equal((await saved()).clips[0].speed, 1); assert.equal((await saved()).muted, true);
  await page.unroute('**/api/edit');
  console.log('PASS stale response cannot overwrite a manual edit');

  let cancelReady;
  const cancelIntercept = new Promise(resolve => cancelReady = resolve);
  await page.route('**/api/edit', async route => {
    await new Promise(resolve => { release = resolve; cancelReady(); });
    await route.fulfill({ status: 503, json: { error: 'late response' } }).catch(() => {});
  });
  await prompt.fill('make it 3x faster'); await prompt.press('Enter'); await cancelIntercept;
  await page.getByRole('button', { name: 'cancel edit', exact: true }).click(); release();
  await status.getByText(/cancelled/).waitFor(); assert.match(await status.innerText(), /cancelled/); assert.equal((await saved()).clips[0].speed, 1);
  await page.unroute('**/api/edit');
  console.log('PASS cancellation preserves video and prompt');

  await page.route('**/api/edit', route => route.fulfill({ status: 503, json: { error: 'Jev is busy right now. Try again in a moment.' } }));
  await submit('mute the audio'); assert.match(await status.innerText(), /jev is busy/i);
  await page.unroute('**/api/edit');
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.screenshot({ path: `${output}/mobile.png`, fullPage: true });
  await page.evaluate(() => { localStorage.setItem('snip-theme', 'dark'); });
  await page.reload(); await page.getByRole('tab', { name: 'chat', exact: true }).click();
  await page.screenshot({ path: `${output}/mobile-dark.png`, fullPage: true });
  await chat.getByRole('button', { name: 'zoom 1× · full frame', exact: true }).click();
  await page.getByRole('group', { name: 'zoom area', exact: true }).waitFor();
  const mobilePopup = await page.getByRole('dialog', { name: 'zoom · clip 1' }).boundingBox();
  assert(mobilePopup.x >= 0 && mobilePopup.x + mobilePopup.width <= 391);
  await page.screenshot({ path: `${output}/mobile-zoom.png`, fullPage: true });
  await page.getByRole('button', { name: 'close zoom', exact: true }).click();
  assert.equal((await saved()).muted, true);
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('PASS server failure, mobile layout, dark theme and reload persistence');
} finally { await context.close(); await browser.close(); }
