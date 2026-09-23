import assert from 'node:assert/strict';
import test from 'node:test';
import { boundary, frameAt, nearestBoundary, retainedFrames, stepBoundary, trimBoundary } from '../src/frame-timing';
import { applyCommands, EditSession } from '../src/engine';
import { defaults } from '../src/types';

const frames={times:Float64Array.from([0,.017,.05,.067,.12]),end:.2};
test('variable-rate frames step by actual timestamps and respect exclusive ends',()=>{
  assert.equal(stepBoundary(frames,.017,1),.05);
  assert.equal(stepBoundary(frames,.05,-1),.017);
  assert.equal(stepBoundary(frames,.12,1),.2);
  assert.equal(stepBoundary(frames,.2,1),.2);
  assert.equal(frameAt(frames,.049,{start:0,end:.12}),1);
  assert.equal(frameAt(frames,.12,{start:0,end:.12}),3);
  assert.deepEqual(retainedFrames(frames,{start:.017,end:.067}),{first:1,after:3});
  assert.equal(nearestBoundary(frames,.0335),.017);
  assert.equal(boundary(frames,5),.2);
});
test('dragging either edge preserves at least one source frame without crossing neighbors',()=>{
  const clip={id:'a',start:.017,end:.12};
  assert.equal(trimBoundary(frames,clip,'start',.2,{start:0,end:.2}),.067);
  assert.equal(trimBoundary(frames,clip,'end',0,{start:0,end:.2}),.05);
  assert.equal(trimBoundary(frames,clip,'end',.2,{start:0,end:.12}),.12);
});
test('agent commands snap consistently, allow single-frame clips and reject empty/sub-frame ranges atomically',()=>{
  const edits=defaults(.2),id=edits.clips[0].id;
  const trimmed=applyCommands(edits,[{action:'trimClip',clipId:id,sourceStart:.014,sourceEnd:.052}],.2,frames);
  assert.equal(trimmed.clips[0].start,.017);assert.equal(trimmed.clips[0].end,.05);
  const split=applyCommands(edits,[{action:'splitClip',clipId:id,sourceTime:.017,rightClipId:'right'}],.2,frames);
  assert.equal(split.clips[0].end,.017);
  const session=new EditSession('session');
  assert.throws(()=>session.apply({sessionId:'session',revision:0,requestId:'tiny',commands:[{action:'trimClip',clipId:id,sourceStart:.051,sourceEnd:.052}]},edits,.2,frames));
  assert.equal(session.revision,0);assert.equal(edits.clips[0].end,.2);
  for(const bad of [NaN,Infinity,-1,2]) assert.throws(()=>applyCommands(edits,[{action:'splitClip',clipId:id,sourceTime:bad,rightClipId:'bad'}],.2,frames));
});
