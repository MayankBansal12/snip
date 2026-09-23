import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { applyCommands, normalizeEdits } from '../src/engine/index';
import { defaults, sequenceDuration } from '../src/types';
import { compileAnswer, createPlan, instructionsIn, numbersIn, readRequest } from '../server/planner';
import { compileChanges } from '../server/compiler';
import type { Change } from '../server/operations';
import { handleEdit } from '../server/edit';

function fixture(text='make it 2x faster'){
  const edits=defaults(12);edits.clips[0].id='a';
  return readRequest({text,requestId:'test',sessionId:'session',revision:3,project:{duration:12,edits,selectedClip:'a',time:3}});
}
function answers(request:ReturnType<typeof fixture>,rows:Record<string,unknown>[]){
  const plan=createPlan(request);
  const raw={answers:Object.fromEntries(Object.keys(plan.questions).map(k=>[k,{type:'choice',choice:'unsupported',confidence:1}]))};
  raw.answers.support={type:'choice',choice:'supported',confidence:1};
  for(const [i,row] of rows.entries())for(const [field,value] of Object.entries(row)){
    const key=`edit${i+1}_${field}`;
    const choice=Object.entries(plan.choices[key]).find(([,v])=>JSON.stringify(v.value)===JSON.stringify(value))?.[0];
    assert(choice,`Missing ${key} option ${JSON.stringify(value)}`);
    raw.answers[key]={type:'choice',choice,confidence:1};
  }
  return {plan,raw};
}
const split=(seconds:number,result='split1'):Change=>({action:'split',clip:'all',at:{from:'timeline',seconds},result});
const zoom=(clip:Extract<Change,{action:'zoom'}>['clip'],scale:number):Change=>({action:'zoom',clip,scale,focus:null});
const edited=(request:ReturnType<typeof fixture>,changes:Change[])=>applyCommands(request.project.edits,compileChanges(request,changes).batch.commands,request.project.duration);

test('one answer becomes an ordered array; irrelevant speculative fields cannot block it',()=>{
  const request=fixture('split at 4 seconds then make the second clip 2x faster then zoom the last part to 3x');
  const {plan,raw}=answers(request,[{action:'split',target:'all',split:[{from:'timeline',seconds:4}]},{action:'speed',target:{clip:2},speed:2},{action:'zoom',target:'last',zoom:3,focus:null}]);
  const result=compileAnswer(request,plan,raw);
  assert.deepEqual(result,compileAnswer(request,plan,raw));
  assert.deepEqual(result.changes?.map(c=>c.action),['split','speed','zoom']);
  assert.equal(result.batch.revision,3);assert.equal(result.batch.sessionId,'session');
  const value=applyCommands(request.project.edits,result.batch.commands,12);
  assert.equal(value.clips.length,2);assert.equal(sequenceDuration(value),8);
  assert.equal(value.clips[0].speed,1);assert.equal(value.clips[1].speed,2);assert.equal(value.clips[1].zoom?.scale,3);
});

test('repeated zooms stay attached to their own targets; later edits use newly created parts',()=>{
  const request=fixture();
  const value=edited(request,[split(4),zoom({clip:1},1.5),{action:'speed',clip:{clip:2},rate:2},split(6,'split4'),zoom({split:4,side:'right'},3)]);
  assert.deepEqual(value.clips.map(c=>[c.start,c.end,c.speed,c.zoom?.scale]),[[0,4,1,1.5],[4,8,2,1],[8,12,2,3]]);
});

test('execution preserves requested order rather than grouping edits by action',()=>{
  const request=fixture();
  const speed:Change={action:'speed',clip:'all',rate:2};
  assert.equal(edited(request,[speed,split(4)]).clips[0].end,8);
  assert.equal(edited(request,[split(4),speed]).clips[0].end,4);
});

test('multiple split positions expand into individual ordered changes',()=>{
  const request=fixture('split at 3 and 8 seconds');
  const {plan,raw}=answers(request,[{action:'split',target:'all',split:[{from:'timeline',seconds:3},{from:'timeline',seconds:8}]}]);
  const result=compileAnswer(request,plan,raw);
  assert.equal(result.changes?.length,2);
  assert.deepEqual(applyCommands(request.project.edits,result.batch.commands,12).clips.map(c=>[c.start,c.end]),[[0,3],[3,8],[8,12]]);
});

test('trim times convert through reordered clips and speed; each per-clip trim stays local',()=>{
  const request=fixture();
  request.project.edits=normalizeEdits({...request.project.edits,clips:[{id:'a',start:6,end:12,speed:2},{id:'b',start:0,end:6,speed:1}]},12);
  const value=edited(request,[{action:'trim',clip:'all',range:{mode:'keepRange',start:1,end:5}}]);
  assert.deepEqual(value.clips.map(c=>[c.start,c.end,c.speed]),[[8,12,2],[0,2,1]]);
  const local=edited(request,[{action:'trim',clip:{clip:2},range:{mode:'removeStart',seconds:2}}]);
  assert.deepEqual(local.clips.map(c=>[c.start,c.end]),[[6,12],[2,6]]);
});

