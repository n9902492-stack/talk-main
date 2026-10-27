import fs from 'node:fs/promises';import path from 'node:path';import net from 'node:net';import {once} from 'node:events';import {spawn} from 'node:child_process';import {randomBytes} from 'node:crypto';import {RoomServiceClient} from 'livekit-server-sdk';
export async function localSfu(){
  const freePort=async()=>{const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const port=s.address().port;await new Promise(r=>s.close(r));return port;};
  const [port,tcp,udp]=await Promise.all([freePort(),freePort(),freePort()]);
  const directory=await fs.mkdtemp(path.resolve('artifacts/qa/phase10i-private-sfu-'));
  const config={url:`ws://127.0.0.1:${port}`,apiKey:'fixture'+randomBytes(8).toString('hex'),apiSecret:randomBytes(32).toString('base64url')};
  const file=path.join(directory,'livekit.yaml');await fs.writeFile(file,`port: ${port}\nbind_addresses: ["127.0.0.1"]\nrtc:\n  tcp_port: ${tcp}\n  udp_port: ${udp}\n  use_external_ip: false\n  node_ip: 127.0.0.1\n  enable_loopback_candidate: true\nkeys:\n  ${config.apiKey}: ${config.apiSecret}\nlogging:\n  level: error\n`);
  const log=await fs.open(path.join(directory,'server.log'),'a'),child=spawn(path.resolve('artifacts/qa/livekit/livekit-server.exe'),['--config',file],{windowsHide:true,stdio:['ignore',log.fd,log.fd]});await log.close();
  const admin=new RoomServiceClient(config.url.replace('ws:','http:'),config.apiKey,config.apiSecret,{requestTimeout:1});
  const stop=async()=>{if(child.exitCode===null){child.kill();await once(child,'exit').catch(()=>{});}await fs.unlink(file).catch(()=>{});};
  try{for(let i=0;i<30;i++){try{await admin.listRooms();return {config,stop};}catch{if(child.exitCode!==null)break;await new Promise(r=>setTimeout(r,200));}}throw new Error('Isolated loopback test SFU did not start.');}catch(e){await stop();throw e;}
}
