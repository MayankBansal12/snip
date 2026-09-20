import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {readFileSync} from 'node:fs';
const sample=process.env.VIDEO_SAMPLE;
if(!sample)throw new Error('Set VIDEO_SAMPLE to a small MP4 fixture');
const browser=await chromium.connectOverCDP(process.env.CDP_URL || 'http://127.0.0.1:9234');
const context=await browser.newContext({acceptDownloads:true});
try{
 if(process.env.EXPECT_NATIVE==='1')await context.addInitScript(()=>{window.__nativeEncodes=0;const encode=VideoEncoder.prototype.encode;VideoEncoder.prototype.encode=function(...args){window.__nativeEncodes++;return encode.apply(this,args);};});
 const page=await context.newPage();await page.goto(process.env.APP_URL || 'http://127.0.0.1:5207');
 await page.evaluate(()=>navigator.serviceWorker.ready);
 await page.locator('#video-file').setInputFiles({name:'fixture.mp4',mimeType:'video/mp4',buffer:readFileSync(sample)});
 await page.getByRole('button',{name:'export video',exact:true}).waitFor();
 await page.getByRole('status').filter({hasText:'saved on this device'}).waitFor();
 await page.reload();await page.waitForFunction(()=>navigator.serviceWorker.controller!==null);
 await context.setOffline(true);await page.reload();
 assert(await page.evaluate(()=>crossOriginIsolated),'Offline cached page must retain isolation headers');
 await page.getByRole('button',{name:'export video',exact:true}).click();
 await page.getByRole('combobox',{name:'export quality'}).click();await page.getByRole('option',{name:'smaller file'}).click();
 const ready=page.waitForEvent('download',{timeout:120000});await page.getByRole('button',{name:'export & download',exact:true}).click();await ready;
 const size=await page.evaluate(async()=>{const link=document.querySelector('a[download]');return(await(await fetch(link.href)).blob()).size;});
 assert(size>100);
 if(process.env.EXPECT_NATIVE==='1')assert(await page.evaluate(()=>window.__nativeEncodes>0),'Native encoder must run offline');
 console.log('PASS offline production export',{size,native:process.env.EXPECT_NATIVE==='1'});
}finally{await context.close();await browser.close();}
