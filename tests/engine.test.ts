import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommands, compileTimeline, createSpecification, EditSession, normalizeEdits, parseJSON, readSpecification } from '../src/engine/index.ts';
import { identifySource } from '../src/engine/source.ts';
import { defaults } from '../src/types.ts';
import type { Source } from '../src/types.ts';
import { createHash } from 'node:crypto';

const base = () => ({ ...defaults(10), clips: [{ id:'a', start:0, end:10 }] });
const source: Source = {file:new Blob(['test']),name:'test.mp4',width:640,height:360,duration:10};
const commands = [{action:'splitClip',clipId:'a',sourceTime:4,rightClipId:'b'}, {action:'trimClip',clipId:'a',sourceStart:1,sourceEnd:4}, {action:'setSpeed',clipId:'b',speed:2}, {action:'setZoom',clipId:'b',zoom:{scale:2,x:.25,y:.75}}];

test('explicit commands yield repeatable state and independently expected timing', () => {
  const input=base(),before=structuredClone(input);
  const first=applyCommands(input,commands,10),second=applyCommands(input,commands,10);
  assert.deepEqual(first,second);assert.deepEqual(input,before);
  assert.deepEqual(first.clips,[{id:'a',start:1,end:4,speed:1,zoom:{scale:1,x:.5,y:.5}},{id:'b',start:4,end:10,speed:2,zoom:{scale:2,x:.25,y:.75}}]);
  const plan=compileTimeline(source,first);assert.equal(plan.duration,6);
  assert.deepEqual(plan.clips.map(c=>[c.sequenceStart,c.sequenceEnd]),[[0,3],[3,6]]);
});
test('a failing later command rolls back the whole batch', () => {
  const input=base(),before=structuredClone(input);
  assert.throws(()=>applyCommands(input,[...commands,{action:'trimClip',clipId:'b',sourceStart:2,sourceEnd:11}],10));
  assert.deepEqual(input,before);
});
test('validation rejects invalid values, duplicate IDs, overlaps, empty projects, and unknown fields', () => {
  for(const command of [
    {action:'splitClip',clipId:'a',sourceTime:4,rightClipId:'a'},
    {action:'splitClip',clipId:'a',sourceTime:NaN,rightClipId:'b'},
    {action:'deleteClip',clipId:'a'},
    {action:'setSpeed',clipId:'a',speed:Infinity},
    {action:'setSpeed',clipId:'a'},
    {action:'setSpeed',clipId:'a',speed:0},
    {action:'setSpeed',clipId:'a',speed:2,typo:true},
    {action:'setZoom',clipId:'a',zoom:{scale:2,x:2,y:0}},
    {action:'setOutput',resolution:'999'},
    {action:'explode',clipId:'a'},
    {action:'trimClip',clipId:'missing',sourceStart:0,sourceEnd:1},
  ]) assert.throws(()=>applyCommands(base(),[command],10));
  assert.throws(()=>normalizeEdits({...base(),clips:[{id:'a',start:0,end:5},{id:'b',start:4,end:10}]},10));
  assert.throws(()=>normalizeEdits({...base(),clips:[{id:'a',start:0,end:10.01}]},10));
  assert.throws(()=>parseJSON('not JSON'));
});
test('source identity is streaming SHA-256; specification roundtrip is source-bound', async () => {
  const info=await identifySource(source);assert.equal(info.sha256,createHash('sha256').update('test').digest('hex'));
  const spec=createSpecification(info,base());
  assert.deepEqual(readSpecification(parseJSON(JSON.stringify(spec)),info),spec);
  assert.throws(()=>readSpecification(spec,{...info,sha256:'different'}));
  assert.throws(()=>readSpecification({...spec,version:2},info));
  assert.throws(()=>readSpecification({...spec,edits:{...spec.edits,clpis:[]}},info));
  assert.throws(()=>readSpecification({...spec,renderer:'auto'},info));
});
test('revision and session checks prevent stale edits and duplicate retries', () => {
  const session=new EditSession('session'),batch={requestId:'r1',sessionId:'session',revision:0,commands};
  const applied=session.apply(batch,base(),10);assert.equal(applied.revision,1);
  const retry=session.apply(batch,applied.edits,10);assert.equal(retry.duplicate,true);assert.deepEqual(retry.edits,applied.edits);assert.equal(session.revision,1);
  assert.throws(()=>session.apply({...batch,commands:[]},applied.edits,10),/different contents/);
  assert.throws(()=>session.apply({...batch,requestId:'r2'},applied.edits,10),/revision/);
  assert.throws(()=>session.apply({...batch,sessionId:'old'},applied.edits,10),/session/);
  session.changed(); // a human edit or undo also advances the revision
  assert.equal(session.revision,2);
  const afterUndo=base();assert.deepEqual(session.apply(batch,afterUndo,10).edits,afterUndo);
});
test('invalid batches do not advance revision or consume request IDs', () => {
  const session=new EditSession('session'),batch={requestId:'r',sessionId:'session',revision:0,commands:[{action:'deleteClip',clipId:'a'}]};
  assert.throws(()=>session.apply(batch,base(),10));assert.equal(session.revision,0);
  assert.equal(session.apply({...batch,commands},base(),10).revision,1);
});
test('reordering is explicit and merge preserves effects and source gaps', () => {
  const split=applyCommands(base(),commands.slice(0,1),10);
  const swapped=applyCommands(split,[{action:'reorderClips',clipIds:['b','a']}],10);
  assert.deepEqual(swapped.clips.map(c=>c.id),['b','a']);
  assert.throws(()=>applyCommands(swapped,[{action:'mergeClips',clipId:'b'}],10));
  assert.equal(applyCommands(split,[{action:'mergeClips',clipId:'a'}],10).clips.length,1);
  assert.throws(()=>applyCommands(applyCommands(base(),commands,10),[{action:'mergeClips',clipId:'a'}],10));
});
