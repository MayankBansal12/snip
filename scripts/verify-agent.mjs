import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { chromium } from 'playwright-core';
import { WebSocket } from 'ws';

const sample=process.env.VIDEO_SAMPLE;
if(!sample)throw new Error('Set VIDEO_SAMPLE to an eight-second video with audio.');
const out=process.env.VERIFY_OUTPUT||'/tmp/snip-engine-verification';mkdirSync(out,{recursive:true});
const client=new Client({name:'snip-verification',version:'1.0.0'});
const transport=new StdioClientTransport({command:process.execPath,args:[resolve('scripts/mcp-server.mjs')],stderr:'pipe'});
const browser=await chromium.connectOverCDP(process.env.CDP_URL||'http://127.0.0.1:19410');
const context=await browser.newContext({acceptDownloads:true,viewport:{width:1280,height:900}});
const page=await context.newPage(),errors=[],report=[];
page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(20000);
const log=(check,details={})=>{report.push({check,...details});console.log('PASS',check,JSON.stringify(details));};
async function call(name,args={}) {const result=await client.callTool({name,arguments:args});if(result.isError)throw new Error(result.content[0].text);return JSON.parse(result.content[0].text);}
const button=name=>page.getByRole('button',{name,exact:true});
const unFocus=()=>page.evaluate(()=>document.activeElement instanceof HTMLElement&&document.activeElement.blur());
try {
  await client.connect(transport);
  const tools=await client.listTools();assert.equal(tools.tools.length,5);
  const pairing=await call('get_connection'),url=new URL(pairing.url),token=url.hash.slice(7);
  const forbidden=await fetch(url.origin,{headers:{Origin:'https://untrusted.example'}});assert.equal(forbidden.status,403);
  await new Promise((resolve,reject)=>{const socket=new WebSocket(`${url.origin.replace('http:','ws:')}/agent?token=${token}`,{origin:'https://untrusted.example'});socket.on('open',()=>{socket.close();reject(new Error('Unauthorized origin accepted'));});socket.on('error',()=>resolve());});
  await assert.rejects(()=>call('get_project'),/No editor connected/);
  log('MCP discovery works; unpaired and foreign-origin connections are rejected');
  await page.goto(pairing.url);await button('connect agent').click();
  await page.waitForFunction(()=>document.body.textContent.includes('agent connected'));
  // Reopening a pairing fragment in the same tab must require consent again.
  await button('agent connected · disconnect').click();
  await page.goto(pairing.url);await button('connect agent').waitFor();
  assert.equal(await page.evaluate(()=>location.hash),'');
  assert.equal((await call('get_connection')).connected,false);
  await button('connect agent').click();
  await page.waitForFunction(()=>document.body.textContent.includes('agent connected'));
  await page.getByRole('alertdialog').waitFor({state:'hidden'});
  log('Same-tab pairing reconnects with explicit consent and clears the token');
  await button('select your video').waitFor();await page.locator('#video-file').setInputFiles(sample);
  await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2);
  // Trim handles stop propagation and retain a clip snapshot while dragging.
  let dragProject=await call('get_project');
  const handle=await page.getByRole('slider',{name:'Clip 1 start',exact:true}).boundingBox();
  await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();
  const dragBatch={sessionId:dragProject.sessionId,revision:dragProject.revision,requestId:'during-drag',commands:[{action:'setSpeed',clipId:dragProject.specification.edits.clips[0].id,speed:3}]};
  await assert.rejects(()=>call('apply_edits',dragBatch),/pointer interaction/);
  assert.equal((await call('get_project')).revision,dragProject.revision);
  await page.mouse.move(handle.x+handle.width/2+40,handle.y+handle.height/2);await page.mouse.up();
  assert.equal((await call('get_project')).specification.edits.clips[0].speed,1);
  await button('undo').click();
  dragProject=await call('get_project');
  // A rejected drag request did not consume its request ID.
  await call('apply_edits',{...dragBatch,revision:dragProject.revision});
  assert.equal((await call('get_project')).specification.edits.clips[0].speed,3);
  await button('undo').click();
  assert.equal((await call('get_project')).specification.edits.clips[0].speed,1);
  log('Trim drags reject agent mutations without consuming revision or request ID');
  const before=await call('get_project');assert(before.specification.source.sha256.length===64);
  const clipId=before.specification.edits.clips[0].id;
  const batch={sessionId:before.sessionId,revision:before.revision,requestId:'edit-1',commands:[
    {action:'splitClip',clipId,sourceTime:4,rightClipId:'demo'},
    {action:'trimClip',clipId,sourceStart:1,sourceEnd:4},
    {action:'setSpeed',clipId:'demo',speed:2},
    {action:'setZoom',clipId:'demo',zoom:{scale:2,x:.5,y:.5}},
  ]};
  const applied=await call('apply_edits',batch);assert.equal(applied.revision,before.revision+1);
  assert.equal((await call('apply_edits',batch)).duplicate,true);
  assert.equal(await page.locator('.timeline-clip').count(),2);
  let project=await call('get_project');assert.equal(project.duration,5);
  await assert.rejects(()=>call('apply_edits',{...batch,requestId:'stale'}),/revision/);
  await assert.rejects(()=>call('apply_edits',{...batch,requestId:'invalid',revision:project.revision,commands:[{action:'setSpeed',clipId,speed:1.5},{action:'deleteClip',clipId:'no-such-clip'}]}));
  assert.deepEqual((await call('get_project')).specification,project.specification);
  log('MCP edits update the real editor; retries, stale edits, and invalid batches preserve state',{duration:project.duration});
  await unFocus();await page.keyboard.press('Control+z');assert.equal(await page.locator('.timeline-clip').count(),1);
  const undone=await call('get_project');assert(undone.revision>project.revision);
  await page.keyboard.press('Control+Shift+z');assert.equal(await page.locator('.timeline-clip').count(),2);
  project=await call('get_project');assert.deepEqual(project.specification.edits,(await call('get_project')).specification.edits);
  log('An agent batch is one undo step and human undo advances revision');
  assert.equal(await button('edit with your agent').count(),0);
  await button('project menu').click();
  assert.equal(await page.getByRole('menuitem',{name:'edit JSON',exact:true}).count(),0);
  await page.getByRole('menu').focus();await page.keyboard.press('Escape');
  await page.getByRole('menu').waitFor({state:'hidden'});
  const files=[];
  for(let i=0;i<2;i++){
    const request={requestId:`export-${i}`,sessionId:project.sessionId,revision:project.revision};
    const download=page.waitForEvent('download',{timeout:180000});
    const job=await call('start_export',request);assert.equal(job.status,'running');
    assert.equal((await call('start_export',request)).id,job.id);
    await assert.rejects(()=>call('apply_edits',{...batch,requestId:`busy-${i}`,revision:project.revision}),/busy/);
    const result=await download,path=`${out}/export-${i}.mp4`;assert.equal(result.suggestedFilename().endsWith('.mp4'),true);
    const bytes=await page.evaluate(async()=>{const a=document.querySelector('a[download]');if(!a)throw new Error('Missing download link');return Array.from(new Uint8Array(await (await fetch(a.href)).arrayBuffer()));});
    writeFileSync(path,Buffer.from(bytes));files.push(path);
    const status=await call('get_export_status');assert.equal(status.status,'complete');assert(status.size>100);
    await button('back to editing').click();
  }
  const ffmpeg=process.env.FFMPEG_PATH,ffprobe=process.env.FFPROBE_PATH;
  if(!ffmpeg||!ffprobe)throw new Error('Set FFMPEG_PATH and FFPROBE_PATH to verify decoded exports.');
  const probe=JSON.parse(execFileSync(ffprobe,['-v','error','-show_format','-show_streams','-of','json',files[0]],{encoding:'utf8'}));
  assert(Math.abs(Number(probe.format.duration)-5)<.1);assert.equal(probe.streams.find(s=>s.codec_type==='video').width,320);assert(probe.streams.some(s=>s.codec_type==='audio'));
  for(const stream of ['0:v:0','0:a:0']){
    const digest=file=>execFileSync(ffmpeg,['-v','error','-i',file,'-map',stream,'-f','framemd5','-'],{encoding:'utf8',maxBuffer:10*1024*1024});
    assert.equal(digest(files[0]),digest(files[1]),`${stream} must decode identically across repeated exports`);
  }
  log('Two browser exports have identical decoded video/audio, expected duration, dimensions, and audio',{duration:probe.format.duration});
  // Verify the first kept frame against an independent source decode, not the engine itself.
  const raw=args=>execFileSync(ffmpeg,['-v','error',...args,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],{maxBuffer:1024*1024});
  const actual=raw(['-i',files[0]]),expected=raw(['-ss','1','-i',sample]);
  assert.equal(actual.length,expected.length);let distance=0;for(let i=0;i<actual.length;i++)distance+=Math.abs(actual[i]-expected[i]);
  assert(distance/actual.length<12);log('Export starts at the requested source second',{meanPixelError:distance/actual.length});
  const unchanged=(await call('get_project')).specification.edits;
  await call('start_export',{requestId:'cancel-export',sessionId:project.sessionId,revision:project.revision});
  await button('cancel export').click();await button('keep editing').waitFor();
  assert.equal((await call('get_export_status')).status,'cancelled');
  await button('keep editing').click();
  assert.deepEqual((await call('get_project')).specification.edits,unchanged);
  await assert.rejects(()=>call('start_export',{requestId:'export-0',sessionId:project.sessionId,revision:project.revision}),/already handled/);
  log('Cancellation preserves edits and old export retries cannot create a second job');
  await call('apply_edits',{sessionId:project.sessionId,revision:project.revision,requestId:'webm-settings',commands:[{action:'setOutput',format:'webm',muted:true}]});
  project=await call('get_project');
  const webmDownload=page.waitForEvent('download',{timeout:180000});
  await call('start_export',{requestId:'webm-export',sessionId:project.sessionId,revision:project.revision});
  assert((await webmDownload).suggestedFilename().endsWith('.webm'));
  const webmBytes=await page.evaluate(async()=>Array.from(new Uint8Array(await(await fetch(document.querySelector('a[download]').href)).arrayBuffer())));
  const webmPath=`${out}/export.webm`;writeFileSync(webmPath,Buffer.from(webmBytes));
  const webmProbe=JSON.parse(execFileSync(ffprobe,['-v','error','-show_format','-show_streams','-of','json',webmPath],{encoding:'utf8'}));
  assert.equal(webmProbe.streams.filter(s=>s.codec_type==='audio').length,0);
  assert.equal(webmProbe.streams.find(s=>s.codec_type==='video').codec_name,'vp8');
  assert(Math.abs(Number(webmProbe.format.duration)-5)<.1);
  log('WebM output settings and mute produce the expected browser export');
  await button('back to editing').click();await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  project=await call('get_project');
  await call('apply_edits',{sessionId:project.sessionId,revision:project.revision,requestId:'tiny-trim',commands:[
    {action:'deleteClip',clipId:'demo'},
    {action:'trimClip',clipId,sourceStart:1.001,sourceEnd:1.002},
    {action:'setSpeed',clipId,speed:2},
    {action:'setOutput',format:'mp4',muted:false},
  ]});
  project=await call('get_project');let unexpectedDownload=false;
  page.on('download',()=>{unexpectedDownload=true;});
  await call('start_export',{sessionId:project.sessionId,revision:project.revision,requestId:'tiny-export'});
  let tinyJob;for(let i=0;i<240;i++){tinyJob=await call('get_export_status');if(tinyJob.status!=='running')break;await page.waitForTimeout(250);}
  assert.equal(tinyJob.status,'failed');assert.match(tinyJob.error,/no readable video/);assert.equal(unexpectedDownload,false);
  assert.deepEqual((await call('get_project')).specification.edits,project.specification.edits);
  log('A sub-frame trim cannot report a successful audio-only video export');
  assert.deepEqual(errors,[]);writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));
} finally {await client.close();await context.close();await browser.close();}
