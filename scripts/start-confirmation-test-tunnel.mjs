// One approved isolated fixture only. No SMTP, OTP or Calendar adapters are loaded.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';
import {randomBytes,scryptSync} from 'node:crypto';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {parse} from 'dotenv';
import {bookingTestConfiguration,createBookingTestApp} from '../backend/src/scheduling/booking-link-test.mjs';
import {emailBookingSql} from '../backend/src/scheduling/email-outbox.mjs';
import {checkCloudflaredClient} from './cloudflared-client.mjs';

const root=process.cwd(),stateFile=path.resolve('data/booking-link-test/confirmation-public-tunnel.json'),recipient='niknikhil.sharma22@gmail.com';
let runtime,server,connector,origin=null,connected=false,stopped=false,timer,heartbeat,connectorDiagnostic='unavailable';
let dispatch=(_req,res)=>res.writeHead(503,{'Cache-Control':'no-store'}).end();
const state=running=>fs.writeFileSync(stateFile,JSON.stringify({origin,connected,running,controllerPid:process.pid,connectorPid:connector?.pid||null,listener:'127.0.0.1:3003',database:fixture?.databasePath?path.relative(root,fixture.databasePath):null,bookingId:fixture?.bookingId,scheduledPublicUrl:origin,smtp:false,otp:false,sms:false,recording:false,transcription:false,gemini:false,calendar:false,updatedAt:new Date().toISOString()},null,2),{mode:0o600});
let fixture,stage='fixture_configuration';
async function stop(){if(stopped)return;stopped=true;connected=false;clearTimeout(timer);clearInterval(heartbeat);dispatch=(_req,res)=>res.writeHead(503).end();connector?.kill();server?.closeAllConnections();server?.close();await runtime?.close().catch(()=>{});if(fixture)state(false);}
const localRequest=(p,body,headers={})=>new Promise((resolve,reject)=>{const r=request({hostname:'127.0.0.1',port:3003,path:p,method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},timeout:7000},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>{let data;try{data=JSON.parse(text);}catch{}resolve({status:res.statusCode,data,headers:res.headers});});});r.once('error',reject);r.on('timeout',()=>r.destroy(new Error('timeout')));r.end(body===undefined?undefined:JSON.stringify(body));});
const privateSave=(name,value)=>fs.writeFileSync(path.join(fixture.directory,name),value,{mode:0o600});
try{
 assert.deepEqual(process.argv.slice(2),['--approved']);
 const summary=JSON.parse(fs.readFileSync('artifacts/qa/booking-confirmation-flow-results.json','utf8'));
 assert.equal(summary.passed,true);assert.equal(summary.booking.title,'Talk Booking Confirmation Test');
 const directory=path.resolve(summary.directory);assert.ok(directory.startsWith(path.resolve('data/booking-link-test')+path.sep));
 assert.equal(fs.lstatSync(directory).isSymbolicLink(),false);assert.equal(fs.readFileSync(path.join(directory,'.synthetic-confirmation-flow'),'utf8'),'Talk isolated confirmation preparation v1\n');
 const config=bookingTestConfiguration(root);
 assert.ok(config.emails.includes(recipient));assert.equal(config.emails.length,5);
 const env=parse(fs.readFileSync('.env.local'));for(const flag of ['SCHEDULING_EMAIL_ENABLED','WHITEBOARD_CLOUD_AI_ENABLED','WHITEBOARD_CLOUD_AI_OPERATOR_APPROVED'])assert.notEqual(env[flag],'true');
 const testBytes=fs.readFileSync('artifacts/qa/confirmation-https-security.tap');
 const checks=testBytes.toString(testBytes[0]===255&&testBytes[1]===254?'utf16le':'utf8');assert.match(checks,/# fail 0\b/);assert.match(checks,/# pass [1-9]\d*/);
 stage='tunnel_client_preflight';
 const client=checkCloudflaredClient();assert.equal(client.status,'VERIFIED');
 for(const file of ['config.yml','config.yaml'])assert.equal(fs.existsSync(path.join(process.env.USERPROFILE||root,'.cloudflared',file)),false);
 // Refuse to claim or replace an active isolated listener.
 try{await localRequest('/healthz');throw new Error('occupied');}catch(e){assert.notEqual(e.message,'occupied');assert.equal(e.code,'ECONNREFUSED');}
 stage='synthetic_database_preflight';const raw=new DatabaseSync(path.join(directory,'talk.sqlite'));let b;
 try{
  assert.equal(raw.prepare('SELECT COUNT(*) n FROM accounts').get().n,1);assert.equal(raw.prepare('SELECT COUNT(*) n FROM scheduling_bookings').get().n,1);
  b=raw.prepare(emailBookingSql).get(summary.booking.id);assert.equal(b.title,'Talk Booking Confirmation Test');assert.equal(b.name,'Synthetic Test Invitee');assert.equal(b.host_name,'Synthetic Talk Host');assert.equal(b.email,recipient);assert.equal(b.status,'confirmed');
  assert.equal(b.starts_at,Date.parse('2026-10-24T14:15:00+05:30'));assert.equal(b.ends_at,Date.parse('2026-10-24T14:45:00+05:30'));assert.ok(b.starts_at>Date.now());
  assert.ok(raw.prepare('SELECT 1 ok FROM scheduling_invitations WHERE booking_id=? AND revoked=0 AND expires_at>?').get(b.id,Date.now()));
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM scheduling_jobs WHERE status!='cancelled' AND NOT (booking_id=? AND kind='confirmation:invitee' AND status='queued' AND attempts=0)").get(b.id).n,0);
  for(const table of ['talk_meeting_connections','scheduling_guest_connections'])assert.equal(raw.prepare(`SELECT COUNT(*) n FROM ${table} WHERE revoked=0 AND expires_at>?`).get(Date.now()).n,0);
  // A synthetic host password is local to this fixture, never a real account.
  const accessFile=path.join(directory,'host-access.private.json');
  if(!fs.existsSync(accessFile)){
   const password=randomBytes(32).toString('base64url'),salt=randomBytes(16).toString('hex');
   const hash=`scrypt$32768$8$1$${salt}$${scryptSync(password,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024}).toString('hex')}`;
   raw.exec('BEGIN IMMEDIATE');try{raw.prepare('UPDATE accounts SET email=? WHERE id=?').run(recipient,b.host_id);raw.prepare("INSERT INTO identities(provider,provider_id,account_id,password_hash,verified_at) VALUES ('password',?,?,?,?)").run(recipient,b.host_id,hash,Date.now());raw.exec('COMMIT');}catch(e){raw.exec('ROLLBACK');throw e;}
   fs.writeFileSync(accessFile,JSON.stringify({syntheticFixture:true,email:recipient,password}),{flag:'wx',mode:0o600});
  }
  fixture={directory,databasePath:path.join(directory,'talk.sqlite'),hostId:b.host_id,bookingId:b.id,meetingId:b.meeting_id};
 }finally{raw.close();}
 privateSave('fixture.json',JSON.stringify({hostId:fixture.hostId,bookingId:fixture.bookingId,meetingId:fixture.meetingId}));
 // Exact-origin matching rejects tunnel requests while the local config is active.
 stage='loopback_runtime_preflight';runtime=createBookingTestApp(config,fixture);dispatch=(req,res)=>runtime.app(req,res);
 server=createServer((req,res)=>dispatch(req,res));runtime.attach(server);
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(3003,'127.0.0.1',resolve);});
 assert.equal(server.address().address,'127.0.0.1');
 const health=await localRequest('/healthz');assert.equal(health.status,200);for(const flag of ['email','guestOtpDelivery','ai','recording','sms'])assert.equal(health.data[flag],false);
 assert.equal((await localRequest('/booking-confirmation',undefined,{Host:'unapproved.trycloudflare.com','X-Forwarded-Proto':'https','CF-Connecting-IP':'192.0.2.1'})).status,403);
 assert.equal((await runtime.auth.locals.schedulingJobs.tick()).enabled,false);
 state(true);console.log('LOCAL_SECURITY_PREFLIGHT_PASS');
 const allowed=new Set(['systemroot','windir','path','pathext','userprofile','appdata','localappdata','programfiles','programfiles(x86)','programdata','homedrive','homepath','temp','tmp','comspec']);
 const childEnv=Object.fromEntries(Object.entries(process.env).filter(([key])=>allowed.has(key.toLowerCase())));
 stage='connector_start';connector=spawn(client.executable,['tunnel','--no-autoupdate','--metrics','127.0.0.1:20244','--url','http://127.0.0.1:3003'],{env:childEnv,windowsHide:true,stdio:['ignore','pipe','pipe']});
 const assigned=new Promise((resolve,reject)=>{let buffer='';const consume=chunk=>{buffer=(buffer+chunk.toString()).slice(-32768);const match=/https:\/\/(?:[a-z0-9]+-){2,}[a-z0-9]+\.trycloudflare\.com\b/i.exec(buffer);if(match&&!origin){origin=new URL(match[0]).origin;state(true);}if(/no such host|lookup .*failed/i.test(buffer))connectorDiagnostic='dns_resolution_failed';else if(/Access is denied|permission denied|forbidden by its access permissions/i.test(buffer))connectorDiagnostic='network_permission_denied';else if(/timeout|timed out/i.test(buffer))connectorDiagnostic='connection_timeout';else if(/Failed to request quick Tunnel/i.test(buffer))connectorDiagnostic='quick_tunnel_request_failed';if(/Registered tunnel connection/.test(buffer)){connected=true;if(origin)resolve();}};connector.stdout.on('data',consume);connector.stderr.on('data',consume);connector.once('error',()=>reject(new Error('connector_error')));connector.once('exit',()=>reject(new Error('connector_exit')));timer=setTimeout(()=>reject(new Error('connector_timeout')),120000);});
 await assigned;clearTimeout(timer);
 // Switch only the isolated runtime. The tunnel never forwards accepted booking
 // requests to an unapproved Host; no main app or environment file is touched.
 dispatch=(_req,res)=>res.writeHead(503,{'Cache-Control':'no-store'}).end();
 await runtime.close();server.removeAllListeners('upgrade');
 stage='public_origin_binding';const publicConfig=bookingTestConfiguration(root,origin);process.env.SCHEDULING_PUBLIC_URL=origin;
 runtime=createBookingTestApp(publicConfig,fixture);runtime.attach(server);dispatch=(req,res)=>runtime.app(req,res);
 const credential=publicConfig.links.inviteeUrl(b);privateSave('invitation.private.txt',credential+'\n');
 privateSave('public-runtime.private.json',JSON.stringify({origin,fixture,scheduledPublicUrl:origin,smtp:false,otp:false}));
 const forwarded={Host:new URL(origin).host,'X-Forwarded-Proto':'https','CF-Connecting-IP':'192.0.2.7'};
 const finalHealth=await localRequest('/healthz',undefined,forwarded);assert.equal(finalHealth.status,200);
 const cookieCheck=await localRequest('/api/auth/config',undefined,forwarded);assert.ok(cookieCheck.headers['set-cookie']?.every(v=>v.startsWith('bookingtest_')&&/; Secure/i.test(v)&&/; HttpOnly/i.test(v)&&/; SameSite=Lax/i.test(v)));
 assert.equal((await localRequest('/api/auth/scheduling/dashboard',undefined,forwarded)).status,404);
 assert.equal((await localRequest('/healthz')).status,403);
 state(true);heartbeat=setInterval(()=>state(true),15000);heartbeat.unref();
 connector.once('exit',()=>{void stop();console.log('ISOLATED_TUNNEL_STOPPED');});
 process.once('SIGINT',()=>void stop());process.once('SIGTERM',()=>void stop());
 console.log(JSON.stringify({ready:true,origin,listener:'127.0.0.1:3003',bookingCount:1,smtp:false,otp:false}));
}catch{await stop();console.error('Isolated HTTPS startup stopped safely at '+stage+'; connector diagnostic: '+connectorDiagnostic+'; booking ingress is closed. Private details withheld.');process.exitCode=1;}