test('middle removal retains both sides and a later instruction can target the final part',()=>{
  const request=fixture();
  const value=edited(request,[{action:'trim',clip:'all',range:{mode:'removeRange',start:2,end:4}},zoom('last',2)]);
  assert.deepEqual(value.clips.map(c=>[c.start,c.end,c.zoom?.scale]),[[0,2,1],[4,12,2]]);
});

test('a failing later instruction rolls back the entire array without mutating the input',()=>{
  const request=fixture(),before=structuredClone(request);
  assert.throws(()=>compileChanges(request,[zoom('all',2),{action:'delete',clip:'all'}]),/current timeline/);
  assert.deepEqual(request,before);
  assert.throws(()=>compileChanges(request,[split(4),{action:'trim',clip:'all',range:{mode:'keepRange',start:3,end:100}}]),/does not fit/);
  assert.deepEqual(request,before);
});

test('unknown, missing and low-confidence required answers reject the entire response',()=>{
  const request=fixture('zoom 2x then split at 4 seconds'),before=structuredClone(request);
  const {plan,raw}=answers(request,[{action:'zoom',target:'all',zoom:2,focus:null},{action:'split',target:'all',split:[{from:'timeline',seconds:4}]}]);
  raw.answers.edit2_split.choice='__proto__';assert.throws(()=>compileAnswer(request,plan,raw),/unreadable/);
  raw.answers.edit2_split.choice='at0';raw.answers.edit2_split.confidence=.1;assert.throws(()=>compileAnswer(request,plan,raw),/clear enough/);
  delete raw.answers.edit2_split;assert.throws(()=>compileAnswer(request,plan,raw),/incomplete/);
  raw.answers.support.choice='unsupported';assert.throws(()=>compileAnswer(request,plan,raw),/can’t inspect/);
  assert.deepEqual(request,before);
});

test('position-only zoom preserves scale, and relative speed/zoom preserve focus',()=>{
  const request=fixture();request.project.edits.clips[0].zoom={scale:2,x:.5,y:.5};request.project.edits.clips[0].speed=2;
  const changes:Change[]=[{action:'zoom',clip:'all',scale:'keep',focus:{x:0,y:0}},{action:'speed',clip:'all',rate:'faster'},{action:'zoom',clip:'all',scale:'in',focus:null}];
  const result=compileChanges(request,changes),value=applyCommands(request.project.edits,result.batch.commands,12);
  assert.equal(value.clips[0].speed,4);assert.deepEqual(value.clips[0].zoom,{scale:3,x:0,y:0});assert.match(result.summary,/top left/);
});

test('relative splits resolve from the submitted playhead across sped-up source ranges',()=>{
  const request=fixture();request.project.time=2;
  request.project.edits=normalizeEdits({...request.project.edits,clips:[{id:'a',start:6,end:12,speed:2},{id:'b',start:0,end:6,speed:1}]},12);
  const result=compileChanges(request,[{action:'split',clip:'all',at:{from:'playhead',seconds:3},result:'split1'}]);
  assert.deepEqual(applyCommands(request.project.edits,result.batch.commands,12).clips.map(c=>[c.start,c.end]),[[6,12],[0,2],[2,6]]);
  assert.match(result.summary,/split at 5s \(3s after the playhead\)/);
});

test('relative split boundaries cannot clamp or silently choose another timestamp',()=>{
  for(const [time,offset,position] of [[10,3,13],[9,3,12],[2,-3,-1],[3,-3,0]]){
    const request=fixture();request.project.time=time;
    assert.throws(()=>compileChanges(request,[{action:'split',clip:'all',at:{from:'playhead',seconds:offset},result:'split1'}]),new RegExp(`lands at ${position}s, outside`));
  }
  const request=fixture();assert.throws(()=>compileChanges(request,[split(4),split(4,'split2')]),/already a split/);
});

test('merge uses both neighbors and preserves engine compatibility constraints',()=>{
  const request=fixture();
  request.project.edits=edited(request,[split(4)]);
  const value=edited(request,[{action:'merge',clips:[{clip:1},{clip:2}]}]);
  assert.deepEqual(value.clips.map(c=>[c.start,c.end]),[[0,12]]);
  assert.throws(()=>compileChanges(request,[zoom({clip:2},2),{action:'merge',clips:[{clip:1},{clip:2}]}]),/matching speed and zoom/);
});

test('new-part references cannot point forward or resurrect a removed clip',()=>{
  const request=fixture();
  assert.throws(()=>compileChanges(request,[zoom({split:2,side:'right'},2),split(4,'split2')]),/has not happened/);
  assert.throws(()=>compileChanges(request,[split(4),{action:'delete',clip:{split:1,side:'right'}},zoom({split:1,side:'right'},2)]),/no longer/);
});

