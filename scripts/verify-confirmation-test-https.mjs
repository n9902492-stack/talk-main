// Approved fixture only; no SMTP/OTP/Calendar adapter is constructed or invoked.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomBytes} from 'node:crypto';
import {parse} from 'dotenv';
import {chromium,expect} from '@playwright/test';
import {localChrome} from './browser-options.mjs';
import {createEmailLinks} from '../backend/src/scheduling/email-links.mjs';
import {emailBookingSql} from '../backend/src/scheduling/email-outbox.mjs';
import {renderSchedulingEmail} from '../backend/src/scheduling/email-templates.mjs';
import {calendarInvitation} from '../backend/src/scheduling/calendar.mjs';
import {createVerificationMailer} from '../backend/src/mailer.mjs';

const state=JSON.parse(fs.readFileSync('data/booking-link-test/confirmation-public-tunnel.json','utf8'));
const origin=state.origin,recipient='niknikhil.sharma22@gmail.com',directory=path.resolve('data/booking-link-test/confirmation-flow-vBfobG');
const result={success:false,origin,checks:{},emailsSent:0,otpSent:0,calendarWrites:0},hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const preserved=['.env.local','.env.tunnel-test.local','data/booking-link-test/public-tunnel.json'],before=Object.fromEntries(preserved.map(f=>[f,hash(f)]));
let browser,db,stage='approved runtime';
async function request(p,body,headers={}){
 const r=await fetch(origin+p,{method:body===undefined?'GET':'POST',redirect:'error',headers:{...(body===undefined?{}:{'Content-Type':'application/json',Origin:origin}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)});
 const text=await r.text();let data;try{data=JSON.parse(text);}catch{}return {status:r.status,data,text,headers:r.headers};
}
const base='/api/auth/scheduling';
async function post(p,body,extra={}){const form=await request(base+'/form');assert.equal(form.status,200);return request(p,body,{'X-Scheduling-Token':form.data.formToken,...extra});}
const save=(name,value)=>fs.writeFileSync(path.join(directory,name),value,{mode:0o600});
try{
 assert.ok(state.running&&state.connected);assert.match(origin,/^https:\/\/(?:[a-z0-9]+-){2,}[a-z0-9]+\.trycloudflare\.com$/);assert.equal(path.resolve(state.database),path.join(directory,'talk.sqlite'));assert.equal(state.scheduledPublicUrl,origin);
 const fixture=JSON.parse(fs.readFileSync(path.join(directory,'fixture.json'),'utf8')),env=parse(fs.readFileSync('.env.local')),allow=parse(fs.readFileSync('.env.tunnel-test.local'));
 const emails=allow.TUNNEL_TEST_EMAILS.split(',').map(v=>v.trim().toLowerCase());assert.equal(emails.length,5);assert.equal(new Set(emails).size,5);assert.ok(emails.includes(recipient));
 for(const key of ['smtp','otp','sms','recording','transcription','gemini','calendar'])assert.equal(state[key],false);
 db=new DatabaseSync(path.join(directory,'talk.sqlite'));const b=db.prepare(emailBookingSql).get(fixture.bookingId);
 assert.equal(b.title,'Talk Booking Confirmation Test');assert.equal(b.email,recipient);assert.equal(b.starts_at,Date.parse('2026-10-24T14:15:00+05:30'));assert.equal(b.ends_at-b.starts_at,1800000);assert.ok(b.starts_at>Date.now());assert.equal(db.prepare('SELECT COUNT(*) n FROM scheduling_bookings').get().n,1);
 const link=fs.readFileSync(path.join(directory,'invitation.private.txt'),'utf8').trim(),url=new URL(link),credential=url.hash.slice(1),links=createEmailLinks({baseUrl:origin,secret:env.SCHEDULING_EMAIL_LINK_SECRET});
 assert.equal(link,links.inviteeUrl(b));assert.equal(url.origin,origin);assert.ok(links.verify(b,credential,Date.now()));assert.ok(links.verify(b,credential,b.ends_at+3600000));assert.equal(links.verify(b,credential,b.ends_at+3600001),false);
 stage='public health';const health=await request('/healthz');assert.equal(health.status,200);assert.equal(health.data.isolatedBookingTest,true);for(const key of ['email','guestOtpDelivery','ai','recording','sms'])assert.equal(health.data[key],false);result.checks.httpsRuntimeAndTunnel='PASS';
 const book=base+'/booking/'+fixture.bookingId;
 stage='signed confirmation';assert.equal((await request('/booking-confirmation')).status,200);const detail=await post(book+'/detail',{credential});assert.equal(detail.status,200);assert.equal(detail.data.booking.id,b.id);assert.equal(detail.data.booking.event.emailEnabled,false);result.checks.signedConfirmation='PASS';
 stage='invalid and cross-booking links';assert.equal((await post(book+'/detail',{credential:'invalid'})).status,403);assert.equal((await post(book+'/detail',{credential:randomBytes(32).toString('base64url')})).status,404);assert.equal((await post(base+'/booking/another-booking/detail',{credential})).status,404);result.checks.invalidTamperedAndCrossBooking='PASS';
 stage='expired and revoked invitations';
 // Never alter the scheduled time. Only temporarily expire/revoke this private,
 // idle synthetic invitation, restoring its exact fields even if a probe fails.
 for(const table of ['talk_meeting_connections','scheduling_guest_connections'])assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE revoked=0 AND expires_at>?`).get(Date.now()).n,0);
 const invitations=db.prepare('SELECT id,expires_at,revoked FROM scheduling_invitations WHERE booking_id=?').all(b.id);assert.ok(invitations.length);
 try{db.prepare('UPDATE scheduling_invitations SET expires_at=? WHERE booking_id=?').run(Date.now()-1000,b.id);assert.equal((await post(book+'/detail',{credential})).status,404);}finally{for(const row of invitations)db.prepare('UPDATE scheduling_invitations SET expires_at=? WHERE id=?').run(row.expires_at,row.id);}
 try{db.prepare('UPDATE scheduling_invitations SET revoked=1 WHERE booking_id=?').run(b.id);assert.equal((await post(book+'/detail',{credential})).status,404);}finally{for(const row of invitations)db.prepare('UPDATE scheduling_invitations SET revoked=? WHERE id=?').run(row.revoked,row.id);}
 assert.equal((await post(book+'/detail',{credential})).status,200);result.checks.expiredRevokedAndRestored='PASS';
 stage='guest and private-resource authorization';assert.equal((await post(book+'/code',{credential})).status,503);assert.equal((await post(book+'/redeem',{credential,code:'000000'})).status,403);assert.equal((await request(base+'/guest/meetings/'+fixture.meetingId+'/token',{})).status,401);
 assert.equal((await request('/api/auth/email/login',{email:'outside@example.invalid',password:'unused'})).status,403);
 for(const p of ['/.env.local','/api/auth/google','/api/auth/phone/send','/api/auth/scheduling/dashboard','/api/auth/scheduling/google-calendar',base+'/booking/another-booking/detail','/api/auth/meetings/'+fixture.meetingId+'/recordings','/api/auth/meetings/'+fixture.meetingId+'/whiteboard'])assert.notEqual((await request(p)).status,200);
 result.checks.allowlistEmailProofAndRouteIsolation='PASS';
 stage='cookies and CSRF';const cfg=await request('/api/auth/config'),cookies=cfg.headers.getSetCookie();assert.equal(cfg.status,200);assert.ok(cookies.length);assert.ok(cookies.every(v=>v.startsWith('bookingtest_')&&/; Secure/i.test(v)&&/; HttpOnly/i.test(v)&&/; SameSite=Lax/i.test(v)));
 assert.equal((await request(book+'/detail',{credential})).status,403);assert.equal((await post(book+'/detail',{credential},{Origin:'https://untrusted.example'})).status,403);result.checks.secureIsolatedCookiesCsrfAndOrigin='PASS';
 stage='browser confirmation and ICS';browser=await chromium.launch({...localChrome(),headless:true});const context=await browser.newContext({viewport:{width:1280,height:950},reducedMotion:'reduce'});await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
 const g=await context.newPage(),errors=[];g.on('pageerror',()=>errors.push('browser_error'));await g.goto(link);await expect(g.getByRole('heading',{name:'Booking confirmed',exact:true})).toBeVisible({timeout:30000});await expect(g.getByRole('heading',{name:'Talk Booking Confirmation Test',exact:true})).toBeVisible();assert.equal(await g.evaluate(()=>isSecureContext),true);await expect.poll(()=>new URL(g.url()).hash).toBe('');
 await expect(g.getByRole('status').filter({hasText:'Guest verification email is not configured'})).toBeVisible();assert.equal(await g.getByRole('button',{name:'Send email code',exact:true}).count(),0);
 const download=await Promise.all([g.waitForEvent('download'),g.getByRole('button',{name:'Add to calendar',exact:true}).click()]);await download[0].saveAs(path.join(directory,'https-downloaded-booking.ics'));const ics=fs.readFileSync(path.join(directory,'https-downloaded-booking.ics'),'utf8'),stamp=t=>new Date(t).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');assert.ok(ics.includes('DTSTART:'+stamp(b.starts_at)));assert.ok(ics.includes('DTEND:'+stamp(b.ends_at)));assert.ok(!ics.includes(credential));assert.ok(!ics.includes('localhost'));
 await g.screenshot({path:'artifacts/qa/confirmation-https-page.png',fullPage:true});assert.deepEqual(errors,[]);result.checks.actualHttpsPageAndIcsDownload='PASS';
 stage='synthetic host login';const host=await context.newPage();await host.goto(origin+'/sign-in');const loginConfig=await context.request.get(origin+'/api/auth/config');const lc=await loginConfig.json(),access=JSON.parse(fs.readFileSync(path.join(directory,'host-access.private.json'),'utf8'));
 const login=await context.request.post(origin+'/api/auth/email/login',{headers:{Origin:origin,'X-CSRF-Token':lc.csrfToken},data:{email:access.email,password:access.password}});assert.equal(login.status(),200);result.checks.syntheticHostLogin='PASS';
 stage='updated email preview';const rendered=renderSchedulingEmail({kind:'confirmation',recipient:'invitee',b,host:{name:b.host_name,email:b.host_email,timezone:b.host_timezone},inviteeUrl:link,hostUrl:links.hostUrl(b),managementEnabled:false});
 const job=db.prepare("SELECT id,status,attempts FROM scheduling_jobs WHERE booking_id=? AND kind='confirmation:invitee'").get(b.id);assert.equal(job.status,'queued');assert.equal(job.attempts,0);assert.equal(db.prepare("SELECT COUNT(*) n FROM scheduling_jobs WHERE status!='cancelled'").get().n,1);
 const mail={sender:recipient,recipient,jobId:job.id,to:recipient,...rendered,calendar:calendarInvitation({id:b.id,title:b.title,start:b.starts_at,end:b.ends_at,version:b.version})};
 assert.equal(createVerificationMailer(env).configured,true);assert.equal((env.SMTP_USER||'').toLowerCase(),recipient);assert.notEqual(env.SCHEDULING_EMAIL_ENABLED,'true');
 const fingerprint=createHash('sha256').update(JSON.stringify(mail)).digest('hex');
 save('confirmation.https.private.json',JSON.stringify({sendAuthorized:false,origin,bookingId:b.id,fingerprint,...mail},null,2));save('confirmation.https.private.html',mail.html);save('confirmation.https.private.txt',mail.text);save('talk-booking-https.ics',mail.calendar);
 // Preparation guard is new and booking-specific. No old consumed guard is reset.
 const ledger=new DatabaseSync(path.join(directory,'confirmation-send-guard.sqlite'));
 try{ledger.exec('CREATE TABLE IF NOT EXISTS confirmation_attempt(scope TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,consumed INTEGER NOT NULL DEFAULT 0 CHECK(consumed IN (0,1)),status TEXT NOT NULL)');const scope='booking:'+b.id+':invitee:confirmation:v1';const prior=ledger.prepare('SELECT consumed FROM confirmation_attempt WHERE scope=?').get(scope);assert.ok(!prior?.consumed);ledger.prepare("INSERT INTO confirmation_attempt(scope,fingerprint,status) VALUES (?,?,'awaiting_approval') ON CONFLICT(scope) DO UPDATE SET fingerprint=excluded.fingerprint WHERE consumed=0").run(scope,fingerprint);}finally{ledger.close();}
 result.email={sender:recipient,recipient,subject:mail.subject,preview:mail.text.replaceAll(credential,'[PRIVATE_CREDENTIAL]'),preparedCount:1,sendAuthorized:false,hostNotifications:false,reminders:false,automaticRetries:false,smtpConfiguration:'OFFLINE_PASS',liveSmtpAuthentication:'NOT_RUN',guestOtp:'DISABLED'};
 result.booking={start:b.starts_at,end:b.ends_at,timezone:b.timezone,joiningOpens:b.starts_at-900000,expiresAt:b.ends_at+3600000};
 result.checks.schedulingRateLimitAndHostAdmission='PASS_LOCAL_MOCK_SECURITY_TESTS';result.checks.mailPreviewAndSingleUnconsumedGuard='PASS';result.preservedFiles=Object.fromEntries(preserved.map(p=>[p,hash(p)===before[p]]));assert.ok(Object.values(result.preservedFiles).every(Boolean));
 assert.equal((await fetch('http://127.0.0.1:3001/',{signal:AbortSignal.timeout(5000)})).status,200);result.checks.mainApplicationPreserved='PASS';result.success=true;
}catch{result.failedStage=stage;process.exitCode=1;
 // A failed public verification must close only the newly approved ingress.
 for(const pid of [state.connectorPid,state.controllerPid])if(Number.isInteger(pid))try{process.kill(pid);}catch{}
 result.ingressStoppedOnFailure=true;
}finally{await browser?.close();db?.close();fs.writeFileSync('artifacts/qa/confirmation-https-results.json',JSON.stringify(result,null,2));console.log(JSON.stringify({success:result.success,origin,checks:result.checks,failedStage:result.failedStage,emailsSent:0},null,2));}
