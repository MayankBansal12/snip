import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
export default defineConfig({
  plugins: [react(), {
    name: 'offline-editor',
    closeBundle() {
      const files = readdirSync('dist', { recursive: true }).filter((p) => /\.(js|css|html|svg|wasm|woff2|txt)$/.test(String(p)) && p !== 'sw.js').map(String);
      const version = createHash('sha256');
      files.forEach(p => version.update(readFileSync(`dist/${p}`)));
      const cache = `snip-${version.digest('hex').slice(0, 12)}`;
      writeFileSync('dist/sw.js', `const CACHE=${JSON.stringify(cache)};const FILES=${JSON.stringify(files.map(p => '/' + p))};
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('snip-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',event=>{if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;event.respondWith(caches.open(CACHE).then(async cache=>{const response=await cache.match(event.request.mode==='navigate'?'/index.html':event.request,{ignoreSearch:true,ignoreVary:true});return response||fetch(event.request)}))});`);
    }
  }],
  server: { host: '0.0.0.0', port: 5173, allowedHosts: true },
  preview: { host: '0.0.0.0', port: 5173, allowedHosts: true }
});
