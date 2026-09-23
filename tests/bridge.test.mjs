import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { WebSocket } from 'ws';
import { parsePublicOrigin, acceptsRequest } from '../scripts/bridge-origin.mjs';

const local = 'http://127.0.0.1:5188', shared = 'https://snip-test.example';
test('shared origins must be explicit, secure, and origin-only', () => {
  assert.equal(parsePublicOrigin(undefined), null);
  assert.equal(parsePublicOrigin(shared + '/'), shared);
  assert.equal(parsePublicOrigin(local), local);
  for (const invalid of ['http://example.com', shared+'/path', shared+'?token=x', shared+'#agent=x', 'https://user:pass@example.com', 'file:///tmp/snip', 'not a url'])
    assert.throws(() => parsePublicOrigin(invalid));
});
test('proxy policy keeps exact Origin and Host checks', () => {
  for (const host of ['127.0.0.1:5188', 'snip-test.example'])
    assert.equal(acceptsRequest({host, origin:shared},local,shared,true), true);
  for (const origin of [undefined, 'null', local, 'https://evil.example', shared+'.evil.example'])
    assert.equal(acceptsRequest({host:'snip-test.example', origin},local,shared,true), false);
  assert.equal(acceptsRequest({host:'evil.example', origin:shared},local,shared,true), false);
  assert.equal(acceptsRequest({host:'127.0.0.1:5188', origin:local},local,null,true), true);
  assert.equal(acceptsRequest({host:'127.0.0.1:5188', origin:local},local,shared,true), true);
  assert.equal(acceptsRequest({host:'127.0.0.1:5188', origin:'https://evil.example'},local,shared,true), false);
  assert.equal(acceptsRequest({host:'127.0.0.1:5188'},local,shared), true);
});
test('headless MCP serves a shared pairing URL and routes edits through the authorized proxy origin', async () => {
  const portReservation=createServer();
  await new Promise(resolve=>portReservation.listen(0,'127.0.0.1',resolve));
  const port=portReservation.address().port;
  await new Promise(resolve=>portReservation.close(resolve));
  const client=new Client({name:'bridge-test',version:'1.0.0'});
  const transport=new StdioClientTransport({command:process.execPath,args:['scripts/mcp-server.mjs'],env:{...process.env,SNIP_PORT:String(port),SNIP_PUBLIC_URL:shared},stderr:'pipe'});
  let browser;
  try {
    await client.connect(transport);
    const call=async(name,args={})=>{const result=await client.callTool({name,arguments:args});if(result.isError)throw new Error(result.content[0].text);return JSON.parse(result.content[0].text);};
    const pairing=await call('get_connection');
    assert.equal(pairing.mode,'shared');assert.equal(pairing.browserRequiredOnAgentHost,false);
    assert(pairing.url.startsWith(shared+'/#agent='));
    const token=new URL(pairing.url).hash.slice(7),upstream=`http://127.0.0.1:${port}`;
    assert.equal((await fetch(upstream,{headers:{Origin:shared}})).status,200);
    assert.equal((await fetch(upstream,{headers:{Origin:'https://evil.example'}})).status,403);
    const rejected=async(origin,t=token)=>new Promise((resolve,reject)=>{
      const socket=new WebSocket(`${upstream.replace('http:','ws:')}/agent?token=${t}`,{origin});
      socket.on('open',()=>{socket.close();reject(new Error('Unauthorized connection accepted'));});
      socket.on('error',()=>resolve());
    });
    await rejected('https://evil.example');await rejected(shared,'0'.repeat(64));
    browser=new WebSocket(`${upstream.replace('http:','ws:')}/agent?token=${token}`,{origin:shared});
    await new Promise((resolve,reject)=>{browser.once('open',resolve);browser.once('error',reject);});
    browser.on('message',bytes=>{const request=JSON.parse(bytes);if(request.type)return;browser.send(JSON.stringify({id:request.id,result:{method:request.method,params:request.params}}));});
    assert.equal((await call('get_connection')).connected,true);
    assert.equal(typeof pairing.bridgeId,'string');
    const batch={sessionId:'s',revision:0,requestId:'r',commands:[{action:'setSpeed',clipId:'c',speed:2}]};
    assert.deepEqual(await call('apply_edits',batch),{method:'apply_edits',params:batch});
    await rejected(shared); // a second paired browser is not allowed
    const other=new Client({name:'other-agent',version:'1.0.0'});
    try {
      await other.connect(new StdioClientTransport({command:process.execPath,args:['scripts/mcp-server.mjs'],env:{...process.env,SNIP_PORT:'0',SNIP_PUBLIC_URL:''},stderr:'pipe'}));
      const connection=JSON.parse((await other.callTool({name:'get_connection',arguments:{}})).content[0].text);
      assert.notEqual(connection.bridgeId,pairing.bridgeId);assert.equal(connection.connected,false);
      const error=await other.callTool({name:'get_project',arguments:{}});
      assert(error.isError);assert(error.content[0].text.includes(connection.bridgeId));
      assert.equal((await call('get_connection')).connected,true);
    } finally {await other.close();}
  } finally {browser?.terminate();await client.close();}
});
