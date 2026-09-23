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
const url = process.env.SNIP_URL || 'http://127.0.0.1:52947';
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
  await page.getByRole('button', {name:'switch to chat',exact:true}).click();
  assert.equal(await chat.getByRole('button').count(), 3);
  assert.equal(await chat.getByRole('combobox').count(), 0);
  assert(!/powered by|prompt and edit settings|what would you like to change/.test(await chat.innerText()));
  assert((await chat.boundingBox()).height < 90);
  await page.screenshot({ path: `${output}/desktop.png`, fullPage: true });
  const panel = page.getByRole('region', {name:'video editor',exact:true});
  assert.equal(await page.getByRole('tablist').count(),0);
  assert.equal(await panel.locator('[data-slot=card]').count(),0);
  const panelBounds=await panel.boundingBox(), switchBounds=await panel.getByRole('button',{name:'switch to timeline'}).boundingBox();
  assert(switchBounds.x>panelBounds.x+panelBounds.width/2 && switchBounds.y<panelBounds.y+40);
  await prompt.fill('draft survives switching');
  await page.getByRole('button',{name:'switch to timeline',exact:true}).click();
  await page.getByRole('button',{name:'switch to chat',exact:true}).click();
  assert.equal(await prompt.inputValue(),'draft survives switching');
  await prompt.fill('');
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

  // Read the actual paused video time, even if React's last playback tick differs.
  await page.locator('.source-window video').evaluate(v => { v.currentTime = 1.25; });
  await page.waitForFunction(() => { const v = document.querySelector('.source-window video'); return v.currentTime === 1.25 && !v.seeking; });
  const relativeRequest = page.waitForRequest(r => r.url().endsWith('/api/edit') && r.method() === 'POST');
  const relativeSplit = await submit('split 3 seconds after');
  assert.equal((await relativeRequest).postDataJSON().project.time, 1.25);
  assert.equal(relativeSplit.status, 200, JSON.stringify(relativeSplit.result));
  await waitSaved(e => e.clips.length === 2 && e.clips[0].end === 4.25 && e.clips[1].start === 4.25);
  assert.match(await status.innerText(), /split at 4.25s.*3s after the playhead/);
  await chat.getByRole('button', { name: 'undo', exact: true }).click();
  await waitSaved(e => e.clips.length === 1);
  console.log('PASS relative split captures the current playhead and undoes atomically');

  const compound = await submit('split at 4 seconds and make the second clip 2x faster');
  assert.equal(compound.status, 200, JSON.stringify(compound.result));
  await waitSaved(e => e.clips.length === 2 && e.clips[1].speed === 2);
  await page.getByRole('button', {name:'switch to timeline',exact:true}).click();
  assert.equal(await page.locator('.timeline-clip').count(), 2);
  await page.getByRole('button', {name:'switch to chat',exact:true}).click();
  await chat.getByRole('button', { name: 'undo', exact: true }).click();
  await waitSaved(e => e.clips.length === 1 && (e.clips[0].speed ?? e.speed) === 1);
  console.log('PASS compound edit is reflected in timeline and undone atomically');

  const ordered = await submit('split at 2 seconds, zoom the first clip to 1.5x, make the second clip 2x faster, split at 4 seconds, and zoom the last part to 3x');
  assert.equal(ordered.status, 200, JSON.stringify(ordered.result));
  assert.deepEqual(ordered.result.changes.map(c => c.action), ['split','zoom','speed','split','zoom']);
  const planned = await waitSaved(e => e.clips.length === 3 && e.clips[2].zoom?.scale === 3);
  assert.deepEqual(planned.clips.map(c => [c.start,c.end,c.speed,c.zoom?.scale]), [[0,2,1,1.5],[2,6,2,1],[6,8,2,3]]);
  await page.getByRole('button', {name:'switch to timeline',exact:true}).click();
  assert.equal(await page.locator('.timeline-clip').count(),3);
  await page.getByRole('button', {name:'switch to chat',exact:true}).click();
  await chat.getByRole('button', {name:'undo',exact:true}).click();
  await waitSaved(e => e.clips.length === 1 && (e.clips[0].speed ?? e.speed) === 1 && (e.clips[0].zoom?.scale ?? 1) === 1);
  await chat.getByRole('button', {name:'redo',exact:true}).click();
  await waitSaved(e => e.clips.length === 3 && e.clips[2].zoom?.scale === 3);
  await chat.getByRole('button', {name:'undo',exact:true}).click();
  await waitSaved(e => e.clips.length === 1);
  console.log('PASS ordered repeated edits, new-part targeting and atomic undo/redo');

  const magnified = await submit('2x zoom and 2x speed for clip 1');
  assert.equal(magnified.status, 200, JSON.stringify(magnified.result));
  await waitSaved(e => e.clips[0].zoom?.scale === 2 && e.clips[0].speed === 2);
  const reset = await submit('1x zoom and 1x speed for clip 1');
  assert.equal(reset.status, 200, JSON.stringify(reset.result));
  assert.deepEqual(reset.result.changes.map(c => c.action), ['zoom','speed']);
  await waitSaved(e => e.clips[0].zoom?.scale === 1 && e.clips[0].speed === 1);
  await chat.getByRole('button', {name:'undo',exact:true}).click();
  await waitSaved(e => e.clips[0].zoom?.scale === 2 && e.clips[0].speed === 2);
  await chat.getByRole('button', {name:'undo',exact:true}).click();
  await waitSaved(e => (e.clips[0].zoom?.scale ?? 1) === 1 && (e.clips[0].speed ?? e.speed) === 1);
  console.log('PASS number-led zoom/speed reset and atomic undo');

  const centered = await submit('trim 5 seconds and apply 2x zoom in middle');
  assert.equal(centered.status, 200, JSON.stringify(centered.result));
  await waitSaved(e => e.clips[0].start === 5 && e.clips[0].zoom.scale === 2);
  assert.match(await status.innerText(), /removed first 5s.*center/);
  const positioned = await submit('zoom needs to be in top left side');
  assert.equal(positioned.status, 200, JSON.stringify(positioned.result));
  await waitSaved(e => e.clips[0].zoom.scale === 2 && e.clips[0].zoom.x === 0 && e.clips[0].zoom.y === 0);
  assert.equal(await page.locator('.source-window video').evaluate(v => v.style.transform), 'scale(2, 2) translate(0%, 0%)');
  await page.getByRole('button', {name:'switch to timeline',exact:true}).click();
  const zoomButton = page.getByRole('button', { name: 'zoom 2×', exact: true });
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
  await page.getByRole('button', {name:'switch to chat',exact:true}).click();
  await chat.getByRole('button', {name:'undo',exact:true}).click();
  await waitSaved(e => e.clips[0].zoom.x === 0 && e.clips[0].zoom.y === 0);
  await chat.getByRole('button', {name:'undo',exact:true}).click();
  await waitSaved(e => e.clips[0].zoom.x === .5 && e.clips[0].zoom.y === .5);
  await chat.getByRole('button', {name:'undo',exact:true}).click();
  await waitSaved(e => e.clips[0].start === 0 && (e.clips[0].zoom?.scale ?? 1) === 1);
  console.log('PASS exact trim/zoom prompts, visible focus, crop-box adjustment and one-step undo');

  const rejected = await submit('mute the audio and add subtitles');
  assert.equal(rejected.status, 422);assert.equal(rejected.result.ok,false);assert.equal(rejected.result.error.code,'UNSUPPORTED_EDIT');
  assert.equal((await saved()).muted, original.muted);
  assert.equal(await prompt.inputValue(), 'mute the audio and add subtitles');
  console.log('PASS unsupported combined request changes nothing and retains prompt');

  let release, intercepted;
  const ready = new Promise(resolve => intercepted = resolve);
  await page.route('**/api/edit', async route => {
    const request = route.request().postDataJSON();
    await new Promise(resolve => { release = resolve; intercepted(); });
    await route.fulfill({ json: { ok:true, changes:[{action:'speed',clip:'selected',rate:3}], batch: { requestId: request.requestId, sessionId: request.sessionId, revision: request.revision, commands: [{ action: 'setSpeed', clipId: request.project.selectedClip, speed: 3 }] }, summary: 'speed 3×' } });
  });
  await prompt.fill('make it 3x faster'); await prompt.press('Enter'); await ready;
  await page.getByRole('button', {name:'switch to timeline',exact:true}).click();
  await page.getByRole('button', { name: 'mute video', exact: true }).click();
  release();
  await page.getByRole('button', {name:'switch to chat',exact:true}).click();
  await status.getByText(/timeline changed/).waitFor();
  assert.equal((await saved()).clips[0].speed, 1); assert.equal((await saved()).muted, true);
  await page.unroute('**/api/edit');
  console.log('PASS stale response cannot overwrite a manual edit');

  let cancelReady;
  const cancelIntercept = new Promise(resolve => cancelReady = resolve);
  await page.route('**/api/edit', async route => {
    await new Promise(resolve => { release = resolve; cancelReady(); });
    await route.fulfill({ status: 503, json: { ok:false, error: {code:'SERVICE_UNAVAILABLE',message:'late response'} } }).catch(() => {});
  });
  await prompt.fill('make it 3x faster'); await prompt.press('Enter'); await cancelIntercept;
  await page.getByRole('button', { name: 'cancel edit', exact: true }).click(); release();
  await status.getByText(/cancelled/).waitFor(); assert.match(await status.innerText(), /cancelled/); assert.equal((await saved()).clips[0].speed, 1);
  await page.unroute('**/api/edit');
  console.log('PASS cancellation preserves video and prompt');

  await page.route('**/api/edit', route => route.fulfill({ status: 503, json: { ok:false, error: {code:'SERVICE_UNAVAILABLE',message:'Jev is busy right now. Try again in a moment.'} } }));
  await submit('mute the audio'); assert.match(await status.innerText(), /jev is busy/i);
  await page.unroute('**/api/edit');
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.screenshot({ path: `${output}/mobile.png`, fullPage: true });
  await page.evaluate(() => { localStorage.setItem('snip-theme', 'dark'); });
  await page.reload(); await page.getByRole('button', {name:'switch to chat',exact:true}).click();
  await page.screenshot({ path: `${output}/mobile-dark.png`, fullPage: true });
  await page.getByRole('button',{name:'switch to timeline',exact:true}).click();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.screenshot({path:`${output}/mobile-timeline.png`,fullPage:true});
  await page.getByRole('button',{name:'switch to chat',exact:true}).click();
  assert.equal(await chat.getByRole('button').count(), 3);
  assert((await chat.boundingBox()).height < 90);
  await prompt.fill('1x zoom and 1x speed for clip 1');
  await prompt.press('Shift+Enter');
  await prompt.press('a');
  assert.match(await prompt.inputValue(), /\na$/);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await chat.getByRole('button', {name:'apply edit'}).waitFor({state:'visible'});
  await page.screenshot({path:`${output}/mobile-prompt.png`,fullPage:true});
  assert.equal((await saved()).muted, true);
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('PASS server failure, mobile layout, dark theme and reload persistence');
} finally { await context.close(); await browser.close(); }
