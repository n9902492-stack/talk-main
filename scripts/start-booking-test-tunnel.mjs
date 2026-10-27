// Explicitly approved isolated Quick Tunnel only. Raw cloudflared output is
// consumed in memory; no request URLs, credentials or provider env are logged.
import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {checkCloudflaredClient} from './cloudflared-client.mjs';
import {bookingTestConfiguration} from '../backend/src/scheduling/booking-link-test.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const stateFile=path.join(root,'data/booking-link-test/public-tunnel.json');
let child,origin=null,connected=false,deadline,heartbeat,stopping=false;
const state=running=>writeFileSync(stateFile,JSON.stringify({origin,connected,running,controllerPid:process.pid,connectorPid:child?.pid||null,updatedAt:new Date().toISOString()}),{mode:0o600});
const stop=()=>{stopping=true;clearTimeout(deadline);clearInterval(heartbeat);child?.kill();};
const probe=headers=>new Promise((resolve,reject)=>{const req=http.get({hostname:'127.0.0.1',port:3003,path:'/healthz',headers,timeout:5000},res=>{let body='';res.on('data',b=>body+=b);res.on('end',()=>resolve({status:res.statusCode,body}));});req.on('error',reject);req.on('timeout',()=>req.destroy(new Error('timeout')));});
try{
 if(process.argv.length!==3||process.argv[2]!=='--approved')throw 0;
 const config=bookingTestConfiguration(root);if(config.emails.length!==5)throw 0;
 const directory=path.join(root,'data/booking-link-test/run-k4g1R9');
 if(readFileSync(path.join(directory,'.synthetic-booking-test'),'utf8')!=='Talk isolated synthetic booking test v1\n')throw 0;
 const db=new DatabaseSync(path.join(directory,'talk.sqlite'),{readOnly:true});
 try{
  if(db.prepare('SELECT COUNT(*) n FROM accounts').get().n!==1||db.prepare('SELECT COUNT(*) n FROM scheduling_bookings').get().n!==1)throw 0;
  for(const table of ['talk_meeting_connections','scheduling_guest_connections'])if(db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE revoked=0 AND expires_at>?`).get(Date.now()).n)throw 0;
  if(db.prepare("SELECT COUNT(*) n FROM scheduling_jobs WHERE status!='cancelled'").get().n)throw 0;
 }finally{db.close();}
 const health=await probe({});const h=JSON.parse(health.body);
 if(health.status!==200||!h.isolatedBookingTest||h.email!==false||h.ai!==false||h.recording!==false||h.sms!==false)throw 0;
 if((await probe({Host:'unapproved.trycloudflare.com','X-Forwarded-Proto':'https','CF-Connecting-IP':'192.0.2.1'})).status!==403)throw 0;
 if(existsSync(stateFile)){const previous=JSON.parse(readFileSync(stateFile));if(previous.running){try{process.kill(previous.connectorPid,0);throw new Error('existing_connector');}catch(e){if(e.message==='existing_connector')throw e;}}}
 for(const f of ['config.yml','config.yaml'])if(existsSync(path.join(process.env.USERPROFILE||root,'.cloudflared',f)))throw 0;
 const client=checkCloudflaredClient();if(client.status!=='VERIFIED')throw 0;
 const allowed=new Set(['systemroot','windir','path','pathext','userprofile','appdata','localappdata','programfiles','programfiles(x86)','programdata','homedrive','homepath','temp','tmp','comspec']);
 const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>allowed.has(k.toLowerCase())));
 child=spawn(client.executable,['tunnel','--no-autoupdate','--metrics','127.0.0.1:20243','--url','http://127.0.0.1:3003'],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 state(true);heartbeat=setInterval(()=>state(!stopping),15000);heartbeat.unref();let buffer='';
 const consume=b=>{buffer=(buffer+b.toString()).slice(-32768);if(!origin){const match=/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/i.exec(buffer);if(match){origin=new URL(match[0]).origin;state(true);console.log(JSON.stringify({status:'ORIGIN_ASSIGNED',origin}));}}
  if(!connected&&/Registered tunnel connection/.test(buffer)){connected=true;clearTimeout(deadline);state(true);console.log('ISOLATED_CONNECTOR_CONNECTED');}};
 child.stdout.on('data',consume);child.stderr.on('data',consume);
 child.once('error',()=>{stop();connected=false;state(false);console.error('Isolated connector failed. Private details withheld.');process.exitCode=1;});
 child.once('exit',()=>{clearTimeout(deadline);clearInterval(heartbeat);connected=false;state(false);console.log('ISOLATED_CONNECTOR_STOPPED');});
 deadline=setTimeout(()=>{console.error('Isolated connector timed out; ingress stopped.');stop();},120000);
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
}catch{stop();console.error('Isolated tunnel preflight failed; no booking routes exposed. Private details withheld.');process.exitCode=1;}
