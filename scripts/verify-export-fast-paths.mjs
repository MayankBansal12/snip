import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const ffmpeg=process.env.FFMPEG_PATH || 'ffmpeg', ffprobe=process.env.FFPROBE_PATH || 'ffprobe';
const out=process.env.VERIFY_OUTPUT || '/tmp/snip-export-fast-paths';mkdirSync(out,{recursive:true});
const input=`${out}/source.mp4`;
execFileSync(ffmpeg,['-v','error','-y','-f','lavfi','-i','testsrc2=size=320x180:rate=30:duration=2','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=2','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',input]);
const bytes=Array.from(readFileSync(input));
const browser=await chromium.connectOverCDP(process.env.CDP_URL || 'http://127.0.0.1:9234');
const results=[];
try{
 for(const mode of (process.env.VERIFY_MODES?.split(',') || ['threads','no-isolation','missing-thread-assets','no-native-encoder','missing-native-module'])){
  const context=await browser.newContext();
  try{
   await context.addInitScript(() => {
     window.__nativeEncodes=0;
     if(typeof VideoEncoder!=='undefined'){const encode=VideoEncoder.prototype.encode;VideoEncoder.prototype.encode=function(...args){window.__nativeEncodes++;return encode.apply(this,args);};}
   });
   if(mode==='no-native-encoder')await context.addInitScript(()=>{Object.defineProperty(globalThis,'VideoEncoder',{value:undefined,configurable:true});});
   if(mode==='missing-native-module')await context.route('**/src/native-export.ts*',route=>route.abort());
   if(mode==='no-isolation')await context.route('**/*',async route=>{const response=await route.fetch();const headers={...response.headers()};delete headers['cross-origin-opener-policy'];delete headers['cross-origin-embedder-policy'];await route.fulfill({response,headers});});
   if(mode==='missing-thread-assets')await context.route('**/ffmpeg/mt/**',route=>route.abort());
   const page=await context.newPage();await page.goto(process.env.APP_URL || 'http://127.0.0.1:5206');
   const result=await page.evaluate(async bytes=>{
    const {readMetadata}=await import('/src/media.ts');const {defaults}=await import('/src/types.ts');
    const {exportVideo,canCopyPicture,cancelExport}=await import('/src/export.ts');
    const source=await readMetadata(new File([new Uint8Array(bytes)],'source.mp4',{type:'video/mp4'}));
    const base=defaults(source.duration);
    const mutations=[{quality:'compact'},{format:'webm'},{resolution:'180'},{speed:2},{crop:{x:.1,y:0,width:.9,height:1}},{canvas:{...base.canvas,inset:5}},{filter:'Mono'},{brightness:1},{contrast:1},{annotations:[{id:'text',type:'text',x:.5,y:.5,width:0,height:0,text:'hello',color:'#fff',size:.1}]},{clips:[{...base.clips[0],start:.137}]},{clips:[{...base.clips[0],end:1.4}]},{clips:[{...base.clips[0],zoom:{scale:1.5,x:.5,y:.5}}]}];
    if(!canCopyPicture(source,base)||mutations.some(patch=>canCopyPicture(source,{...base,...patch})))throw new Error('Fast path accepted an edit requiring rendering');
    const outputs={};
    for(const [name,patch] of [['unchanged',{}],['muted',{muted:true}],['trimmed',{clips:[{...base.clips[0],start:.137,end:1.437}]}],['webm',{format:'webm',resolution:'180'}],['graded',{brightness:10}],['annotated',{clips:[{id:'a',start:1,end:1.5,speed:1.5},{id:'b',start:.1,end:.8,zoom:{scale:1.5,x:.4,y:.3}}],annotations:[{id:'t',type:'text',x:.5,y:.5,width:0,height:0,text:'test',color:'#ffffff',size:.12}]}]]){
      const blob=await exportVideo(source,{...base,...patch},()=>{});outputs[name]=Array.from(new Uint8Array(await blob.arrayBuffer()));
    }
    let cancelled=false;
    try{await exportVideo(source,{...base,resolution:'180'},(_fraction,stage)=>{if(stage==='Exporting your video')cancelExport();});}catch{cancelled=true;}
    if(!cancelled)throw new Error('Cancel must reject the export');
    await exportVideo(source,base,()=>{});
    return {outputs,isolated:crossOriginIsolated,nativeEncodes:window.__nativeEncodes};
   },bytes);
   assert.equal(result.isolated,mode!=='no-isolation');
   assert.equal(result.nativeEncodes>0,!['no-native-encoder','missing-native-module'].includes(mode),'Native encoder must run or fall back as requested');
   assert.deepEqual(result.outputs.unchanged,bytes,'Unchanged export must preserve all bytes');
   for(const [name,data] of Object.entries(result.outputs)){
    const filename=`${out}/${mode}-${name}.${name==='webm'?'webm':'mp4'}`;writeFileSync(filename,Buffer.from(data));
    const probe=JSON.parse(execFileSync(ffprobe,['-v','error','-show_streams','-show_format','-of','json',filename]));
    assert.equal(probe.streams.find(s=>s.codec_type==='video').codec_name,name==='webm'?'vp8':'h264');
    assert.equal(probe.streams.some(s=>s.codec_type==='audio'),name!=='muted');
    if(name==='trimmed')assert(Math.abs(Number(probe.format.duration)-1.3)<.1,'Trim duration must stay accurate');
    execFileSync(ffmpeg,['-v','error','-threads','1','-i',filename,'-f','null','-']);
   }
   results.push({mode,passed:true,nativeEncodes:result.nativeEncodes});console.log('PASS',mode,'identity, mute, accurate trim, WebM, cancellation and recovery');
  }finally{await context.close();}
 }
 writeFileSync(`${out}/report.json`,JSON.stringify(results,null,2));
}finally{await browser.close();}