test('instruction boundaries preserve ranges, numeric lists and elliptical clip targets',()=>{
  assert.deepEqual(instructionsIn('trim 5 seconds and apply 2x zoom in middle'),['trim 5 seconds','apply 2x zoom in middle']);
  assert.deepEqual(instructionsIn('keep between 2 and 5 seconds then zoom 2x'),['keep between 2 and 5 seconds','zoom 2x']);
  assert.deepEqual(instructionsIn('split at 3 and 8 seconds, zoom clip 1 to 2x, clip 2 to 3x'),['split at 3 and 8 seconds','zoom clip 1 to 2x','clip 2 to 3x']);
  assert.deepEqual(numbersIn('from 1:02.5 to 2:03, two minutes, half speed'),[62.5,123,120,.5]);
});

test('number-led settings share a trailing clip without overriding explicit or sequential targets',()=>{
  assert.deepEqual(instructionsIn('1x zoom and 1x speed for clip 1'),['1x zoom for clip 1','1x speed for clip 1']);
  assert.deepEqual(instructionsIn('2x zoom, 0.5x speed on clip 2'),['2x zoom on clip 2','0.5x speed on clip 2']);
  assert.deepEqual(instructionsIn('normal speed and double zoom for the last clip'),['normal speed for the last clip','double zoom for the last clip']);
  assert.deepEqual(instructionsIn('zoom clip 1 to 2x and 1x speed for clip 2'),['zoom clip 1 to 2x','1x speed for clip 2']);
  assert.deepEqual(instructionsIn('zoom 2x then 1x speed for clip 2'),['zoom 2x','1x speed for clip 2']);
});

test('the reported reset prompt changes both controls on clip 1 and leaves clip 2 intact',()=>{
  const request=fixture('1x zoom and 1x speed for clip 1');
  request.project.edits=normalizeEdits({...request.project.edits,clips:[
    {id:'a',start:0,end:6,speed:2,zoom:{scale:2,x:.5,y:.5}},
    {id:'b',start:6,end:12,speed:.5,zoom:{scale:3,x:0,y:0}},
  ]},12);
  const {plan,raw}=answers(request,[{action:'zoom',target:{clip:1},zoom:1,focus:null},{action:'speed',target:{clip:1},speed:1}]);
  const result=compileAnswer(request,plan,raw);
  assert.deepEqual(result.changes?.map(c=>c.action),['zoom','speed']);
  const value=applyCommands(request.project.edits,result.batch.commands,12);
  assert.equal(value.clips[0].zoom?.scale,1);assert.equal(value.clips[0].speed,1);
  assert.deepEqual(value.clips[1],request.project.edits.clips[1]);
});

test('oversized requests and plans fail before making partial edits',()=>{
  assert.throws(()=>readRequest({...fixture(),text:'a'.repeat(1201)}),/incomplete/);
  assert.throws(()=>createPlan(fixture(Array(9).fill('zoom 2x').join(' then '))),/up to 8/);
  assert.throws(()=>compileChanges(fixture(),Array(9).fill(zoom('all',2))),/between 1 and 8/);
  for(const q of Object.values(createPlan(fixture('trim 0 1 2 3 4 5 6 7 8 9 10 11 seconds')).questions))assert(Object.keys(q.criteria).length<=255);
});

test('HTTP handler makes exactly one Jev call with scoped questions and returns the changes array',async()=>{
  const request=fixture();let calls=0;
  const server=createServer((req,res)=>void handleEdit(req,res,{apiKey:'server-only-test-key',fetch:(async(_url,init)=>{
    calls++;const body=JSON.parse(String(init?.body));
    assert.equal(body.state.user_request,request.text);assert.equal(body.state.playhead,3);
    assert('edit1_action' in body.questions);assert('edit1_speed' in body.questions);
    assert(!('file' in body.state));assert(!('name' in body.state));assert(!JSON.stringify(body).includes('server-only-test-key'));
    const {raw}=answers(request,[{action:'speed',target:'all',speed:2}]);return new Response(JSON.stringify(raw));
  }) as typeof fetch}));
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${(server.address() as {port:number}).port}/api/edit`;
  try{
    assert.equal((await fetch(url)).status,405);
    assert.equal((await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','Sec-Fetch-Site':'cross-site'},body:JSON.stringify(request)})).status,403);
    assert.equal((await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,400);assert.equal(calls,0);
    const result=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)});
    assert.equal(result.status,200);assert.equal(result.headers.get('cache-control'),'no-store');
    const body=await result.text();assert(!body.includes('server-only-test-key'));
    const json=JSON.parse(body);assert.deepEqual(json.changes,[{action:'speed',clip:'all',rate:2}]);assert.equal(json.batch.commands[0].speed,2);assert.equal(calls,1);
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});


test('multiple splits in one named clip retain that instruction’s local time origin',()=>{
  const request=fixture('split clip 2 at 2 and 4 seconds');
  request.project.edits=normalizeEdits({...request.project.edits,clips:[{id:'a',start:0,end:4},{id:'b',start:6,end:12}]},12);
  const {plan,raw}=answers(request,[{action:'split',target:{clip:2},split:[{from:'timeline',seconds:2},{from:'timeline',seconds:4}]}]);
  const result=compileAnswer(request,plan,raw);
  assert.deepEqual(applyCommands(request.project.edits,result.batch.commands,12).clips.map(c=>[c.start,c.end]),[[0,4],[6,8],[8,10],[10,12]]);
});
