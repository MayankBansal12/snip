// Live acceptance checks. The running Snip server holds the Jev credential.
import assert from 'node:assert/strict';
import { applyCommands } from '../src/engine/index';
import { defaults } from '../src/types';
import type { Edits } from '../src/types';

const base = () => { const edits = defaults(50.2); edits.clips[0].id = 'a'; return edits; };
const twoClips = () => ({ ...base(), clips: [{ id:'a', start:0, end:4 }, { id:'b', start:6, end:50.2 }] });
type Case = { suite?: 'ordered'; text: string; edits?: Edits; time?: number; error?: RegExp; check?: (edits: Edits) => void; rejected?: boolean };
const cases: Case[] = [
  { suite:'ordered', text:'zoom clip 1 to 1.5x, make clip 2 twice as fast, split at 12 seconds, and zoom the last part to 3x', edits:{...base(),clips:[{id:'a',start:0,end:10},{id:'b',start:10,end:50.2}]}, check:e=>assert.deepEqual(e.clips.map(c=>[c.start,c.end,c.speed,c.zoom?.scale]),[[0,10,1,1.5],[10,14,2,1],[14,50.2,2,3]]) },
  { suite:'ordered', text:'zoom clip 1 to 2x and zoom clip 2 to 3x', edits:twoClips(), check:e=>assert.deepEqual(e.clips.map(c=>c.zoom?.scale),[2,3]) },
  { suite:'ordered', text:'zoom clip 1 to 2x, clip 2 to 3x', edits:twoClips(), check:e=>assert.deepEqual(e.clips.map(c=>c.zoom?.scale),[2,3]) },
  { suite:'ordered', text:'make clip 1 2x faster and make clip 2 half speed', edits:twoClips(), check:e=>assert.deepEqual(e.clips.map(c=>c.speed),[2,.5]) },
  { suite:'ordered', text:'split at 4 and 8 seconds, zoom the middle part to 2x, and zoom the last part to 3x', check:e=>assert.deepEqual(e.clips.map(c=>[c.start,c.end,c.zoom?.scale]),[[0,4,1],[4,8,2],[8,50.2,3]]) },
  { suite:'ordered', text:'split clip 2 at 4 and 8 seconds', edits:twoClips(), check:e=>assert.deepEqual(e.clips.map(c=>[c.start,c.end]),[[0,4],[6,10],[10,14],[14,50.2]]) },
  { suite:'ordered', text:'split at 4 seconds then zoom the right part to 2x then make it faster', check:e=>assert.deepEqual(e.clips.map(c=>[c.start,c.end,c.speed,c.zoom?.scale]),[[0,4,1,1],[4,50.2,2,2]]) },
  { suite:'ordered', text:'make the video 2x faster then split at 4 seconds', check:e=>assert.deepEqual(e.clips.map(c=>[c.start,c.end,c.speed]),[[0,8,2],[8,50.2,2]]) },
  { suite:'ordered', text:'split at 4 seconds then make the video 2x faster', check:e=>assert.deepEqual(e.clips.map(c=>[c.start,c.end,c.speed]),[[0,4,2],[4,50.2,2]]) },
  { suite:'ordered', text:'trim the first 1 second from clip 1 then trim the last 2 seconds from clip 2', edits:twoClips(), check:e=>assert.deepEqual(e.clips.map(c=>[c.start,c.end]),[[1,4],[6,48.2]]) },
  { suite:'ordered', text:'merge clips 1 and 2 then zoom the merged clip to 2x', edits:{...base(),clips:[{id:'a',start:0,end:4},{id:'b',start:4,end:50.2}]}, check:e=>assert.deepEqual(e.clips.map(c=>[c.start,c.end,c.zoom?.scale]),[[0,50.2,2]]) },
  { suite:'ordered', text:'zoom clip 1 to 2x at top left and zoom clip 2 to 3x at bottom right', edits:twoClips(), check:e=>assert.deepEqual(e.clips.map(c=>c.zoom),[{scale:2,x:0,y:0},{scale:3,x:1,y:1}]) },
  { suite:'ordered', text:'zoom clip 1 to 2x then split at 90 seconds', rejected:true },
  { suite:'ordered', text:'zoom clip 1 to 2x and add captions', rejected:true },
  { suite:'ordered', text:'split at 4 seconds then split at 8 seconds then zoom the last part more', check:e=>assert.deepEqual(e.clips.map(c=>[c.start,c.end,c.zoom?.scale]),[[0,4,1],[4,8,1],[8,50.2,1.5]]) },

  { text:'split 3 seconds after', check:e=>assert.equal(e.clips[0].end,10.6) },
  { text:'split in 3 seconds', check:e=>assert.equal(e.clips[0].end,10.6) },
  { text:'split three seconds from here', check:e=>assert.equal(e.clips[0].end,10.6) },
  { text:'cut 3 seconds later', check:e=>assert.equal(e.clips[0].end,10.6) },
  { text:'split 3 seconds before', check:e=>assert.equal(e.clips[0].end,4.6) },
  { text:'split here', check:e=>assert.equal(e.clips[0].end,7.6) },
  { text:'split at 3 seconds', check:e=>assert.equal(e.clips[0].end,3) },
  { text:'split 3 seconds after', edits:twoClips(), check:e=>assert.equal(e.clips[1].end,12.6) },
  { text:'split 3 seconds after', time:2, edits:{...base(),clips:[{id:'a',start:14,end:20,speed:2},{id:'b',start:0,end:10,speed:1}]}, check:e=>assert.deepEqual(e.clips.map(c=>[c.start,c.end,c.speed]),[[14,20,2],[0,2,1],[2,10,1]]) },
  { text:'split 3 seconds after', time:49, rejected:true, error:/lands at 52s, outside/ },
  { text:'split 3 seconds before', time:2, rejected:true, error:/lands at -1s, outside/ },
  { text:'split at 4 seconds and remove the last 2 seconds', check:e=>assert.deepEqual(e.clips.map(c=>[c.start,c.end]),[[0,4],[4,48.2]]) },
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
let failures=0, windowStart=Date.now();
const selected=process.env.PROMPT_SUITE?cases.filter(c=>c.suite===process.env.PROMPT_SUITE):cases;
for (const [i, item] of selected.entries()) {
  if(i&&i%25===0){const delay=Math.max(0,61000-(Date.now()-windowStart));if(delay){console.log('Waiting for the preview request window…');await new Promise(resolve=>setTimeout(resolve,delay));}windowStart=Date.now();}
  const edits = item.edits ?? base(), start = performance.now();
  const response = await fetch(`${process.env.SNIP_URL || 'http://127.0.0.1:52947'}/api/edit`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({text:item.text,requestId:`prompt-test-${i}`,sessionId:'live-acceptance',revision:0,project:{duration:50.2,edits,selectedClip:edits.clips[0].id,time:item.time ?? 7.6}}),
  });
  const result=await response.json();
  try {
    if(item.rejected) {assert.equal(response.status,422);if(item.error)assert.match(result.error,item.error);}
    else {assert.equal(response.status,200,JSON.stringify(result));assert(Array.isArray(result.changes));item.check!(applyCommands(edits,result.batch.commands,50.2));}
    console.log(`PASS ${item.text} (${Math.round(performance.now()-start)}ms)${item.edits?' [edited timeline]':''}`);
  } catch(error) {failures++;console.error(`FAIL ${item.text}: ${error instanceof Error?error.message:error}`);}
}
assert.equal(failures,0,`${failures} live prompt checks failed`);
