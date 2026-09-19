import { action, select } from './ui.mjs';
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const sample=process.env.VIDEO_SAMPLE;
if(!sample)throw new Error('Set VIDEO_SAMPLE to an 8-second video with audio.');
const out=process.env.VERIFY_OUTPUT||'/tmp/snip-projects-verification';mkdirSync(out,{recursive:true});
const app=process.env.APP_URL||'http://127.0.0.1:5187';
const browser=await chromium.connectOverCDP(process.env.CDP_URL||'http://127.0.0.1:19376');
const contexts=[],report=[],errors=[],requests=[];
const log=(check,details={})=>{report.push({check,...details});console.log('PASS',check,JSON.stringify(details));};
const button=(p,name)=>action(p,name);
const unfocus=async p=>{await p.locator('[data-slot=dialog-popup][data-ending-style]').waitFor({state:'hidden'});await p.evaluate(()=>document.activeElement instanceof HTMLElement&&document.activeElement.blur());};
const seek=(p,time)=>p.getByRole('slider',{name:'Seek video',exact:true}).fill(String(time));
const digest=buffer=>createHash('sha256').update(buffer).digest('hex');
const sourceHash=digest(readFileSync(sample));
async function fresh(options={}){
  const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true,...options});contexts.push(context);
  const page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push({url:r.url(),method:r.method()});});
  await page.goto(app);await button(page,'Open project').waitFor();
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller,{},{timeout:60000});
  return page;
}
async function stored(page){return page.evaluate(async()=>{
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('snip-local-project',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const tx=db.transaction('project','readonly'),store=tx.objectStore('project');
  const get=key=>new Promise(resolve=>{const r=store.get(key);r.onsuccess=()=>resolve(r.result);});
  const [source,edits]=await Promise.all([get('source'),get('edits')]);db.close();
  if(!source)return null;
  const bytes=await source.file.arrayBuffer();
  return {source:{name:source.name,width:source.width,height:source.height,duration:source.duration,size:source.file.size,hash:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('')},edits};
});}
function parse(buffer){const length=buffer.readUInt32LE(12);return {manifest:JSON.parse(buffer.subarray(16,16+length).toString()),video:buffer.subarray(16+length)};}
function altered(buffer,change){const {manifest,video}=parse(buffer);change(manifest);const json=Buffer.from(JSON.stringify(manifest));const header=Buffer.from(buffer.subarray(0,16));header.writeUInt32LE(json.length,12);return Buffer.concat([header,json,video]);}
async function save(p,name,keyboard=true){const downloading=p.waitForEvent('download');if(keyboard){await unfocus(p);await p.keyboard.press('Control+s');}else{await button(p,'Project menu').click();await p.getByRole('menuitem',{name:/^Save project/}).click();}const file=await downloading;assert(file.suggestedFilename().endsWith('.snip'));const target=path.join(out,name);await file.saveAs(target);assert.equal(await file.failure(),null);return {buffer:readFileSync(target),target};}
let page;
try{
  page=await fresh();await page.locator('#video-file').setInputFiles(sample);await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2);
  await seek(page,2);await unfocus(page);await page.keyboard.press('s');await seek(page,4);await page.keyboard.press('s');await seek(page,3);await unfocus(page);await page.keyboard.press('Delete');assert.equal(await page.locator('.timeline-clip').count(),2);
  await button(page,'Crop').click();await select(page,'Crop ratio','1:1');
  await button(page,'Frame').click();await select(page,'Canvas aspect ratio','9:16');await page.getByRole('slider',{name:'Inset',exact:true}).fill('6');await page.getByLabel('Custom background color',{exact:true}).fill('#c4d4df');
  await button(page,'Filters').click();await button(page,'Warm').click();await page.getByRole('slider',{name:'Intensity',exact:true}).fill('67');await page.getByRole('slider',{name:'Brightness',exact:true}).fill('10');await page.getByRole('slider',{name:'Contrast',exact:true}).fill('-5');
  await button(page,'Annotate').click();await button(page,'Add text').click();await page.getByLabel('Annotation text',{exact:true}).fill('Save me\nOffline too');await page.getByRole('slider',{name:'Text size',exact:true}).fill('71');
  await button(page,'Draw arrow').click();const frame=await page.locator('.annotation-overlay').boundingBox();
  if(!frame)throw new Error('Annotation overlay missing');
  await page.mouse.move(frame.x+frame.width*.2,frame.y+frame.height*.2);await page.mouse.down();await page.mouse.move(frame.x+frame.width*.5,frame.y+frame.height*.4,{steps:8});await page.mouse.up();
  for(const label of ['Draw rectangle','Draw freehand']){await button(page,label).click();await page.mouse.move(frame.x+frame.width*.7,frame.y+frame.height*.6);await page.mouse.down();await page.mouse.move(frame.x+frame.width*.4,frame.y+frame.height*.45,{steps:12});await page.mouse.up();}
  await button(page,'Speed').click();await select(page,'Video speed','1.5');await page.getByRole('switch',{name:'Keep audio'}).uncheck();
  await button(page,'Export video').click();await select(page,'Export format','webm');await select(page,'Export resolution','360');await select(page,'Export quality','compact');await button(page,'Close export').click();
  const expected=JSON.parse(JSON.stringify(await stored(page)));assert.equal(expected.source.hash,sourceHash);assert.equal(expected.edits.annotations.length,4);
  const saved=await save(page,'edited-demo.snip');const parsed=parse(saved.buffer);
  assert.equal(saved.buffer.subarray(0,8).toString(),'SNIPFILE');assert.equal(saved.buffer.readUInt32LE(8),1);assert.deepEqual(parsed.manifest.edits,JSON.parse(JSON.stringify(expected.edits)));assert.equal(digest(parsed.video),sourceHash);assert(saved.buffer.length-readFileSync(sample).length<10000);
  log('Save downloads one portable file containing unchanged source bytes and every edit',{bytes:saved.buffer.length,sourceBytes:parsed.video.length,clips:2,annotations:4});

  const other=await fresh();await other.context().setOffline(true);await other.reload();await button(other,'Open project').waitFor();const chooser=other.waitForEvent('filechooser');await unfocus(other);await other.keyboard.press('Control+Shift+o');await(await chooser).setFiles(saved.target);await other.waitForFunction(()=>document.querySelector('video')?.readyState>=2);assert.deepEqual(await stored(other),expected);assert.equal(await other.locator('.timeline-clip').count(),2);assert.equal(await other.locator('video').evaluate(v=>v.playbackRate),1.5);assert.equal(await other.locator('video').evaluate(v=>v.muted),true);
  log('A fresh browser workspace opens the project offline with Ctrl Shift O');
  await other.reload();await other.waitForFunction(()=>document.querySelector('video')?.readyState>=2);assert.deepEqual(await stored(other),expected);log('Imported source and all edits survive an offline refresh');
  const resaved=await save(other,'saved-again.snip',false);const again=parse(resaved.buffer);assert.deepEqual(again.manifest.edits,parsed.manifest.edits);assert.equal(digest(again.video),sourceHash);log('Project menu saves again offline without changing video or edits');

  const badMagic=Buffer.from(saved.buffer);badMagic.write('NOTSNIP!');const future=Buffer.from(saved.buffer);future.writeUInt32LE(999,8);const huge=Buffer.from(saved.buffer);huge.writeUInt32LE(0xffffffff,12);
  const cases=[['wrong signature',badMagic],['newer version',future],['truncated video',saved.buffer.subarray(0,-100)],['excessive manifest',huge],['empty clips',altered(saved.buffer,m=>m.edits.clips=[])],['out-of-range trim',altered(saved.buffer,m=>m.edits.clips[0].end=999)],['invalid crop',altered(saved.buffer,m=>m.edits.crop.width=4)],['invalid speed',altered(saved.buffer,m=>m.edits.speed=0)],['invalid frame',altered(saved.buffer,m=>m.edits.canvas.ratio=0)],['duplicate IDs',altered(saved.buffer,m=>m.edits.clips[1].id=m.edits.clips[0].id)],['unknown export setting',altered(saved.buffer,m=>m.edits.resolution='NaN')]];
  for(const [name,buffer] of cases){await other.locator('#project-file').setInputFiles({name:'invalid.snip',mimeType:'application/octet-stream',buffer});await other.getByRole('alert').waitFor();await other.waitForFunction(()=>!document.querySelector('.workspace').inert);assert.deepEqual(await stored(other),expected);assert.equal(await other.locator('.timeline-clip').count(),2);await button(other,'Dismiss error').click();}
  log('Malformed, truncated, unsupported and invalid project files preserve the existing workspace',{cases:cases.map(([name])=>name)});
  await other.evaluate(()=>{const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){if(key==='source'){IDBObjectStore.prototype.put=put;this.transaction.abort();throw new DOMException('Test storage quota failure','QuotaExceededError');}return put.call(this,value,key);};});
  await other.locator('#project-file').setInputFiles(saved.target);await other.getByRole('alert').waitFor();assert.deepEqual(await stored(other),expected);await button(other,'Dismiss error').click();log('A failed storage transaction leaves the previous project intact');
  await other.locator('#project-file').setInputFiles(saved.target);await other.getByText('Project opened',{exact:true}).waitFor();assert.deepEqual(await stored(other),expected);log('The same file can be retried after an import failure');

  await button(other,'Export video').click();await select(other,'Export format','mp4');const videoDownload=other.waitForEvent('download',{timeout:180000});await button(other,'Export & download').click();const video=await videoDownload;const videoPath=path.join(out,'reopened-offline.mp4');await video.saveAs(videoPath);assert.equal(await video.failure(),null);
  const probe=JSON.parse(execFileSync(process.env.FFPROBE_PATH||'ffprobe',['-v','error','-show_streams','-show_format','-of','json',videoPath],{encoding:'utf8'}));const stream=probe.streams.find(s=>s.codec_type==='video');assert.equal(stream.codec_name,'h264');assert.equal(stream.width,360);assert.equal(stream.height,640);assert(Math.abs(Number(probe.format.duration)-4)<.15);assert(!probe.streams.some(s=>s.codec_type==='audio'));log('Reopened project exports and downloads MP4 entirely offline',{width:stream.width,height:stream.height,duration:probe.format.duration,bytes:probe.format.size});
  await button(other,'Back to editing').click();await button(other,'Project menu').click();await button(other,'Clear saved video').click();await button(other,'Clear video').click();await button(other,'Open project').waitFor();assert.equal(await stored(other),null);
  const openFromEmpty=other.waitForEvent('filechooser');await button(other,'Open project').click();await(await openFromEmpty).setFiles(saved.target);await other.waitForFunction(()=>document.querySelector('video')?.readyState>=2);assert.deepEqual(await stored(other),expected);log('A downloaded project restores work after browser autosave is cleared');

  const phone=await fresh({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});await phone.context().setOffline(true);const mobileChooser=phone.waitForEvent('filechooser');await button(phone,'Open project').tap();await(await mobileChooser).setFiles(saved.target);await phone.waitForFunction(()=>document.querySelector('video')?.readyState>=2);assert.deepEqual(await stored(phone),expected);
  for(const viewport of [{width:320,height:640},{width:390,height:844},{width:844,height:390}]){
    await phone.setViewportSize(viewport);await button(phone,'Project menu').tap();const box=await phone.getByRole('menuitem',{name:/^Save project/}).boundingBox();assert(box.height>=27);assert(box.x>=0&&box.x+box.width<=viewport.width);assert.equal(await phone.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await phone.screenshot({path:path.join(out,`project-menu-${viewport.width}.png`)});await phone.keyboard.press('Escape');
  }
  await phone.setViewportSize({width:390,height:844});const mobileSaved=await save(phone,'mobile-saved.snip',false);assert.equal(digest(parse(mobileSaved.buffer).video),sourceHash);assert.deepEqual(parse(mobileSaved.buffer).manifest.edits,parsed.manifest.edits);log('Mobile project open/save works offline; controls fit 320px, 390px and phone landscape');
  await page.locator('.app').dispatchEvent('drop',await page.evaluateHandle(buffer=>{const dataTransfer=new DataTransfer();dataTransfer.items.add(new File([Uint8Array.from(atob(buffer),c=>c.charCodeAt(0))],'dropped.snip',{type:'application/octet-stream'}));return {dataTransfer};},saved.buffer.toString('base64')));await page.getByText('Project opened',{exact:true}).waitFor();assert.deepEqual(await stored(page),expected);log('Drag and drop recognizes .snip projects');
  assert.deepEqual(errors,[]);assert(requests.every(r=>r.method==='GET'&&new URL(r.url).origin===new URL(app).origin));for(const c of contexts)assert.equal((await c.cookies()).length,0);log('No browser errors, cookies, uploads, or external requests');
  writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
}catch(error){console.error(error);if(page){console.error(await page.locator('body').innerText());await page.screenshot({path:path.join(out,'failure.png'),fullPage:true});}throw error;}
finally{for(const context of contexts)await context.close();await browser.close();}
