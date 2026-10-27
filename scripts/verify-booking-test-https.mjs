// Only the approved isolated tunnel. Never prints credentials or response bodies.
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
const directory='data/booking-link-test/run-k4g1R9';
const state=JSON.parse(fs.readFileSync('data/booking-link-test/public-tunnel.json'));
const origin=state.origin;
assert.ok(state.connected&&state.running&&/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(origin));
const fixture=JSON.parse(fs.readFileSync(directory+'/fixture.json'));
const link=new URL(fs.readFileSync(directory+'/invitation.private.txt','utf8').trim());
assert.equal(link.origin,origin);
const credential=link.hash.slice(1),base='/api/auth/scheduling',booking=base+'/booking/'+fixture.bookingId;
const result={origin,emailSent:false,normalAiEnabled:false,checks:{}};
const checks=result.checks;
let stage='health';
async function request(p,body,headers={}){
 const r=await fetch(origin+p,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json',Origin:origin}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
 const text=await r.text();let data;try{data=JSON.parse(text);}catch{}
 return {status:r.status,headers:r.headers,data};
}
async function post(p,body,headers={}){const form=await request(base+'/form');assert.equal(form.status,200);return request(p,body,{'X-Scheduling-Token':form.data.formToken,...headers});}
try{
 const health=await request('/healthz');assert.equal(health.status,200);assert.equal(health.data.isolatedBookingTest,true);for(const flag of ['email','ai','recording','sms'])assert.equal(health.data[flag],false);checks.health='PASS';
 stage='confirmation page';assert.equal((await request('/booking-confirmation')).status,200);checks.confirmationPage='PASS';
 stage='signed link';assert.equal((await post(booking+'/detail',{credential})).status,200);checks.signedLink='PASS';
 stage='tampered and foreign links';assert.equal((await post(booking+'/detail',{credential:randomBytes(32).toString('base64url')})).status,404);
 assert.equal((await post(booking+'/detail',{credential:'invalid'})).status,403);
 assert.equal((await post(base+'/booking/not-the-fixture/detail',{credential})).status,404);checks.invalidTamperedAndForeignLinks='PASS';
 stage='expired link';
 const db=new DatabaseSync(directory+'/talk.sqlite');
 try{
  for(const table of ['talk_meeting_connections','scheduling_guest_connections'])assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE revoked=0 AND expires_at>?`).get(Date.now()).n,0);
  const b=db.prepare('SELECT occurrence_id FROM scheduling_bookings WHERE id=?').get(fixture.bookingId);
  const original=db.prepare('SELECT starts_at,ends_at FROM scheduling_occurrences WHERE id=?').get(b.occurrence_id);
  try{
   // Synthetic fixture only. Restore both times even if the public probe fails.
   db.prepare('UPDATE scheduling_occurrences SET starts_at=?,ends_at=? WHERE id=?').run(Date.now()-7200000,Date.now()-3600001,b.occurrence_id);
   assert.equal((await post(booking+'/detail',{credential})).status,404);checks.expiredLink='PASS';
  }finally{db.prepare('UPDATE scheduling_occurrences SET starts_at=?,ends_at=? WHERE id=?').run(original.starts_at,original.ends_at,b.occurrence_id);}
  stage='revoked invitation';
  const invitations=db.prepare('SELECT id,revoked FROM scheduling_invitations WHERE booking_id=?').all(fixture.bookingId);
  try{db.prepare('UPDATE scheduling_invitations SET revoked=1 WHERE booking_id=?').run(fixture.bookingId);assert.equal((await post(booking+'/detail',{credential})).status,404);checks.revokedInvitation='PASS';}
  finally{for(const i of invitations)db.prepare('UPDATE scheduling_invitations SET revoked=? WHERE id=?').run(i.revoked,i.id);}
 }finally{db.close();}
 stage='restored booking';assert.equal((await post(booking+'/detail',{credential})).status,200);checks.syntheticFixtureRestored='PASS';
 stage='guest verification';assert.equal((await post(booking+'/code',{credential})).status,503);
 assert.equal((await post(booking+'/redeem',{credential,code:'000000'})).status,403);
 assert.equal((await request(base+'/guest/meetings/'+fixture.meetingId+'/token',{})).status,401);
 checks.guestProofAndAuthenticationEnforced='PASS';checks.guestJoining='BLOCKED_EMAIL_DISABLED';
 stage='cookie security';const config=await request('/api/auth/config');assert.equal(config.status,200);
 const cookies=config.headers.getSetCookie();assert.ok(cookies.length>0);assert.ok(cookies.every(c=>c.startsWith('bookingtest_')&&/; Secure/i.test(c)&&/; HttpOnly/i.test(c)&&/; SameSite=Lax/i.test(c)));checks.secureIsolatedCookies='PASS';
 stage='CSRF and origins';assert.equal((await request(booking+'/detail',{credential})).status,403);
 assert.equal((await post(booking+'/detail',{credential},{Origin:'https://untrusted.example'})).status,403);checks.csrfAndOrigin='PASS';
 stage='email allowlist';assert.equal((await request('/api/auth/email/login',{email:'not-invited@example.invalid',password:'unused-synthetic-value'})).status,403);checks.emailAllowlist='PASS';
 stage='private endpoints';for(const p of ['/.env.local','/data/booking-link-test/run-k4g1R9/host-access.private.json','/api/auth/scheduling/dashboard','/api/auth/google','/api/auth/phone/send',`/api/auth/meetings/${fixture.meetingId}/recordings`,`/api/auth/meetings/${fixture.meetingId}/ai-reports`])assert.notEqual((await request(p)).status,200);checks.privateAndDisabledRoutes='PASS';
 result.success=true;
}catch{result.success=false;result.failedStage=stage;process.exitCode=1;}
fs.writeFileSync('artifacts/qa/booking-https-verification.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
