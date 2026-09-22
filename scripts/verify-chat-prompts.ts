// Live acceptance checks. The running Snip server holds the Jev credential.
import assert from 'node:assert/strict';
import { applyCommands } from '../src/engine/index';
import { defaults } from '../src/types';
import type { Edits } from '../src/types';

const base = () => { const edits = defaults(50.2); edits.clips[0].id = 'a'; return edits; };
const twoClips = () => ({ ...base(), clips: [{ id:'a', start:0, end:4 }, { id:'b', start:6, end:50.2 }] });
type Case = { text: string; edits?: Edits; check?: (edits: Edits) => void; rejected?: boolean };
const cases: Case[] = [
  { text:'split at 4 seconds', check:e=>assert.deepEqual(e.clips.map(c=>[c.start,c.end]),[[0,4],[4,50.2]]) },
  { text:'cut at 00:04', check:e=>assert.equal(e.clips[0].end,4) },
  { text:'split in half', check:e=>assert.equal(e.clips[0].end,25.1) },
  { text:'trim 5 seconds and apply 2x zoom in middle', check:e=>{assert.equal(e.clips[0].start,5);assert.deepEqual(e.clips[0].zoom,{scale:2,x:.5,y:.5});} },
  { text:'trim 5 seconds and apply 2x zoom in middle', edits:twoClips(), check:e=>{assert.equal(e.clips[0].start,7);assert.deepEqual(e.clips[0].zoom,{scale:2,x:.5,y:.5});} },
  { text:'zoom needs to be in top left side', edits:{...base(), clips:[{id:'a',start:0,end:50.2,zoom:{scale:2,x:.5,y:.5}}]}, check:e=>assert.deepEqual(e.clips[0].zoom,{scale:2,x:0,y:0}) },
  { text:'split at 4 seconds and make the second clip 2x faster', check:e=>{assert.equal(e.clips[0].end,4);assert.equal(e.clips[0].speed,1);assert.equal(e.clips[1].speed,2);} },
  { text:'make the whole video 2x faster', edits:twoClips(), check:e=>assert(e.clips.every(c=>c.speed===2)) },
  { text:'remove the last 2 seconds', check:e=>assert.equal(e.clips[0].end,48.2) },
  { text:'keep only 3 to 8 seconds', check:e=>assert.deepEqual(e.clips.map(c=>[c.start,c.end]),[[3,8]]) },
  { text:'remove 2 to 4 seconds', check:e=>assert.deepEqual(e.clips.map(c=>[c.start,c.end]),[[0,2],[4,50.2]]) },
  { text:'delete the second clip', edits:twoClips(), check:e=>assert.deepEqual(e.clips.map(c=>c.id),['a']) },
  { text:'set the output to 720p webm and mute it', check:e=>{assert.equal(e.resolution,'720');assert.equal(e.format,'webm');assert.equal(e.muted,true);} },
  { text:'mute the audio and add subtitles', rejected:true },
];
let failures=0;
for (const [i, item] of cases.entries()) {
  const edits = item.edits ?? base(), start = performance.now();
  const response = await fetch(`${process.env.SNIP_URL || 'http://127.0.0.1:52945'}/api/edit`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({text:item.text,requestId:`prompt-test-${i}`,sessionId:'live-acceptance',revision:0,project:{duration:50.2,edits,selectedClip:edits.clips[0].id,time:7.6}}),
  });
  const result=await response.json();
  try {
    if(item.rejected) assert.equal(response.status,422);
    else {assert.equal(response.status,200,JSON.stringify(result));item.check!(applyCommands(edits,result.batch.commands,50.2));}
    console.log(`PASS ${item.text} (${Math.round(performance.now()-start)}ms)${item.edits?' [edited timeline]':''}`);
  } catch(error) {failures++;console.error(`FAIL ${item.text}: ${error instanceof Error?error.message:error}`);}
}
assert.equal(failures,0,`${failures} live prompt checks failed`);
