// Explicit runtime-switch approval only. Never starts/stops a Cloudflare connector.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {createServer} from 'node:http';import {DatabaseSync} from 'node:sqlite';
import {createBookingTestApp} from '../backend/src/scheduling/booking-link-test.mjs';
import {loadSwitchConfiguration,prepareRuntimeFixture,localRequest,switchStateFile,switchResultFile,digest} from './smtp-reliability-switch-config.mjs';
let runtime,server,heartbeat,current,switched=false,stage='arguments';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const result={success:false,tunnelRestarted:false,emailsSent:0,otpSent:0,calendarWrites:0};
const state=running=>fs.writeFileSync(switchStateFile,JSON.stringify({...current.state,running,connected:current.state.connected,controllerPid:process.pid,connectorPid:current.state.connectorPid,database:path.relative(process.cwd(),current.fixture.databasePath),bookingId:current.fixture.bookingId,scheduledPublicUrl:current.config.origin,updatedAt:new Date().toISOString(),runtimeType:'smtp-reliability-test'},null,2),{mode:0o600});
async function close(){clearInterval(heartbeat);server?.closeAllConnections();if(server?.listening)await new Promise(resolve=>server.close(resolve));await runtime?.close();if(switched)state(false);}
async function health(origin){const r=await fetch(origin+'/healthz',{redirect:'error',signal:AbortSignal.timeout(12000)});assert.equal(r.status,200);const h=await r.json();assert.equal(h.ready,true);for(const k of ['email','guestOtpDelivery','ai','recording','sms'])assert.equal(h[k],false);}
try{
 assert.deepEqual(process.argv.slice(2),['--approved-runtime-switch']);stage='fixture preflight';current=loadSwitchConfiguration();const {state:previous,fixture,config,b,credential}=current;
 process.env.SCHEDULING_PUBLIC_URL=config.origin;process.env.SCHEDULING_EMAIL_ENABLED='false';
 assert.ok(Number.isInteger(previous.controllerPid)&&Number.isInteger(previous.connectorPid)&&previous.controllerPid!==process.pid&&previous.controllerPid!==previous.connectorPid);
 assert.equal(path.resolve(previous.database),path.resolve('data/booking-link-test/confirmation-flow-vBfobG/talk.sqlite'));
 const preserved=['.env.local','.env.tunnel-test.local','data/booking-link-test/confirmation-flow-vBfobG/confirmation-send-guard.sqlite','artifacts/qa/confirmation-approved-send-result.json'];const before=Object.fromEntries(preserved.map(f=>[f,digest(f)]));
 stage='idle previous fixture';const old=new DatabaseSync(path.resolve(previous.database),{readOnly:true});try{
  // Scheduled bookings create an active meeting row before anybody joins. This
  // fixture must have never issued a host/guest media ticket, not merely have a
  // particular meeting-row flag. No LiveKit room is created by booking alone.
  for(const table of ['talk_meeting_connections','scheduling_guest_connections'])assert.equal(old.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0);
 }finally{old.close();}
 await health(config.origin);assert.equal((await localRequest(3003,config.origin,'/healthz')).status,200);assert.equal((await fetch('http://127.0.0.1:3001/',{signal:AbortSignal.timeout(5000)})).status,200);
 stage='synthetic host and marker';prepareRuntimeFixture(fixture);
 stage='local route preflight';runtime=createBookingTestApp(config,fixture);server=createServer(runtime.app);runtime.attach(server);await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const port=server.address().port,base='/api/auth/scheduling/booking/'+b.id;
 const cfg=await localRequest(port,config.origin,'/api/auth/config');assert.equal(cfg.status,200);assert.ok(cfg.headers['set-cookie'].every(c=>c.startsWith('bookingtest_')&&/; Secure/i.test(c)&&/; HttpOnly/i.test(c)&&/; SameSite=Lax/i.test(c)));
 const form=await localRequest(port,config.origin,'/api/auth/scheduling/form'),headers={'X-Scheduling-Token':form.data.formToken};
 assert.equal((await localRequest(port,config.origin,base+'/detail',{credential},headers)).data.booking.id,b.id);assert.equal((await localRequest(port,config.origin,base+'/calendar',{credential},headers)).status,200);
 assert.equal((await localRequest(port,config.origin,base+'/detail',{credential:'x'.repeat(43)},headers)).status,404);assert.equal((await localRequest(port,config.origin,base+'/detail',{credential}, {...headers,Origin:'https://untrusted.example'})).status,403);
 assert.equal((await localRequest(port,config.origin,'/api/auth/scheduling/booking/'+previous.bookingId+'/detail',{credential},headers)).status,404);assert.equal((await localRequest(port,config.origin,'/api/auth/scheduling/dashboard')).status,404);assert.equal((await localRequest(port,config.origin,base+'/code',{credential},headers)).status,503);assert.equal((await runtime.auth.locals.schedulingJobs.tick()).enabled,false);
 const test=fs.readFileSync('artifacts/qa/smtp-reliability-switch-security.tap');const tap=test.toString(test[0]===255&&test[1]===254?'utf16le':'utf8');assert.match(tap,/# fail 0\b/);assert.match(tap,/# pass [1-9]\d*/);
 await close();runtime=null;server=null;
 stage='verify exact isolated listener owner';
 const script=`$ErrorActionPreference='Stop'; $p=Get-CimInstance Win32_Process -Filter 'ProcessId=${previous.controllerPid}'; $c=Get-CimInstance Win32_Process -Filter 'ProcessId=${previous.connectorPid}'; $l=Get-NetTCPConnection -LocalPort 3003 -State Listen; if($p.Name -ne 'node.exe' -or $p.CommandLine -notlike '*start-confirmation-test-tunnel.mjs*' -or $c.Name -ne 'cloudflared.exe' -or $l.LocalAddress -ne '127.0.0.1' -or $l.OwningProcess -ne ${previous.controllerPid}){exit 42}; if($c.ParentProcessId -eq $p.ProcessId){exit 43}; Write-Output 'VERIFIED'`;
 assert.equal(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',windowsHide:true,timeout:15000}).trim(),'VERIFIED');
 stage='restart isolated listener only';process.kill(previous.controllerPid); // Refuse a connector parent dependency before reaching this step.
 for(let i=0;i<40;i++){try{process.kill(previous.controllerPid,0);await delay(100);}catch{break;}}
 process.kill(previous.connectorPid,0);assert.ok(Date.now()<b.starts_at);
 runtime=createBookingTestApp(config,fixture);server=createServer(runtime.app);runtime.attach(server);await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(3003,'127.0.0.1',resolve);});assert.equal(server.address().address,'127.0.0.1');switched=true;
 stage='preserved tunnel health';await health(config.origin);process.kill(previous.connectorPid,0);assert.equal((await localRequest(3003,config.origin,base+'/detail',{credential},headers)).status,200);for(const [file,hash] of Object.entries(before))assert.equal(digest(file),hash);
 state(true);heartbeat=setInterval(()=>state(true),15000);heartbeat.unref();
 Object.assign(result,{success:true,origin:config.origin,listener:'127.0.0.1:3003',runtimePid:process.pid,connectorPid:previous.connectorPid,previousRuntimePid:previous.controllerPid,database:path.relative(process.cwd(),fixture.databasePath),bookingId:fixture.bookingId,localRoutePreflight:'PASS',disabledServices:'PASS',preservedFiles:'PASS',startedAt:new Date().toISOString()});fs.writeFileSync(switchResultFile,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 process.once('SIGINT',()=>void close());process.once('SIGTERM',()=>void close());
}catch{await close().catch(()=>{});Object.assign(result,{failedStage:stage,stoppedAt:new Date().toISOString()});fs.writeFileSync(switchResultFile,JSON.stringify(result,null,2));console.error('Isolated runtime switch stopped at '+stage+'. Tunnel was not restarted; no email or OTP sent.');process.exitCode=1;}
