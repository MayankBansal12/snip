import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const out=process.env.VERIFY_OUTPUT || '/tmp/snip-crop-canvas';mkdirSync(out,{recursive:true});
const sample=`${out}/source.mp4`;
execFileSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','testsrc2=size=640x360:rate=30:duration=2','-c:v','libx264','-pix_fmt','yuv420p',sample]);
const browser=await chromium.connectOverCDP(process.env.CDP_URL || 'http://127.0.0.1:9223');
const context=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true});
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.text().startsWith('VERIFY'))console.log(m.text());});page.setDefaultTimeout(15000);
const button=name=>page.getByRole('button',{name,exact:true});
async function select(label,option){await page.getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('option',{name:option,exact:true}).click();await page.getByRole('listbox').waitFor({state:'hidden'});}
async function closed(){await page.getByRole('dialog').waitFor({state:'hidden'});}
async function stored(){return page.evaluate(async()=>{const {restoreProject}=await import('/src/storage.ts');return (await restoreProject())?.edits;});}
try {
 await page.goto(process.env.APP_URL||'http://127.0.0.1:5198');
 await page.locator('#video-file').setInputFiles({name:'source.mp4',mimeType:'video/mp4',buffer:readFileSync(sample)});
 await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2);
 const viewer=await page.locator('.preview-panel').boundingBox(),timeline=await page.locator('.editor-controls').boundingBox();
 assert.equal(viewer.x,timeline.x);assert.equal(viewer.width,timeline.width);
 assert.equal(await page.locator('.preview-panel').evaluate(e=>getComputedStyle(e).backgroundColor),await page.locator('.editor-controls').evaluate(e=>getComputedStyle(e).backgroundColor));
 await button('crop video').click();
 await select('crop aspect ratio','1:1');
 // Snapshot must actually show a decoded frame.
 assert(await page.locator('.crop-surface canvas').evaluate(c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;return d.some((v,i)=>i%4!==3&&v>0);}));
 await page.screenshot({path:`${out}/crop-desktop.png`});
 const selection=page.getByRole('group',{name:'crop area'}),before=await selection.boundingBox();
 await page.mouse.move(before.x+before.width/2,before.y+before.height/2);await page.mouse.down();await page.mouse.move(before.x+before.width/2+30,before.y+before.height/2);await page.mouse.up();
 assert((await selection.boundingBox()).x>before.x);
 await page.getByRole('button',{name:'resize crop se'}).press('ArrowLeft');
 await button('apply crop').click();await closed();
 const square=await page.locator('.composition').boundingBox();assert(Math.abs(square.width-square.height)<1);
 await button('undo').click();const original=await page.locator('.composition').boundingBox();assert(Math.abs(original.width/original.height-16/9)<.01);
 await button('redo').click();
 await button('crop video').click();await button('reset crop').click();await button('close video settings').click();await closed();
 const afterCancel=await page.locator('.composition').boundingBox();assert(Math.abs(afterCancel.width-afterCancel.height)<1);
 await button('video dimensions').click();await select('video aspect ratio','9:16');await button('apply dimensions').click();await closed();
 let box=await page.locator('.composition').boundingBox();assert(Math.abs(box.width/box.height-9/16)<.01);
 await button('video dimensions').click();await select('video aspect ratio','custom size');
 await page.getByRole('spinbutton',{name:'video width'}).fill('321');await page.getByRole('spinbutton',{name:'video height'}).fill('480');assert(await button('apply dimensions').isDisabled());
 await page.getByRole('spinbutton',{name:'video width'}).fill('320');await select('video framing','fill · cover the frame');
 await button('apply dimensions').click();await closed();
 box=await page.locator('.composition').boundingBox();assert(Math.abs(box.width/box.height-2/3)<.01);
 await page.waitForTimeout(700);
 let edits=await stored();assert.equal(edits.canvas.outputWidth,320);assert.equal(edits.canvas.outputHeight,480);
 await page.reload();await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2);
 assert((await button('video dimensions').textContent()).includes('320 × 480'));
 for(const width of [1280,390,320]){
   await page.setViewportSize({width,height:900});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.screenshot({path:`${out}/editor-${width}.png`,fullPage:true});
   for(const control of ['crop video','video dimensions']){
     await button(control).click();await page.waitForTimeout(250);
     const rect=await page.getByRole('dialog').boundingBox();assert(rect.x>=-1&&rect.x+rect.width<=width+1);
     await page.screenshot({path:`${out}/${control.replaceAll(' ','-')}-${width}.png`,fullPage:true});
     await button('close video settings').click();await closed();
   }
 }
 await page.setViewportSize({width:1280,height:900});
 await button('switch to dark mode').click();
 await page.screenshot({path:`${out}/editor-dark.png`,fullPage:true});
 await button('video dimensions').click();await page.waitForTimeout(250);await page.screenshot({path:`${out}/dimensions-dark.png`});await button('close video settings').click();await closed();
 // Render actual output in both native/fast and deterministic FFmpeg paths.
 await page.setViewportSize({width:1280,height:900});
 const outputs=await page.evaluate(async bytes=>{
   const {readMetadata}=await import('/src/media.ts');const {restoreProject}=await import('/src/storage.ts');
   const {exportVideo,canCopyPicture}=await import('/src/export.ts');const {defaults}=await import('/src/types.ts');
   const source=await readMetadata(new File([new Uint8Array(bytes)],'source.mp4',{type:'video/mp4'}));
   const edits=(await restoreProject()).edits;
   const {createProjectFile,readProjectFile}=await import('/src/project-file.ts');
   const saved=createProjectFile(source,edits);
   const restored=await readProjectFile(new File([saved.blob],saved.name));

   if(canCopyPicture(source,{...defaults(source.duration),canvas:{...edits.canvas}}))throw Error('Custom dimensions bypassed rendering');
   const result={};
   for(const [name,fit,deterministic] of [['fill-native','fill',false],['fit-ffmpeg','fit',true]]){
     console.log('VERIFY rendering '+name);
     const timer=setTimeout(()=>{import('/src/export.ts').then(m=>m.cancelExport());},90000);
     let blob;
     try { blob=await exportVideo(source,{...edits,canvas:{...edits.canvas,fit}},(_value,stage)=>{window.__verifyStage=stage;},deterministic); }
     finally {clearTimeout(timer);}
     console.log('VERIFY rendered '+name);
     result[name]=Array.from(new Uint8Array(await blob.arrayBuffer()));
   }
   return {result,edits,restoredEdits:restored.edits};
 },Array.from(readFileSync(sample)));
 assert.deepEqual(outputs.restoredEdits,outputs.edits);
 for(const [name,bytes] of Object.entries(outputs.result)){
   const file=`${out}/${name}.mp4`;writeFileSync(file,Buffer.from(bytes));
   const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-of','json',file]));
   const video=probe.streams.find(s=>s.codec_type==='video');assert.equal(video.width,320);assert.equal(video.height,480);
   assert(Math.abs(Number(video.duration)-2)<.1);
   // Compare decoded output to an independent crop/scale/pad rendered by native FFmpeg.
   const c=outputs.edits.crop,w=Math.floor((640*c.width+1e-7)/2)*2,h=Math.floor((360*c.height+1e-7)/2)*2,x=Math.floor(640*c.x/2)*2,y=Math.floor(360*c.y/2)*2;
   const filter=name.startsWith('fit')?`crop=${w}:${h}:${x}:${y},scale=320:320,pad=320:480:0:80:color=0x171717`:`crop=${w}:${h}:${x}:${y},scale=480:480,crop=320:480:80:0`;
   const frame=(input,vf)=>execFileSync('ffmpeg',['-v','error','-ss','0.5','-i',input,'-vf',vf,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],{maxBuffer:2e6});
   const actual=frame(file,'null'),expected=frame(sample,filter);let total=0,count=0;
   for(let y=10;y<470;y+=11)for(let x=10;x<310;x+=11)for(let ch=0;ch<3;ch++){const i=(y*320+x)*3+ch;total+=Math.abs(actual[i]-expected[i]);count++;}
   assert(total/count<15,`${name} crop differs from expected by ${total/count}`);
 }
 assert.deepEqual(errors,[]);
 console.log('PASS aligned cards, crop drag/resize, cancel/undo/redo, presets/custom validation, restore, responsive dialogs, and exact 320×480 exports in both render paths');
} finally {await context.close();await browser.close();}
