import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

// Runs against the Vite dev server so we can exercise the same render functions
// with fixtures, independently of the UI's control wiring.
const ffmpeg=process.env.FFMPEG_PATH,ffprobe=process.env.FFPROBE_PATH;
if(!ffmpeg||!ffprobe)throw new Error('Set FFMPEG_PATH and FFPROBE_PATH. Start npm run dev and set EDITOR_URL if needed.');
const out=mkdtempSync(join(tmpdir(),'snip-frame-verification-'));
const browser=process.env.CDP_URL?await chromium.connectOverCDP(process.env.CDP_URL):await chromium.launch({headless:true});
const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1280,height:900}}),page=await context.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',message=>{if(message.type()==='error')console.error('Browser:',message.text());});page.setDefaultTimeout(30000);
const probe=path=>JSON.parse(execFileSync(ffprobe,['-v','error','-select_streams','v:0','-show_frames','-show_streams','-of','json',path],{encoding:'utf8',maxBuffer:8e6}));
const raw=(path,frame)=>execFileSync(ffmpeg,['-v','error','-i',path,'-vf',`select=eq(n\\,${frame})`,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','-'],{maxBuffer:8e6});
try{
  await page.goto(process.env.EDITOR_URL||'http://localhost:5173');
  for(const rate of ['60','variable']){
    const fixture=join(out,`${rate}.mp4`);
    execFileSync(ffmpeg,['-v','error','-f','lavfi','-i','testsrc2=size=160x90:rate=60:duration=2','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=2',...(rate==='variable'?['-vf',"select='if(lt(n,60),not(mod(n,2)),not(mod(n,3)))'",'-fps_mode','vfr']:[]),'-c:v','libx264','-bf',rate==='variable'?'0':'3','-c:a','aac','-y',fixture]);
    const sourceFrames=probe(fixture).frames.filter(f=>f.media_type==='video').map(f=>Number(f.best_effort_timestamp_time));
    await page.locator('#video-file').setInputFiles(fixture);
    await page.waitForFunction(()=>!document.querySelector('.workspace')?.inert && document.querySelector('video')?.readyState>=2);
    await page.getByRole('button',{name:'next frame',exact:true}).click();
    assert(Math.abs(await page.locator('video').evaluate(v=>v.currentTime)-(sourceFrames[1]+.001))<1e-5);
    const handle=page.getByRole('slider',{name:'Clip 1 start',exact:true});await handle.focus();await page.keyboard.press('ArrowRight');
    assert(Math.abs(Number(await handle.getAttribute('aria-valuenow'))-sourceFrames[1])<1e-6);
    await page.getByRole('button',{name:'undo',exact:true}).click();
    const base64=readFileSync(fixture).toString('base64');
    for(const [first,after,speed] of [[1,2,1],[1,2,2],[3,40,1]]){
      const result=await page.evaluate(async({base64,first,after,speed})=>{
        const {readMetadata}=await import('/src/media.ts');
        const {defaults}=await import('/src/types.ts');
        const {getFrameIndex,inspectExport}=await import('/src/media-analysis.ts');
        const {exportVideo}=await import('/src/export.ts');
        const source=await readMetadata(new File([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],'fixture.mp4',{type:'video/mp4'}));
        const index=await getFrameIndex(source),edits=defaults(source.duration);edits.muted=true;
        edits.clips[0]={...edits.clips[0],start:index.times[first],end:index.times[after],speed};
        const blob=await exportVideo(source,edits,()=>{}),details=await inspectExport(blob);
        return {times:Array.from(index.times),bytes:Array.from(new Uint8Array(await blob.arrayBuffer())),details};
      },{base64,first,after,speed});
      assert.equal(result.times.length,sourceFrames.length);
      result.times.forEach((t,i)=>assert(Math.abs(t-sourceFrames[i])<1e-6));
      const rendered=join(out,`${rate}-${first}-${after}-${speed}.mp4`);writeFileSync(rendered,Buffer.from(result.bytes));
      const frames=probe(rendered).frames.filter(f=>f.media_type==='video');
      assert.equal(frames.length,after-first);assert.equal(result.details.frameCount,frames.length);
      assert(Math.abs(result.details.duration-(result.times[after]-result.times[first])/speed)<.001);
      assert(Math.abs(result.details.frameRate-frames.length/result.details.duration)<.001);
      if(rate==='variable'&&frames.length>2)assert.equal(result.details.variable,true);
      assert.equal(result.details.audio,null);assert.equal(result.details.width,160);assert.equal(result.details.height,90);
      for(const [outputFrame,sourceFrame] of [[0,first],[frames.length-1,after-1]]){
        const actual=raw(rendered,outputFrame),expected=raw(fixture,sourceFrame);assert.equal(actual.length,expected.length);
        const distance=pixels=>actual.reduce((sum,x,i)=>sum+Math.abs(x-pixels[i]),0)/actual.length;
        const error=distance(expected);assert(error<6,`frame mismatch: ${error}`);
        for(const neighbor of [sourceFrame-1,sourceFrame+1].filter(n=>n>=0&&n<sourceFrames.length))
          assert(error<distance(raw(fixture,neighbor)),`Exported frame ${outputFrame} is closer to adjacent source frame ${neighbor} than requested ${sourceFrame}`);
      }
      console.log('PASS',rate,`${after-first} frame(s) at ${speed}×`,JSON.stringify(result.details));
    }
    const joined=await page.evaluate(async({base64})=>{
      const {readMetadata}=await import('/src/media.ts');
      const {defaults}=await import('/src/types.ts');
      const {getFrameIndex,inspectExport}=await import('/src/media-analysis.ts');
      const {exportVideo}=await import('/src/export.ts');
      const source=await readMetadata(new File([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],'fixture.mp4',{type:'video/mp4'}));
      const index=await getFrameIndex(source),edits=defaults(source.duration);edits.muted=true;
      edits.clips=[
        {...edits.clips[0],id:'first',start:index.times[1],end:index.times[2],speed:2},
        {...edits.clips[0],id:'second',start:index.times[30],end:index.times[31],speed:1},
      ];
      const blob=await exportVideo(source,edits,()=>{});
      return {times:Array.from(index.times),bytes:Array.from(new Uint8Array(await blob.arrayBuffer())),details:await inspectExport(blob)};
    },{base64:readFileSync(fixture).toString('base64')});
    const joinedPath=join(out,`${rate}-two-single-frames.mp4`);writeFileSync(joinedPath,Buffer.from(joined.bytes));
    const joinedFrames=probe(joinedPath).frames.filter(f=>f.media_type==='video');
    assert.equal(joinedFrames.length,2);
    assert.equal(joined.details.frameCount,2);
    assert(Math.abs(Number(joinedFrames[1].best_effort_timestamp_time)-(joined.times[2]-joined.times[1])/2)<.001);
    assert(Math.abs(joined.details.duration-((joined.times[2]-joined.times[1])/2+joined.times[31]-joined.times[30]))<.001);
    for(const [outputFrame,sourceFrame] of [[0,1],[1,30]]){
      const actual=raw(joinedPath,outputFrame),expected=raw(fixture,sourceFrame);
      assert.equal(actual.length,expected.length);
      assert(actual.reduce((sum,x,i)=>sum+Math.abs(x-expected[i]),0)/actual.length<6);
    }
    console.log('PASS',rate,'two separated single-frame clips preserve both frames and their timing');
    if(rate==='60'){
      await page.reload();
      for(const speed of [1,2,.25]){
        const joinedWithAudio=await page.evaluate(async({base64,speed})=>{
          const {readMetadata}=await import('/src/media.ts');
          const {defaults}=await import('/src/types.ts');
          const {getFrameIndex,inspectExport}=await import('/src/media-analysis.ts');
          const {exportVideo}=await import('/src/export.ts');
          const source=await readMetadata(new File([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],'fixture.mp4',{type:'video/mp4'}));
          const index=await getFrameIndex(source),edits=defaults(source.duration);
          edits.clips=[
            {...edits.clips[0],id:'first',start:index.times[1],end:index.times[2],speed},
            {...edits.clips[0],id:'second',start:index.times[30],end:index.times[31],speed:1},
          ];
          const blob=await exportVideo(source,edits,()=>{});
          return {bytes:Array.from(new Uint8Array(await blob.arrayBuffer())),details:await inspectExport(blob)};
        },{base64:readFileSync(fixture).toString('base64'),speed});
        const audioPath=join(out,`two-single-frames-audio-${speed}.mp4`);writeFileSync(audioPath,Buffer.from(joinedWithAudio.bytes));
        const audioFrames=probe(audioPath).frames.filter(f=>f.media_type==='video');
        assert.equal(audioFrames.length,2);assert(joinedWithAudio.details.audio?.sampleRate>0);
        assert(Math.abs(Number(audioFrames[1].best_effort_timestamp_time)-(joined.times[2]-joined.times[1])/speed)<.001);
        const pcm=execFileSync(ffmpeg,['-v','error','-i',audioPath,'-vn','-ac','1','-ar','48000','-f','s16le','-']);
        let energy=0;for(let sample=0;sample<pcm.length;sample+=2)energy+=pcm.readInt16LE(sample)**2;
        assert(Math.sqrt(energy/(pcm.length/2))>100,'short unmuted clips must retain audible source samples');
        const firstSamples=Math.min(pcm.length/2,Math.floor(48000*(joined.times[2]-joined.times[1])/speed));
        let firstEnergy=0;for(let sample=0;sample<firstSamples;sample++)firstEnergy+=pcm.readInt16LE(sample*2)**2;
        assert(Math.sqrt(firstEnergy/firstSamples)>100,'the first short clip must retain audible source samples');
        console.log('PASS two single-frame clips retain timing and audible source audio at',speed,'×');
      }
      await page.reload();await page.locator('#video-file').setInputFiles(fixture);
      await page.waitForFunction(()=>!document.querySelector('.workspace')?.inert && document.querySelector('video')?.readyState>=2);
      for(let frame=0;frame<8;frame++)await page.getByRole('button',{name:'next frame',exact:true}).click();
      await page.getByRole('button',{name:'split',exact:true}).click();
      for(let frame=0;frame<15;frame++)await page.getByRole('button',{name:'next frame',exact:true}).click();
      await page.getByRole('button',{name:'split',exact:true}).click();
      assert.equal(await page.locator('.timeline-clip').count(),3);
      await page.getByRole('button',{name:'previous frame',exact:true}).click();
      assert.equal(await page.locator('.timeline-clip').nth(1).getAttribute('aria-pressed'),'true');
      await page.getByRole('button',{name:'next frame',exact:true}).click();
      assert.equal(await page.locator('.timeline-clip').nth(2).getAttribute('aria-pressed'),'true');
      assert(Math.abs(await page.locator('video').evaluate(v=>v.currentTime)-(sourceFrames[23]+.001))<1e-5);
      await page.getByText(/frame 24 \/ 120/).waitFor();
      const clip2Start=await page.getByRole('slider',{name:'Clip 2 start',exact:true}).getAttribute('aria-valuenow');
      await page.evaluate(()=>document.activeElement?.blur());await page.keyboard.press('i');
      assert.equal(await page.getByRole('slider',{name:'Clip 2 start',exact:true}).getAttribute('aria-valuenow'),clip2Start);
      console.log('PASS frame stepping and trim-at-playhead keep the third clip identity');
    }
  }
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);console.log('PASS frame stepping, keyboard trims, indexed timestamps, first/last rendered frames and mobile layout');
}finally{await context.close();await browser.close();}
