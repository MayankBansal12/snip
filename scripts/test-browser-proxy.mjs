// Test-only reverse proxy matching bb connect's Host/Origin normalization.
import { createServer, request } from 'node:http';
import { connect } from 'node:net';
export async function createBrowserProxy() {
  const reservation=createServer();
  await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
  const upstreamPort=reservation.address().port;
  await new Promise(resolve=>reservation.close(resolve));
  const upstream=`http://127.0.0.1:${upstreamPort}`;
  let origin;
  const headersFor=req=>({...req.headers,host:new URL(upstream).host,...(req.headers.origin===origin?{origin:upstream}:{})});
  const server=createServer((req,res)=>{
    const forwarded=request(upstream+req.url,{method:req.method,headers:headersFor(req)},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
    forwarded.on('error',()=>{res.writeHead(502).end();});req.pipe(forwarded);
  });
  const sockets=new Set();
  server.on('upgrade',(req,socket,head)=>{
    const target=connect(upstreamPort,'127.0.0.1',()=>{
      target.write(`GET ${req.url} HTTP/1.1\r\n${Object.entries(headersFor(req)).map(([key,value])=>`${key}: ${value}`).join('\r\n')}\r\n\r\n`);
      if(head.length)target.write(head);socket.pipe(target);target.pipe(socket);
    });
    sockets.add(socket);sockets.add(target);
    socket.on('error',()=>target.destroy());target.on('error',()=>socket.destroy());
    socket.on('close',()=>{sockets.delete(socket);target.destroy();});target.on('close',()=>{sockets.delete(target);socket.destroy();});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  origin=`http://localhost:${server.address().port}`;
  return {env:{SNIP_PORT:String(upstreamPort),SNIP_PUBLIC_URL:origin},close:async()=>{
    for(const socket of sockets)socket.destroy();
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  }};
}
