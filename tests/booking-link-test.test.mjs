import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,mkdtempSync,writeFileSync,copyFileSync} from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {createServer,request as httpRequest} from 'node:http';
import {bookingTestConfiguration,prepareBookingTest,createBookingTestApp} from '../backend/src/scheduling/booking-link-test.mjs';
import {createEmailLinks} from '../backend/src/scheduling/email-links.mjs';
import {createMeetingService} from '../backend/src/meetings.mjs';


function fixtureFetch(url,options){return new Promise((resolve,reject)=>{const req=httpRequest(url,options,res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve({status:res.statusCode,headers:{get:k=>Array.isArray(res.headers[k])?res.headers[k].join(', '):res.headers[k]||null,getSetCookie:()=>res.headers['set-cookie']||[]},text:async()=>text}));});req.on('error',reject);if(options.body)req.write(options.body);req.end();});}
const emails=Array.from({length:5},(_,i)=>`tester${i}@example.test`);
async function setup(t,{publicMode=false,mock=true,confirmationFixture=false,reliabilityFixture=false}={}){
 const root=process.cwd(),nowState={value:Date.now()},origin=publicMode?'https://fixture.trycloudflare.com':'http://127.0.0.1:3003';
 const config={root,origin,publicMode,emails,links:createEmailLinks({baseUrl:origin,secret:randomBytes(32).toString('base64url')}),frontendPath:path.join(root,'artifacts/qa/booking-link-frontend')};
 let fixture=await prepareBookingTest(config,{now:nowState.value});
 if(reliabilityFixture){
  mkdirSync(path.join(root,'data/smtp-reliability-test'),{recursive:true});const directory=mkdtempSync(path.join(root,'data/smtp-reliability-test/run-test-'));const databasePath=path.join(directory,'talk.sqlite');copyFileSync(fixture.databasePath,databasePath);copyFileSync(path.join(fixture.directory,'host-access.private.json'),path.join(directory,'host-access.private.json'));fixture={...fixture,directory,databasePath};
  const {DatabaseSync}=await import('node:sqlite'),db=new DatabaseSync(databasePath);try{db.prepare('UPDATE accounts SET name=?').run('Talk Synthetic Reliability Host');db.prepare('UPDATE scheduling_bookings SET name=?').run('Synthetic Reliability Guest');db.prepare('UPDATE scheduling_events SET title=?').run('SMTP Reliability Test');db.prepare("UPDATE scheduling_jobs SET status='queued' WHERE kind='confirmation:invitee'").run();}finally{db.close();}
  writeFileSync(path.join(directory,'.synthetic-smtp-reliability'),'Talk isolated SMTP reliability fixture v1\n');
 }
 if(confirmationFixture){
  const {DatabaseSync}=await import('node:sqlite'),db=new DatabaseSync(fixture.databasePath);
  try{db.prepare('UPDATE accounts SET name=? WHERE id=?').run('Synthetic Talk Host',fixture.hostId);db.prepare('UPDATE scheduling_events SET title=?').run('Talk Booking Confirmation Test');db.prepare("UPDATE scheduling_jobs SET status='queued' WHERE kind='confirmation:invitee'").run();}
  finally{db.close();}
  writeFileSync(path.join(fixture.directory,'.synthetic-confirmation-flow'),'Talk isolated confirmation preparation v1\n');
 }
 const meetings=createMeetingService({NODE_ENV:'development',LIVEKIT_URL:'ws://127.0.0.1:7880',LIVEKIT_API_KEY:'fixture-key',LIVEKIT_API_SECRET:'fixture-secret-for-local-unit-tests-only'});
 meetings.admin={listParticipants:async()=>[],sendData:async()=>{},deleteRoom:async()=>{},removeParticipant:async()=>{},updateParticipant:async()=>{}};
 const mailbox=[],runtime=createBookingTestApp(config,fixture,{meetings,localMockMailbox:mock?mailbox:undefined,now:()=>nowState.value});
 const server=createServer(runtime.app);runtime.attach(server);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await runtime.close();});
 const b=()=>runtime.raw.prepare('SELECT b.*,o.starts_at,o.ends_at FROM scheduling_bookings b JOIN scheduling_occurrences o ON o.id=b.occurrence_id').get();
 nowState.value=b().starts_at-10*60000;
 const credential=()=>new URL(config.links.inviteeUrl(b())).hash.slice(1);
 function client(){const jar=new Map();let csrf='';return {setCsrf:v=>csrf=v,async request(route,body,extra={}){
   const response=await fixtureFetch(`http://127.0.0.1:${server.address().port}`+route,{method:body===undefined?'GET':'POST',headers:{Host:new URL(origin).host,Origin:origin,...(publicMode?{'X-Forwarded-Proto':'https','CF-Connecting-IP':'192.0.2.5'}:{}),Cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; '),'Content-Type':'application/json','X-CSRF-Token':csrf,...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
   for(const c of response.headers.getSetCookie()){const [k,v]=c.split(';')[0].split('=');jar.set(k,v);}
   const text=await response.text();return {status:response.status,body:response.headers.get('content-type')?.includes('json')?JSON.parse(text):text,headers:response.headers};
 }};}
 const base='/api/auth/scheduling',booking=base+'/booking/'+fixture.bookingId,guest=base+'/guest/meetings/'+fixture.meetingId;
 async function form(c){return (await c.request(base+'/form')).body.formToken;}
 async function request(c,p,body){return c.request(p,body,{'X-Scheduling-Token':await form(c)});}
 async function host(){const c=client(),cfg=await c.request('/api/auth/config');c.setCsrf(cfg.body.csrfToken);const access=JSON.parse(readFileSync(path.join(fixture.directory,'host-access.private.json')));const login=await c.request('/api/auth/email/login',{email:access.email,password:access.password});assert.equal(login.status,200);c.setCsrf(login.body.csrfToken);return c;}
 return {runtime,fixture,config,mailbox,client,request,booking,guest,credential,b,nowState,host};
}

test('signed confirmation works without SMTP and rejects tampering, expiry and foreign bookings',async t=>{
 const f=await setup(t,{mock:false}),c=f.client(),token=f.credential();
 assert.equal((await f.request(c,f.booking+'/detail',{credential:token})).status,200);
 f.runtime.raw.prepare('UPDATE scheduling_invitations SET revoked=1').run();
 assert.equal((await f.request(c,f.booking+'/detail',{credential:token})).status,404);
 f.runtime.raw.prepare('UPDATE scheduling_invitations SET revoked=0').run();
 assert.equal((await f.request(c,f.booking+'/detail',{credential:randomBytes(32).toString('base64url')})).status,404);
 assert.equal((await f.request(c,'/api/auth/scheduling/booking/another/detail',{credential:token})).status,404);
 assert.equal((await f.request(c,f.booking+'/code',{credential:token})).status,503);
 f.nowState.value=f.b().ends_at+3600001;
 assert.equal((await f.request(c,f.booking+'/detail',{credential:token})).status,404);
 assert.equal(f.mailbox.length,0);
});
test('guest proof, one-time redemption, admission, removal and meeting isolation',async t=>{
 const f=await setup(t),c=f.client(),credential=f.credential(),host=await f.host();
 assert.equal((await f.request(c,f.booking+'/redeem',{credential,code:'000000'})).status,403);
 assert.equal((await f.request(c,f.booking+'/code',{credential})).status,200);assert.equal(f.mailbox.length,1);
 const redeemed=await f.request(c,f.booking+'/redeem',{credential,code:f.mailbox[0].code});assert.equal(redeemed.status,200);c.setCsrf(redeemed.body.csrfToken);
 assert.equal((await f.request(c,f.booking+'/redeem',{credential,code:f.mailbox[0].code})).status,403);
 assert.equal((await c.request(f.guest+'/token',{displayName:'Synthetic guest'})).status,202);
 const hostPath='/api/auth/meetings/'+f.fixture.meetingId;
 const pending=(await host.request(hostPath+'/state')).body.pending;assert.equal(pending.length,1);
 assert.equal((await host.request(hostPath+'/actions',{action:'admit',target:pending[0].accountId})).status,200);
 const joined=await c.request(f.guest+'/token',{displayName:'Synthetic guest'});assert.equal(joined.status,200);assert.equal(joined.body.token.length,43);
 for(const p of ['/api/auth/scheduling/dashboard','/api/auth/meeting-history',hostPath+'/recordings',hostPath+'/whiteboard',hostPath+'/ai-reports','/api/auth/scheduling/guest/meetings/other/state'])assert.notEqual((await c.request(p)).status,200,p);
 assert.equal((await c.request(hostPath+'/actions',{action:'admit',target:pending[0].accountId})).status,401);
 assert.equal((await host.request(hostPath+'/actions',{action:'remove',target:pending[0].accountId})).status,200);
 assert.equal((await c.request(f.guest+'/token',{displayName:'Synthetic guest'})).status,403);
});

test('isolated guest OTP expiry, resend cooldown and five-attempt lockout use only a mock mailbox',async t=>{
 const f=await setup(t),c=f.client(),credential=f.credential();
 assert.equal((await f.request(c,f.booking+'/code',{credential})).status,200);
 const expired=f.mailbox.at(-1).code;
 assert.equal((await f.request(c,f.booking+'/code',{credential})).status,429);
 f.nowState.value+=5*60000+1;
 assert.equal((await f.request(c,f.booking+'/redeem',{credential,code:expired})).status,403);
 assert.equal((await f.request(c,f.booking+'/code',{credential})).status,200);
 const correct=f.mailbox.at(-1).code,wrong=correct==='000000'?'000001':'000000';
 for(let attempt=0;attempt<5;attempt++)assert.equal((await f.request(c,f.booking+'/redeem',{credential,code:wrong})).status,403);
 assert.equal((await f.request(c,f.booking+'/redeem',{credential,code:correct})).status,403);
 assert.equal((await c.request(f.guest+'/token',{displayName:'Synthetic guest'})).status,401);
 assert.equal(f.mailbox.length,2);
 assert.equal(f.mailbox.at(-1).to,f.config.emails[1]);
});
test('cancelled and version-revoked links stop working; isolated DB persists on reopen',async t=>{
 const f=await setup(t),c=f.client(),credential=f.credential();
 f.runtime.raw.prepare('UPDATE scheduling_bookings SET version=version+1').run();
 assert.equal((await f.request(c,f.booking+'/detail',{credential})).status,404);
 const updated=f.credential();f.runtime.raw.prepare("UPDATE scheduling_bookings SET status='cancelled'").run();
 assert.equal((await f.request(c,f.booking+'/detail',{credential:updated})).status,404);
 assert.ok(f.fixture.databasePath.includes(path.join('data','booking-link-test','run-')));
 assert.equal(f.runtime.raw.prepare('SELECT COUNT(*) n FROM accounts').get().n,1);
 const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(f.fixture.databasePath,{readOnly:true});try{assert.equal(db.prepare('SELECT status FROM scheduling_bookings').get().status,'cancelled');}finally{db.close();}
});
test('public-mode HTTPS cookies, exact origin, CSRF, route restriction and allowlist',async t=>{
 const f=await setup(t,{publicMode:true,mock:false}),c=f.client();
 const cfg=await c.request('/api/auth/config');assert.match(cfg.headers.get('set-cookie'),/Secure/);assert.match(cfg.headers.get('set-cookie'),/HttpOnly/);assert.match(cfg.headers.get('set-cookie'),/SameSite=Lax/i);
 assert.ok(cfg.headers.getSetCookie().every(v=>v.startsWith('bookingtest_')));
 assert.equal((await c.request('/healthz',undefined,{'X-Forwarded-Proto':'http'})).status,403);
 assert.equal((await c.request('/healthz',undefined,{'CF-Connecting-IP':'invalid'})).status,403);
 assert.equal((await c.request('/healthz',undefined,{Host:'untrusted.example'})).status,403);
 assert.equal((await c.request('/api/auth/email/login',{email:'outsider@example.test',password:'unused'})).status,403);
 assert.equal((await c.request(f.booking+'/detail',{credential:f.credential()},{Origin:'https://untrusted.example'})).status,403);
 assert.equal((await c.request(f.booking+'/detail',{credential:f.credential()})).status,403);
 for(const p of ['/.env.local','/src/main.tsx','/admin','/bookings','/api/auth/google','/api/auth/phone/configuration','/api/auth/scheduling/events/a/book'])assert.equal((await c.request(p)).status,404,p);
 assert.equal((await c.request('/booking-confirmation')).status,200);
 assert.equal((await c.request('/healthz')).body.email,false);
 assert.throws(()=>createBookingTestApp(f.config,f.fixture,{localMockMailbox:[]}));
});
test('rate limiting and restart preserve signed booking access without a delivery worker',async t=>{
 const f=await setup(t,{mock:false}),c=f.client(),credential=f.credential();
 let response;for(let i=0;i<241;i++)response=await c.request('/api/auth/scheduling/form');
 assert.equal(response.status,429);
 await f.runtime.close();
 const meetings=createMeetingService({NODE_ENV:'development',LIVEKIT_URL:'ws://127.0.0.1:7880',LIVEKIT_API_KEY:'fixture-key',LIVEKIT_API_SECRET:'fixture-secret-for-local-unit-tests-only'});
 const reopened=createBookingTestApp(f.config,f.fixture,{meetings,now:()=>f.nowState.value});
 try{const service=reopened.auth.locals.scheduling;await service.db.withContext(async()=>{
   assert.equal((await service.detail(f.fixture.bookingId,credential)).booking.id,f.fixture.bookingId);
   assert.equal((await reopened.auth.locals.schedulingJobs.tick()).enabled,false);
 });}finally{await reopened.close();}
 assert.equal(f.mailbox.length,0);
});

test('new confirmation fixture reuses one booking with restricted routes, secure cookies and a disabled queued confirmation',async t=>{
 const f=await setup(t,{publicMode:true,mock:false,confirmationFixture:true}),c=f.client();
 assert.equal((await f.request(c,f.booking+'/detail',{credential:f.credential()})).status,200);
 assert.equal(f.runtime.raw.prepare('SELECT COUNT(*) n FROM scheduling_bookings').get().n,1);
 assert.equal(f.runtime.raw.prepare("SELECT COUNT(*) n FROM scheduling_jobs WHERE status='queued'").get().n,1);
 assert.equal((await f.runtime.auth.locals.schedulingJobs.tick()).enabled,false);
 const cfg=await c.request('/api/auth/config');assert.ok(cfg.headers.getSetCookie().every(v=>/Secure/.test(v)&&v.startsWith('bookingtest_')));
 assert.equal((await c.request('/api/auth/scheduling/dashboard')).status,404);
 assert.equal((await c.request('/api/auth/scheduling/google-calendar')).status,404);
 assert.equal((await f.request(c,f.booking+'/code',{credential:f.credential()})).status,503);
 assert.equal((await c.request('/api/auth/email/login',{email:'outside@example.invalid',password:'unused'})).status,403);
});

test('SMTP reliability fixture preserves signed access, strict scope, OTP blocking and future expiry',async t=>{
 const f=await setup(t,{publicMode:true,mock:false,reliabilityFixture:true}),c=f.client(),credential=f.credential();
 const detail=await f.request(c,f.booking+'/detail',{credential});assert.equal(detail.status,200);assert.equal(detail.body.booking.event.title,'SMTP Reliability Test');assert.equal(detail.body.booking.name,'Synthetic Reliability Guest');assert.equal(detail.body.emailEnabled,false);assert.equal((await f.request(c,f.booking+'/code',{credential})).status,503);
 assert.equal((await f.request(c,f.booking+'/calendar',{credential})).status,200);assert.equal((await f.request(c,f.booking+'/detail',{credential:randomBytes(32).toString('base64url')})).status,404);assert.equal((await c.request('/api/auth/scheduling/email-deliveries')).status,404);assert.equal((await c.request('/api/auth/scheduling/guest/meetings/foreign/token',{})).status,404);
 f.runtime.raw.prepare('UPDATE scheduling_invitations SET revoked=1').run();assert.equal((await f.request(c,f.booking+'/detail',{credential})).status,404);f.runtime.raw.prepare('UPDATE scheduling_invitations SET revoked=0').run();
 f.nowState.value=f.b().ends_at+3600001;assert.equal((await f.request(c,f.booking+'/detail',{credential})).status,404);assert.equal((await f.runtime.auth.locals.schedulingJobs.tick()).enabled,false);
});

test('SMTP reliability fixture still requires guest proof then host admission with local mock proof only',async t=>{
 const f=await setup(t,{mock:true,reliabilityFixture:true}),c=f.client(),credential=f.credential(),host=await f.host();assert.equal((await c.request(f.guest+'/token',{displayName:'Synthetic Guest'})).status,401);
 assert.equal((await f.request(c,f.booking+'/code',{credential})).status,200);const proof=await f.request(c,f.booking+'/redeem',{credential,code:f.mailbox[0].code});assert.equal(proof.status,200);c.setCsrf(proof.body.csrfToken);assert.equal((await c.request(f.guest+'/token',{displayName:'Synthetic Guest'})).status,202);const p='/api/auth/meetings/'+f.fixture.meetingId,pending=(await host.request(p+'/state')).body.pending;assert.equal(pending.length,1);assert.equal((await host.request(p+'/actions',{action:'admit',target:pending[0].accountId})).status,200);assert.equal((await c.request(f.guest+'/token',{displayName:'Synthetic Guest'})).status,200);assert.equal((await c.request(p+'/actions',{action:'admit',target:pending[0].accountId})).status,401);
});
