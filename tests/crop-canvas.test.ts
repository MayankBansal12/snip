import test from 'node:test';
import assert from 'node:assert/strict';
import { cropForRatio, moveCrop, resizeCrop } from '../src/crop.ts';
import { defaults, canvasSize, outputSize, placement } from '../src/types.ts';
import { normalizeEdits, createSpecification, readSpecification } from '../src/engine/index.ts';
import type { Source } from '../src/types.ts';
const source: Source = {file:new Blob(),name:'test.mp4',width:1920,height:1080,duration:10};

test('crop presets keep a centered region with the requested physical ratio', () => {
  for (const sourceRatio of [16/9,9/16,1]) for (const ratio of [1,16/9,9/16,4/5]) {
    const crop=cropForRatio(sourceRatio,ratio);
    assert(Math.abs(crop.width*sourceRatio/crop.height-ratio)<1e-9);
    assert(Math.abs(crop.x*2+crop.width-1)<1e-9);
    assert(Math.abs(crop.y*2+crop.height-1)<1e-9);
  }
});
test('crop dragging and resizing stay in bounds and preserve locked ratios at every corner', () => {
  const start={x:.2,y:.2,width:.5,height:.5};
  assert.deepEqual(moveCrop(start,10,-10),{...start,x:.5,y:0});
  for(const corner of ['nw','ne','sw','se']) for(const dx of [-10,-.1,.1,10]) for(const dy of [-10,-.1,.1,10]) {
    const crop=resizeCrop(start,corner,dx,dy,16/9,16/9);
    assert(crop.x>=-1e-9&&crop.y>=-1e-9&&crop.width>0&&crop.height>0);
    assert(crop.x+crop.width<=1+1e-9&&crop.y+crop.height<=1+1e-9);
    assert(Math.abs(crop.width/crop.height-1)<1e-9);
  }
});
test('custom pixel dimensions survive serialization and override crop-derived output size', () => {
  const base=defaults(10);
  const edits=normalizeEdits({...base,crop:cropForRatio(16/9,1),canvas:{...base.canvas,aspect:'Custom',outputWidth:640,outputHeight:960}},10);
  assert.deepEqual(canvasSize(source,edits),{width:640,height:960});
  assert.deepEqual(outputSize(source,edits),{width:640,height:960});
  assert.deepEqual(outputSize(source,{...edits,resolution:'480'}),{width:480,height:720});
  assert.deepEqual(placement(source,edits,{width:640,height:960}),{width:640,height:640,x:0,y:160});
  const info={sha256:'test',size:0,width:1920,height:1080,duration:10};
  const spec=createSpecification(info,edits);
  assert.deepEqual(readSpecification(JSON.parse(JSON.stringify(spec)),info),spec);
});
test('legacy custom aspect quantities retain their previous meaning', () => {
  const base=defaults(10);
  const edits=normalizeEdits({...base,canvas:{...base.canvas,aspect:'Custom',ratio:1,customWidth:1,customHeight:1}},10);
  assert.deepEqual(canvasSize(source,edits),{width:1080,height:1080});
});
test('incomplete, odd, fractional and oversized pixel dimensions are rejected', () => {
  for(const dimensions of [{outputWidth:640},{outputHeight:640},{outputWidth:641,outputHeight:480},{outputWidth:640.5,outputHeight:480},{outputWidth:0,outputHeight:480},{outputWidth:8194,outputHeight:480}]) {
    const base=defaults(10);
    assert.throws(()=>normalizeEdits({...base,canvas:{...base.canvas,...dimensions}},10));
  }
});
