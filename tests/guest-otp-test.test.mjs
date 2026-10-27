import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,randomInt,createHash} from 'node:crypto';
import {createServer,request as httpRequest} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {prepareBookingTest,createBookingTestApp} from '../backend/src/scheduling/booking-link-test.mjs';
import {createMeetingService} from '../backend/src/meetings.mjs';
import {createEmailLinks} from '../backend/src/scheduling/email-links.mjs';
import {prepareGuestOtpTest,createControlledGuestOtpTransport} from '../backend/src/scheduling/guest-otp-test.mjs';
const email='niknikhil.sharma22@gmail.com',hash=v=>createHash('sha256').update(v).digest('hex');
async function setup(t){
 const clock={value:Date.now()},key=randomBytes(32).toString('base64url'),origin='https://fixture.trycloudflare.com';
 const config={root:process.cwd(),origin,publicMode:true,emails:['host@example.test',email,'two@example.test','three@example.test','four@example.test'],links:createEmailLinks({baseUrl:origin,secret:key})};
 const fixture=await prepareBookingTest(config,{now:clock.value});
 const db=new DatabaseSync(fixture.databasePath);t.after(()=>db.close());
 const b=db.prepare('SELECT b.*,o.starts_at,o.ends_at FROM scheduling_bookings b JOIN scheduling_occurrences o ON o.id=b.occurrence_id').get();
 const i=db.prepare('SELECT * FROM scheduling_invitations WHERE booking_id=?').get(b.id);
 fs.writeFileSync(path.join(fixture.directory,'invitation.private.txt'),config.links.inviteeUrl(b),{mode:0o600});
 const env={SMTP_HOST:'smtp.gmail.com',SMTP_PORT:'587',SMTP_FROM:email,SMTP_USER:email,SMTP_PASSWORD:'test-only-never-used-by-real-smtp',SCHEDULING_EMAIL_LINK_SECRET:key};
 const options={config,fixture,env,now:()=>clock.value,approved:true},context={bookingId:b.id,invitationId:i.id,to:email};
 const prep=()=>prepareGuestOtpTest({...options,now:clock.value});
 const ledger=()=>{const d=new DatabaseSync(path.join(fixture.directory,'guest-otp-attempt.sqlite'),{readOnly:true});try{return d.prepare('SELECT * FROM guest_otp_attempt').get();}finally{d.close();}};
 const code=()=>{const value=String(randomInt(0,1000000)).padStart(6,'0'),expiresAt=new Date(clock.value+300000);db.prepare('UPDATE scheduling_invitations SET proof_hash=?,proof_expires_at=? WHERE id=?').run(hash(i.id+':'+value),expiresAt.getTime(),i.id);return {...context,code:value,expiresAt};};
 return {config,fixture,db,b,i,env,options,context,clock,prep,ledger,code};
}
test('offline preparation is immutable, disabled and creates no OTP or SMTP connection',async t=>{
 const f=await setup(t),r=f.prep();assert.equal(r.attemptsConsumed,0);assert.equal(r.realDeliveryEnabled,false);
 assert.equal(f.db.prepare('SELECT proof_hash FROM scheduling_invitations').get().proof_hash,null);
 assert.deepEqual(f.prep(),r);assert.throws(()=>createControlledGuestOtpTransport({...f.options,approved:false}));
 assert.equal(f.ledger().consumed,0);
});
test('joining window, recipient, booking, invitation, allowlist and signing configuration fail closed',async t=>{
 const f=await setup(t);f.prep();let factories=0;
 const adapter=createControlledGuestOtpTransport({...f.options,createTransport:()=>{factories++;throw 0;}});
 f.clock.value=f.b.starts_at-900001;
 assert.equal(await adapter.canSendCode(f.context),false);
 f.clock.value=f.b.starts_at-900000;
 assert.equal(await adapter.canSendCode(f.context),true);
 for(const context of [{...f.context,to:'other@example.test'},{...f.context,bookingId:'other'},{...f.context,invitationId:'other'}])assert.equal(await adapter.canSendCode(context),false);
 f.config.emails[2]='changed@example.test';assert.equal(await adapter.canSendCode(f.context),false);f.config.emails[2]='two@example.test';
 f.env.SMTP_PASSWORD='changed';assert.equal(await adapter.canSendCode(f.context),false);f.env.SMTP_PASSWORD='test-only-never-used-by-real-smtp';
 f.clock.value=f.b.ends_at+3600001;assert.equal(await adapter.canSendCode(f.context),false);
 assert.equal(f.ledger().consumed,0);assert.equal(factories,0);
});
test('one mock SMTP message with verified TLS and no retries, concurrency/restart cannot resend',async t=>{
 const f=await setup(t);f.prep();f.clock.value=f.b.starts_at-900000;const mail=f.code();let calls=0,closes=0;
 const factory=options=>{assert.equal(options.host,'smtp.gmail.com');assert.equal(options.port,587);assert.equal(options.requireTLS,true);assert.equal(options.tls.rejectUnauthorized,true);assert.equal(options.tls.minVersion,'TLSv1.2');assert.equal(options.pool,false);assert.equal(options.maxRequeues,0);assert.equal(options.logger,false);assert.equal(options.debug,false);
  return {sendMail:async message=>{calls++;assert.equal(f.ledger().consumed,1);assert.equal(message.subject,'Your Talk verification code');assert.equal(message.to.address,email);assert.equal(message.from.address,email);assert.equal(message.cc,undefined);assert.equal(message.bcc,undefined);assert.ok(message.text.includes(mail.code));return {accepted:[email],rejected:[]};},close:()=>closes++};};
 const a=createControlledGuestOtpTransport({...f.options,createTransport:factory});
 const outcomes=await Promise.allSettled([a.sendCode(mail),a.sendCode(mail)]);
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal(calls,1);assert.equal(closes,1);assert.equal(f.ledger().status,'accepted');
 const restarted=createControlledGuestOtpTransport({...f.options,createTransport:factory});assert.equal(await restarted.canSendCode(f.context),false);await assert.rejects(restarted.sendCode(mail));assert.equal(calls,1);
 assert.ok(!JSON.stringify(f.ledger()).includes(mail.code));
});
test('SMTP failure or ambiguous result consumes attempt, clears proof and never leaks raw diagnostics',async t=>{
 const f=await setup(t);f.prep();f.clock.value=f.b.starts_at-900000;const mail=f.code();let calls=0;
 const adapter=createControlledGuestOtpTransport({...f.options,createTransport:()=>({sendMail:async()=>{calls++;throw new Error('private SMTP payload '+mail.code);}})});
 await assert.rejects(adapter.sendCode(mail),error=>!error.message.includes(mail.code)&&!error.message.includes('SMTP payload'));
 assert.equal(f.ledger().consumed,1);assert.equal(f.ledger().status,'failed_or_unknown');assert.equal(f.db.prepare('SELECT proof_hash FROM scheduling_invitations').get().proof_hash,null);
 assert.equal(await adapter.canSendCode(f.context),false);await assert.rejects(adapter.sendCode(mail));assert.equal(calls,1);
});
test('forged or expired OTP proof and cancelled/revoked invitations cannot reserve SMTP',async t=>{
 const f=await setup(t);f.prep();f.clock.value=f.b.starts_at-900000;const mail=f.code();let calls=0;
 const adapter=createControlledGuestOtpTransport({...f.options,createTransport:()=>{calls++;throw 0;}});
 await assert.rejects(adapter.sendCode({...mail,code:mail.code==='000000'?'000001':'000000'}));
 f.clock.value+=300001;await assert.rejects(adapter.sendCode(mail));
 f.db.prepare('UPDATE scheduling_invitations SET revoked=1').run();assert.equal(await adapter.canSendCode(f.context),false);
 f.db.prepare('UPDATE scheduling_invitations SET revoked=0').run();f.db.prepare("UPDATE scheduling_bookings SET status='cancelled'").run();assert.equal(await adapter.canSendCode(f.context),false);
 f.db.prepare("UPDATE scheduling_bookings SET status='confirmed'").run();f.db.prepare("UPDATE talk_meetings SET status='ended'").run();assert.equal(await adapter.canSendCode(f.context),false);
 assert.equal(f.ledger().consumed,0);assert.equal(calls,0);
});

