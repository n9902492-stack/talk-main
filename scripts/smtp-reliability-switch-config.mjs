import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {createHash,randomBytes,scryptSync} from 'node:crypto';import {request} from 'node:http';
import {bookingTestConfiguration} from '../backend/src/scheduling/booking-link-test.mjs';import {emailBookingSql} from '../backend/src/scheduling/email-outbox.mjs';
export const switchStateFile='data/booking-link-test/confirmation-public-tunnel.json';
export const switchResultFile='artifacts/qa/smtp-reliability-switch-runtime.json';
export const recipient='niknikhil.sharma22@gmail.com';
export const digest=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export function loadSwitchConfiguration({preparedOrigin}={}){
 const root=process.cwd(),state=JSON.parse(fs.readFileSync(switchStateFile,'utf8')),fixture=JSON.parse(fs.readFileSync('artifacts/qa/smtp-reliability-fixture.private.json','utf8'));
 const origin=new URL(preparedOrigin||state.origin).origin;if(!preparedOrigin){assert.equal(state.scheduledPublicUrl,origin);assert.ok(state.running&&state.connected);}assert.equal(state.listener,'127.0.0.1:3003');
 for(const flag of ['smtp','otp','sms','recording','transcription','gemini','calendar'])assert.equal(state[flag],false);
 const config=bookingTestConfiguration(root,origin);assert.equal(config.publicMode,true);assert.equal(config.emails.length,5);assert.ok(config.emails.includes(recipient));
 const parent=path.resolve('data/smtp-reliability-test'),directory=path.resolve(fixture.directory);assert.ok(directory.startsWith(parent+path.sep));assert.equal(fs.realpathSync(directory),directory);assert.equal(path.resolve(fixture.databasePath),path.join(directory,'talk.sqlite'));assert.equal(fixture.syntheticFixture,true);
 const raw=new DatabaseSync(fixture.databasePath,{readOnly:true});let b;
 try{
  for(const table of ['accounts','scheduling_bookings','scheduling_events','talk_meetings'])assert.equal(raw.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,1);
  b=raw.prepare(emailBookingSql).get(fixture.bookingId);assert.equal(b.host_id,fixture.hostId);assert.equal(b.meeting_id,fixture.meetingId);assert.equal(b.title,'SMTP Reliability Test');assert.equal(b.host_name,'Talk Synthetic Reliability Host');assert.equal(b.name,'Synthetic Reliability Guest');assert.equal(b.host_email,recipient);assert.equal(b.email,recipient);assert.equal(b.host_verified,1);assert.equal(b.timezone,'Asia/Kolkata');assert.equal(b.status,'confirmed');assert.equal(b.starts_at,Date.parse('2026-10-24T15:45:00+05:30'));assert.equal(b.ends_at,Date.parse('2026-10-24T16:15:00+05:30'));assert.ok(Date.now()<b.starts_at);
  assert.ok(raw.prepare('SELECT 1 ok FROM scheduling_invitations WHERE booking_id=? AND revoked=0 AND redeemed_at IS NULL AND expires_at>=?').get(b.id,b.ends_at+3600000));
  for(const table of ['talk_meeting_connections','scheduling_guest_connections'])assert.equal(raw.prepare(`SELECT COUNT(*) n FROM ${table} WHERE revoked=0 AND expires_at>?`).get(Date.now()).n,0);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM scheduling_jobs WHERE status!='cancelled' AND NOT (id=? AND kind='confirmation:invitee' AND status='queued' AND attempts=0)").get(fixture.jobId).n,0);assert.equal(raw.prepare('SELECT COUNT(*) n FROM scheduling_email_attempts').get().n,0);
 }finally{raw.close();}
 const guard=new DatabaseSync(fixture.guardPath,{readOnly:true});try{const g=guard.prepare('SELECT * FROM confirmation_attempt WHERE scope=?').get(fixture.scope);assert.equal(g.consumed,0);assert.ok(['awaiting_public_verification','awaiting_approval'].includes(g.status));assert.equal(g.fingerprint,fixture.fingerprint);}finally{guard.close();}
 const privateInvitation=JSON.parse(fs.readFileSync(path.join(directory,'invitation.private.json'),'utf8'));const link=config.links.inviteeUrl(b),credential=new URL(link).hash.slice(1);assert.equal(privateInvitation.credential,credential);assert.equal(privateInvitation.bookingId,b.id);assert.equal(config.links.verify(b,credential,Date.now()),true);assert.equal(config.links.verify(b,credential,b.ends_at+3600000),true);assert.equal(config.links.verify(b,credential,b.ends_at+3600001),false);
 return {root,state,fixture,config,b,link,credential};
}
export function prepareRuntimeFixture(fixture){
 const marker=path.join(fixture.directory,'.synthetic-smtp-reliability'),value='Talk isolated SMTP reliability fixture v1\n';
 if(fs.existsSync(marker))assert.equal(fs.readFileSync(marker,'utf8'),value);else fs.writeFileSync(marker,value,{flag:'wx',mode:0o600});
 // A password belongs only to this synthetic account, never the real Gmail account.
 const accessFile=path.join(fixture.directory,'host-access.private.json'),raw=new DatabaseSync(fixture.databasePath);
 try{
  if(fs.existsSync(accessFile)){assert.equal(raw.prepare("SELECT COUNT(*) n FROM identities WHERE account_id=? AND provider='password'").get(fixture.hostId).n,1);return;}
  assert.equal(raw.prepare('SELECT COUNT(*) n FROM identities').get().n,0);const password=randomBytes(32).toString('base64url'),salt=randomBytes(16).toString('hex'),hash=`scrypt$32768$8$1$${salt}$${scryptSync(password,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024}).toString('hex')}`;
  fs.writeFileSync(accessFile,JSON.stringify({syntheticFixture:true,email:recipient,password}),{flag:'wx',mode:0o600});raw.prepare("INSERT INTO identities(provider,provider_id,account_id,password_hash,verified_at) VALUES ('password',?,?,?,?)").run(recipient,fixture.hostId,hash,Date.now());
 }finally{raw.close();}
}
export const forwarded=origin=>({Host:new URL(origin).host,'X-Forwarded-Proto':'https','CF-Connecting-IP':'192.0.2.73'});
export function localRequest(port,origin,p,body,extra={}){return new Promise((resolve,reject)=>{
 const req=request({hostname:'127.0.0.1',port,path:p,method:body===undefined?'GET':'POST',headers:{...forwarded(origin),...(body===undefined?{}:{Origin:origin,'Content-Type':'application/json'}),...extra},timeout:8000},res=>{let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>{let data;try{data=JSON.parse(text);}catch{}resolve({status:res.statusCode,data,text,headers:res.headers});});});req.once('error',reject);req.once('timeout',()=>req.destroy(Error('timeout')));req.end(body===undefined?undefined:JSON.stringify(body));
 });}
