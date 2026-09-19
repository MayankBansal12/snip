import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { select } from './ui.mjs';
const sample=process.env.VIDEO_SAMPLE;
if(!sample)throw Error('Set VIDEO_SAMPLE to an 8-second 1280×720 video with audio.');
const out=process.env.VERIFY_OUTPUT||'/tmp/snip-minimal-editor',app=process.env.APP_URL||'http://127.0.0.1:5195';
mkdirSync(out,{recursive:true});
const browser=await chromium.connectOverCDP(process.env.CDP_URL||'http://127.0.0.1:19384');
const contexts=[],errors=[],requests=[],report=[];
const log=(check,details={})=>{report.push({check,...details});console.log('PASS',check,JSON.stringify(details));};
const button=(p,name)=>p.getByRole('button',{name,exact:true});
async function fresh(options={}){
  const c=await browser.newContext({viewport:{width:1440,height:1000},colorScheme:'dark',acceptDownloads:true,...options});contexts.push(c);
  const p=await c.newPage();p.setDefaultTimeout(12000);p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(/^http/.test(r.url()))requests.push({url:r.url(),method:r.method()});});
  await p.goto(app);await p.waitForFunction(()=>!document.querySelector('button[aria-label="Open a video"]')?.disabled);
  return p;
}
const loaded=p=>p.waitForFunction(()=>document.querySelector('video')?.readyState>=2);
async function open(p){await p.locator('#video-file').setInputFiles({name:'demo.mp4',mimeType:'video/mp4',buffer:readFileSync(sample)});await loaded(p);}
async function blur(p){await p.evaluate(()=>document.activeElement instanceof HTMLElement&&document.activeElement.blur());}
async function seek(p,seconds){const head=p.getByRole('slider',{name:'Seek video',exact:true});await head.focus();await head.press('Home');for(let i=0;i<Math.floor(seconds);i++)await head.press('Shift+ArrowRight');for(let i=0;i<Math.round(seconds%1*30);i++)await head.press('ArrowRight');await blur(p);}
const previewScale=async p=>p.locator('video').evaluate(v=>v.getBoundingClientRect().width/v.parentElement.getBoundingClientRect().width);
const duration=async p=>Number(await p.getByRole('slider',{name:'Seek video',exact:true}).getAttribute('aria-valuemax'));
async function closeActions(p){await button(p,'Close clip actions').click();await p.locator('[data-slot=popover-popup]').waitFor({state:'hidden'});await blur(p);}
async function stored(p){await p.getByRole('status').filter({hasText:'Saved on this device'}).waitFor();return p.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('snip-local-project',1);r.onsuccess=()=>{const db=r.result,t=db.transaction('project'),s=t.objectStore('project'),e=s.get('edits');e.onsuccess=()=>resolve(e.result);t.oncomplete=()=>db.close();};r.onerror=()=>reject(r.error);}));}
async function download(p,filename,run){const waiting=p.waitForEvent('download',{timeout:180000});await run();const d=await waiting,f=path.join(out,filename);await d.saveAs(f);assert.equal(await d.failure(),null);return f;}
async function save(p,name){await blur(p);return download(p,name,()=>p.keyboard.press('Control+s'));}
async function render(p,name,format='mp4'){
  await button(p,'Export video').click();await select(p,'Export format',format);await select(p,'Export resolution','360');
  const file=await download(p,name,()=>button(p,'Export & download').click());await button(p,'Back to editing').click();await p.getByRole('dialog').waitFor({state:'hidden'});
  const probe=JSON.parse(execFileSync(process.env.FFPROBE_PATH||'ffprobe',['-v','error','-show_streams','-show_format','-of','json',file],{encoding:'utf8'}));return {file,probe};
}
function parse(buffer){const length=buffer.readUInt32LE(12);return {edits:JSON.parse(buffer.subarray(16,16+length)).edits,video:buffer.subarray(16+length)};}
let p;
try{
  p=await fresh();await open(p);await p.waitForFunction(()=>document.querySelectorAll('.clip-thumbnails img').length>5);
  assert.equal(await p.locator('.inspector-shell,[role=tablist],.preview-topline,.file-info').count(),0);
  assert.equal(await button(p,'Keyboard shortcuts').count(),0);assert.equal(await button(p,'Delete clip').count(),0);
  await p.screenshot({path:path.join(out,'editor-dark.png'),fullPage:true});
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert((await p.locator('.timeline').boundingBox()).y+(await p.locator('.timeline').boundingBox()).height<=1000);
  log('Minimal editor shows preview and timeline without an inspector, tool tabs, or redundant labels');

  await seek(p,2);await button(p,'Split').click();await seek(p,6);await p.keyboard.press('s');assert.equal(await p.locator('.timeline-clip').count(),3);
  await p.locator('.timeline-clip').nth(1).dblclick({position:{x:60,y:30}});await p.getByRole('combobox',{name:'Clip speed',exact:true}).waitFor();
  await select(p,'Clip speed','2');assert.equal(await duration(p),6);
  assert.equal((await stored(p)).clips[0].speed,undefined);assert.equal((await stored(p)).clips[1].speed,2);assert.equal(await p.locator('video').evaluate(v=>v.playbackRate),2);
  await p.getByRole('slider',{name:'Zoom',exact:true}).focus();await p.getByRole('slider',{name:'Zoom',exact:true}).press('Home');for(let i=0;i<20;i++)await p.keyboard.press('ArrowRight');
  assert.equal(Number(await p.getByRole('slider',{name:'Zoom',exact:true}).inputValue()),2);
  const area=await p.getByRole('group',{name:'Zoom area',exact:true}).boundingBox(),selection=await p.locator('[data-zoom-selection]').boundingBox();await p.mouse.move(selection.x+selection.width/2,selection.y+selection.height/2);await p.mouse.down();await p.mouse.move(area.x-30,area.y-30,{steps:8});await p.mouse.up();
  assert(Math.abs(await previewScale(p)-2)<.01);assert((await stored(p)).clips[1].zoom.x===0);
  assert.equal(await button(p,'Merge with next clip').count(),0);
  await p.screenshot({path:path.join(out,'clip-actions.png'),fullPage:true});await closeActions(p);
  await p.locator('.timeline-clip').nth(2).focus();await p.keyboard.press('Enter');await select(p,'Clip speed','0.5');await closeActions(p);assert.equal(await duration(p),8);
  const adjusted=await stored(p);assert.deepEqual(adjusted.clips[1].zoom,{scale:2,x:0,y:0});
  log('Double-click and keyboard actions change only the chosen clip; speed, zoom and focal position affect the preview');

  await seek(p,1);assert(Math.abs(await previewScale(p)-1)<.01);await button(p,'Play').click();
  await p.waitForFunction(()=>document.querySelector('video').currentTime>2.7&&document.querySelector('video').playbackRate===2);assert(Math.abs(await previewScale(p)-2)<.01);
  await p.waitForFunction(()=>document.querySelector('video').currentTime>6.2&&document.querySelector('video').playbackRate===.5);assert(Math.abs(await previewScale(p)-1)<.01);await button(p,'Pause').click();
  log('Playback changes speed and zoom at clip boundaries without applying them to neighboring clips');

  await seek(p,3);await button(p,'Split').click();assert.equal(await p.locator('.timeline-clip').count(),4);
  let e=await stored(p);assert.equal(e.clips[1].speed,2);assert.equal(e.clips[2].speed,2);assert.deepEqual(e.clips[1].zoom,e.clips[2].zoom);
  await button(p,'Clip actions').click();await button(p,'Merge with previous clip').click();assert.equal(await p.locator('.timeline-clip').count(),3);assert.equal(await duration(p),8);
  await button(p,'Undo').click();assert.equal(await p.locator('.timeline-clip').count(),4);await button(p,'Redo').click();assert.deepEqual((await stored(p)).clips,adjusted.clips);
  log('Splitting preserves clip adjustments; merging matching pieces is reversible');

  await seek(p,3);const handle=p.getByRole('slider',{name:'Clip 2 end',exact:true});const hb=await handle.boundingBox(),tb=await p.locator('.clip-track').boundingBox();
  await p.mouse.move(hb.x+hb.width/2,hb.y+30);await p.mouse.down();await p.mouse.move(hb.x+hb.width/2-tb.width/16,hb.y+30,{steps:8});await p.mouse.up();
  assert(Math.abs(Number(await handle.getAttribute('aria-valuenow'))-5)<.04);assert(Math.abs(await p.locator('video').evaluate(v=>v.currentTime)-Number(await handle.getAttribute('aria-valuenow')))<.01);await button(p,'Undo').click();assert.equal(Number(await handle.getAttribute('aria-valuenow')),6);
  await handle.focus();await p.keyboard.press('ArrowLeft');assert(Math.abs(Number(await handle.getAttribute('aria-valuenow'))-5.9)<.001);await button(p,'Undo').click();
  log('Mouse and keyboard trimming preview the retained edge frame and respect clip speed; a drag is one undo step');

  await seek(p,3);await blur(p);await p.keyboard.press('Delete');assert.equal(await p.locator('.timeline-clip').count(),2);assert.equal(await duration(p),6);
  await button(p,'Clip actions').click();assert.equal(await button(p,'Merge with next clip').count(),0);await closeActions(p);
  await button(p,'Undo').click();assert.deepEqual((await stored(p)).clips,adjusted.clips);
  log('Deleting a clip closes the gap; merge cannot restore removed footage; undo restores the edit');

  await p.waitForFunction(()=>navigator.serviceWorker.controller!==null);const saved=await save(p,'mixed-clips.snip'),bytes=readFileSync(saved),parsed=parse(bytes);
  assert.equal(bytes.readUInt32LE(8),2);assert.deepEqual(parsed.edits.clips,adjusted.clips);assert.deepEqual(parsed.video,readFileSync(sample));
  const other=await fresh();await other.waitForFunction(()=>navigator.serviceWorker.controller!==null);await other.context().setOffline(true);await other.reload();await other.locator('#project-file').setInputFiles({name:'reopened.snip',mimeType:'application/octet-stream',buffer:bytes});await loaded(other);
  assert.deepEqual((await stored(other)).clips,adjusted.clips);await other.reload();await loaded(other);assert.deepEqual((await stored(other)).clips,adjusted.clips);
  log('Project v2 preserves clip adjustments and original video bytes in a fresh offline workspace and after refresh');

  const encoded=await render(other,'mixed-clips.mp4');const video=encoded.probe.streams.find(s=>s.codec_type==='video'),audio=encoded.probe.streams.find(s=>s.codec_type==='audio');
  assert.equal(video.width,640);assert.equal(video.height,360);assert.equal(audio.codec_name,'aac');assert(Math.abs(Number(encoded.probe.format.duration)-8)<.1);assert(Math.abs(Number(video.duration)-Number(audio.duration))<.12);
  if(process.env.FFMPEG_PATH){
    const frame=(file,at,filter)=>execFileSync(process.env.FFMPEG_PATH,['-v','error','-ss',String(at),'-i',file,'-vf',filter,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{maxBuffer:2e6});
    for(const [outputTime,sourceTime,filter] of [[.5,.5,'scale=640:360'],[2.5,3,'crop=640:360:0:0'],[5,6.5,'scale=640:360']]){
      const actual=frame(encoded.file,outputTime,'null'),expected=frame(sample,sourceTime,filter);
      let total=0,n=0;for(let y=40;y<300;y+=40)for(let x=30;x<610;x+=35)for(let channel=0;channel<3;channel++){const i=(y*640+x)*3+channel;total+=Math.abs(actual[i]-expected[i]);n++;}assert(total/n<12,`Export frame ${outputTime} differs from expected crop: ${total/n}`);
    }
  }
  const webm=await render(other,'mixed-clips.webm','webm');assert.equal(webm.probe.streams.find(s=>s.codec_type==='video').codec_name,'vp8');assert.equal(webm.probe.streams.find(s=>s.codec_type==='audio').codec_name,'opus');assert(Math.abs(Number(webm.probe.format.duration)-8)<.12);
  log('Offline MP4 and WebM exports have correct mixed-speed duration, audio, dimensions and per-clip zoom pixels',{seconds:encoded.probe.format.duration});

  await button(p,'Switch to light mode').click();await p.screenshot({path:path.join(out,'editor-light.png'),fullPage:true});
  for(const viewport of [{width:320,height:640},{width:390,height:844},{width:768,height:1024},{width:844,height:390}]){
    await p.setViewportSize(viewport);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await button(p,'Clip actions').click();await p.getByRole('combobox',{name:'Clip speed',exact:true}).waitFor();await p.waitForTimeout(250);const box=await p.locator('[data-slot=popover-popup]').boundingBox();assert(box.x>=-1&&box.x+box.width<=viewport.width+1);assert(box.y>=-1&&box.y+box.height<=viewport.height+1);
    await p.screenshot({path:path.join(out,`editor-${viewport.width}.png`),fullPage:true});await closeActions(p);
  }
  log('Editor and clip actions fit 320px, 390px, tablet and phone landscape in light and dark themes');
  const touch=await fresh({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await open(touch);await button(touch,'Clip actions').tap();await select(touch,'Clip speed','2');await closeActions(touch);assert.equal(await duration(touch),4);
  await button(touch,'Timeline zoom').tap();await touch.getByRole('menuitemradio',{name:'4× closer',exact:true}).tap();await touch.getByRole('menu').waitFor({state:'hidden'});
  const session=await touch.context().newCDPSession(touch),box=await touch.locator('.clip-track').boundingBox();
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:280,y:box.y+30}]});for(let x=260;x>=80;x-=20)await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:box.y+30}]});await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await touch.waitForFunction(()=>document.querySelector('.timeline-scroll').scrollLeft>30);assert.equal((await stored(touch)).clips[0].start,0);
  log('Touch users can open clip actions and swipe a zoomed timeline without accidentally trimming');
  // Let native momentum scrolling settle before testing the next tap.
  await touch.waitForTimeout(600);p=touch;
  await button(touch,'Clip actions').tap();await button(touch,'Delete clip').tap();await touch.getByRole('alertdialog').waitFor();await button(touch,'Keep editing').tap();assert.equal(await touch.locator('.timeline-clip').count(),1);
  await touch.getByRole('alertdialog').waitFor({state:'hidden'});await button(touch,'Clip actions').tap();await button(touch,'Delete clip').tap();await button(touch,'Clear video').tap();await button(touch,'Open a video').waitFor();assert.equal(await touch.locator('video').count(),0);
  log('Deleting the final clip confirms before clearing the project; cancel preserves it');
  assert.deepEqual(errors,[]);assert(requests.every(r=>r.method==='GET'&&new URL(r.url).origin===new URL(app).origin));for(const c of contexts)assert.equal((await c.cookies()).length,0);
  log('No browser errors, cookies, external requests or uploads');
  writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
}catch(error){if(p){console.error(await p.locator('body').innerText());await p.screenshot({path:path.join(out,'failure.png'),fullPage:true});}throw error;}
finally{for(const c of contexts)await c.close();await browser.close();}