test('a reserved attempt left by a crash remains consumed after a fresh adapter opens',async t=>{
 const f=await setup(t);f.prep();f.clock.value=f.b.starts_at-900000;const mail=f.code();
 const db=new DatabaseSync(path.join(f.fixture.directory,'guest-otp-attempt.sqlite'));
 db.prepare("UPDATE guest_otp_attempt SET consumed=1,status='reserved',reserved_at=?").run(f.clock.value);db.close();
 let calls=0;const adapter=createControlledGuestOtpTransport({...f.options,createTransport:()=>{calls++;throw 0;}});
 assert.equal(await adapter.canSendCode(f.context),false);await assert.rejects(adapter.sendCode(mail));
 assert.equal(calls,0);assert.equal(f.ledger().consumed,1);assert.equal(f.ledger().status,'reserved');
});

test('public adapter with mock SMTP enforces proof, CSRF, allowlist and admission; consumed resend preserves working code',async t=>{
 const f=await setup(t);f.prep();f.clock.value=f.b.starts_at-900000;let messages=0,code;
 const transport=createControlledGuestOtpTransport({...f.options,createTransport:()=>({sendMail:async mail=>{messages++;code=mail.text.match(/\b\d{6}\b/)[0];return {accepted:[email],rejected:[]};}})});
 const meetings=createMeetingService({NODE_ENV:'development',LIVEKIT_URL:'ws://127.0.0.1:7880',LIVEKIT_API_KEY:'fixture-key',LIVEKIT_API_SECRET:'fixture-secret-for-local-unit-tests-only'});
 meetings.admin={listParticipants:async()=>[],sendData:async()=>{},deleteRoom:async()=>{},removeParticipant:async()=>{},updateParticipant:async()=>{}};
 const runtime=createBookingTestApp({...f.config,frontendPath:path.join(process.cwd(),'artifacts/qa/booking-link-frontend')},f.fixture,{meetings,controlledOtpTransport:transport,now:()=>f.clock.value});
 const server=createServer(runtime.app);runtime.attach(server);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await runtime.close();});
 const jar=new Map();
 const request=(route,body,extra={})=>new Promise((resolve,reject)=>{const req=httpRequest({hostname:'127.0.0.1',port:server.address().port,path:route,method:body===undefined?'GET':'POST',headers:{Host:new URL(f.config.origin).host,Origin:f.config.origin,'X-Forwarded-Proto':'https','CF-Connecting-IP':'192.0.2.7','Content-Type':'application/json',Cookie:[...jar].map(([k,v])=>k+'='+v).join('; '),...extra}},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>{for(const c of res.headers['set-cookie']||[]){const [k,v]=c.split(';')[0].split('=');jar.set(k,v);}resolve({status:res.statusCode,body:JSON.parse(text)});});});req.on('error',reject);if(body!==undefined)req.write(JSON.stringify(body));req.end();});
 const token=(await request('/api/auth/scheduling/form')).body.formToken,headers={'X-Scheduling-Token':token};
 const base='/api/auth/scheduling/booking/'+f.b.id,guest='/api/auth/scheduling/guest/meetings/'+f.fixture.meetingId;
 const credential=new URL(f.config.links.inviteeUrl(f.b)).hash.slice(1);
 assert.equal((await request(guest+'/token',{displayName:'Synthetic guest'})).status,401);
 assert.equal((await request(base+'/code',{credential})).status,403);
 assert.equal((await request(base+'/code',{credential},{...headers,Origin:'https://untrusted.example'})).status,403);
 assert.equal((await request('/api/auth/email/login',{email:'outsider@example.test',password:'unused'})).status,403);
 const sent=await request(base+'/code',{credential},headers);assert.equal(sent.status,200);assert.equal(sent.body.sent,true);assert.equal('code' in sent.body,false);assert.equal(messages,1);
 assert.equal((await request(base+'/code',{credential},headers)).status,429);
 const proof=f.db.prepare('SELECT proof_hash FROM scheduling_invitations').get().proof_hash;
 f.clock.value+=61000;
 assert.equal((await request(base+'/code',{credential},headers)).status,409);
 assert.equal(f.db.prepare('SELECT proof_hash FROM scheduling_invitations').get().proof_hash,proof);
 const redeemed=await request(base+'/redeem',{credential,code},headers);assert.equal(redeemed.status,200);
 assert.equal((await request(base+'/redeem',{credential,code},headers)).status,403);
 assert.equal((await request(guest+'/token',{displayName:'Synthetic guest'},{'X-CSRF-Token':redeemed.body.csrfToken})).status,202);
 assert.equal((await request('/api/auth/meetings/'+f.fixture.meetingId+'/actions',{action:'admit',target:'self'},{'X-CSRF-Token':redeemed.body.csrfToken})).status,401);
 assert.equal(messages,1);assert.equal(typeof transport.send,'undefined');
 assert.equal((await runtime.auth.locals.schedulingJobs.tick()).sent,0);
});
