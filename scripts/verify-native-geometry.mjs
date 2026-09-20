import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const ff=process.env.FFMPEG_PATH||'ffmpeg',probe=process.env.FFPROBE_PATH||'ffprobe';
const out=process.env.VERIFY_OUTPUT||'/tmp/snip-native-geometry';mkdirSync(out,{recursive:true});
const source=`${out}/gradient.mp4`;
execFileSync(ff,['-v','error','-y','-f','lavfi','-i',"nullsrc=s=640x360:r=30,geq=r='255*X/W':g='255*Y/H':b='128'",'-t','2','-c:v','libx264','-crf','10','-pix_fmt','yuv420p',source]);
const browser=await chromium.connectOverCDP(process.env.CDP_URL||'http://127.0.0.1:9234');const context=await browser.newContext();
try{
 const page=await context.newPage();await page.routeWebSocket('**',()=>{});await page.goto(process.env.APP_URL||'http://127.0.0.1:5206');
 const outputs=await page.evaluate(async bytes=>{
  const {readMetadata}=await import('/src/media.ts');const {defaults}=await import('/src/types.ts');const {nativeExport}=await import('/src/native-export.ts');
  const source=await readMetadata(new File([new Uint8Array(bytes)],'gradient.mp4',{type:'video/mp4'}));const result={};
  for(const mode of ['zoom','annotation','fit']){
   const edits=defaults(source.duration);edits.clips=[{id:'a',start:0,end:1},{id:'b',start:1,end:2,speed:1.5,zoom:{scale:2,x:.75,y:.25}}];
   if(mode==='annotation')edits.annotations=[{id:'r',type:'rectangle',x:.2,y:.2,width:.6,height:.6,color:'#ff0000',size:.03}];
   if(mode==='fit')edits.canvas={...edits.canvas,ratio:1,aspect:'1:1',background:'#123456'};
   const blob=await nativeExport(source,edits,()=>{},async()=>null,new AbortController().signal);
   if(!blob)throw new Error('Native exporter did not run');result[mode]=Array.from(new Uint8Array(await blob.arrayBuffer()));
  }
  return result;
 },Array.from(readFileSync(source)));
 const report=[];
 for(const [mode,bytes] of Object.entries(outputs)){
  const file=`${out}/${mode}.mp4`;writeFileSync(file,Buffer.from(bytes));
  const info=JSON.parse(execFileSync(probe,['-v','error','-show_streams','-show_frames','-of','json',file]));const v=info.streams.find(s=>s.codec_type==='video');
  assert.equal(v.width,mode==='fit'?360:640);assert.equal(v.height,360);
  const frames=info.frames.filter(f=>f.media_type==='video');
  for(const target of [.2,1.166667,1.25,1.5]){
   let n=0;frames.forEach((frame,i)=>{if(Math.abs(Number(frame.best_effort_timestamp_time)-target)<Math.abs(Number(frames[n].best_effort_timestamp_time)-target))n=i;});
   const time=Number(frames[n].best_effort_timestamp_time);
   const rgb=execFileSync(ff,['-v','error','-i',file,'-vf',`select=eq(n\\,${n})`,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','-']);
   const pixel=(x,y)=>Array.from(rgb.subarray((Math.floor(y)*v.width+Math.floor(x))*3,(Math.floor(y)*v.width+Math.floor(x))*3+3));
   const near=(actual,expected)=>assert(actual.every((x,i)=>Math.abs(x-expected[i])<8),`${mode} @ ${time}: ${actual} vs ${expected}`);
   if(mode==='fit')near(pixel(180,20),[18,52,86]);
   else{
    // Independent camera specification: center interpolates with quintic ease;
    // magnification is geometric. Speed shortens this clip's transition to 1/3 s.
    const t=time<1?0:Math.min(1,(time-1)/(1/3)),e=t*t*t*(t*(t*6-15)+10);
    const w=640*Math.pow(.5,e),h=360*Math.pow(.5,e),cx=320+80*e,cy=180-45*e;
    for(const [px,py] of [[.5,.5],[.35,.35]])near(pixel(v.width*px,v.height*py),[(cx+(px-.5)*w)/640*255,(cy+(py-.5)*h)/360*255,128]);
    if(mode==='annotation')near(pixel(v.width*.2,v.height*.5),[255,0,0]);
   }
  }
  report.push({mode,passed:true});console.log('PASS native geometry',mode);
 }
 writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));
}finally{await context.close();await browser.close();}
