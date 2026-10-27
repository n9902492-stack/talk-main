// One explicitly approved message. No worker, OTP, booking mutation or retries.
import fs from 'node:fs';import path from 'node:path';import http from 'node:http';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {DatabaseSync} from 'node:sqlite';import {parse} from 'dotenv';import nodemailer from 'nodemailer';
import {schedulingTransport} from '../backend/src/scheduling/transport.mjs';
import {createVerificationMailer} from '../backend/src/mailer.mjs';
import {createEmailLinks} from '../backend/src/scheduling/email-links.mjs';
import {emailBookingSql} from '../backend/src/scheduling/email-outbox.mjs';
import {renderSchedulingEmail} from '../backend/src/scheduling/email-templates.mjs';
import {calendarInvitation} from '../backend/src/scheduling/calendar.mjs';
import {reserveConfirmationAttempt,completeConfirmationAttempt} from './confirmation-send-guard.mjs';

const directory=path.resolve('data/booking-link-test/confirmation-flow-vBfobG'),approved='niknikhil.sharma22@gmail.com',subject='Talk - Booking confirmed: Talk Booking Confirmation Test';
const approvedStart=Date.parse('2026-10-24T14:15:00+05:30'),approvedEnd=Date.parse('2026-10-24T14:45:00+05:30');
const resultFile=path.resolve('artifacts/qa/confirmation-approved-send-result.json'),ledger=path.join(directory,'confirmation-send-guard.sqlite');
const result={sendAttempted:false,realSendAttempts:0,sender:approved,recipient:approved,subject,smtpAuthentication:'NOT_ATTEMPTED',smtpAccepted:false,smtpCode:null,retries:0,otpSent:0,hostEmails:0,reminders:0,calendarCalls:0};
let stage='arguments',smtp,reserved=false,scope,runtimeEnv,originalEnv,mode=process.argv[2],origin;
async function getHealth(base,headers){
 const response=base==='http://127.0.0.1:3003'?await new Promise((resolve,reject)=>{const req=http.get(base+'/healthz',{headers,timeout:10000},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>{try{resolve({status:res.statusCode,data:JSON.parse(text)});}catch{reject(new Error('HEALTH_FAILED'));}});});req.on('error',reject);req.on('timeout',()=>req.destroy(new Error('HEALTH_TIMEOUT')));}):await fetch(base+'/healthz',{redirect:'error',signal:AbortSignal.timeout(12000)}).then(async r=>({status:r.status,data:await r.json()}));
 assert.equal(response.status,200);assert.equal(response.data.isolatedBookingTest,true);for(const k of ['email','guestOtpDelivery','ai','sms','recording'])assert.equal(response.data[k],false);return response.data;
}
try{
 assert.equal(process.argv.length,3);assert.ok(['--check','--send-approved-once'].includes(mode));
 stage='upcoming approved meeting';assert.ok(Date.now()<approvedStart);
 originalEnv=fs.readFileSync('.env.local');const env=parse(originalEnv),testEnv=parse(fs.readFileSync('.env.tunnel-test.local'));
 for(const k of ['SCHEDULING_EMAIL_ENABLED','WHITEBOARD_CLOUD_AI_ENABLED','WHITEBOARD_CLOUD_AI_OPERATOR_APPROVED'])assert.notEqual(env[k],'true');
 const emails=testEnv.TUNNEL_TEST_EMAILS.split(',').map(v=>v.trim().toLowerCase());assert.equal(emails.length,5);assert.equal(new Set(emails).size,5);assert.ok(emails.includes(approved));
 const sender=/^(?:"[^"<>]+"|[^"<>]+)\s*<([^<>]+)>$/.exec((env.SMTP_FROM||'').trim())?.[1]||(env.SMTP_FROM||'').trim();
 assert.equal(sender,approved);assert.equal(env.SMTP_USER,approved);assert.equal((env.SMTP_HOST||'smtp.gmail.com').toLowerCase(),'smtp.gmail.com');assert.equal(createVerificationMailer(env).configured,true);
 const state=JSON.parse(fs.readFileSync('data/booking-link-test/confirmation-public-tunnel.json','utf8'));origin=state.origin;
 assert.equal(origin,'https://bathroom-fully-rear-lucia.trycloudflare.com');assert.ok(state.running&&state.connected);assert.equal(path.resolve(state.database),path.join(directory,'talk.sqlite'));assert.equal(state.scheduledPublicUrl,origin);
 for(const k of ['smtp','otp','sms','recording','transcription','gemini','calendar'])assert.equal(state[k],false);
 stage='exact reviewed booking, email and attachment';
 const saved=JSON.parse(fs.readFileSync(path.join(directory,'confirmation.https.private.json'),'utf8')),raw=new DatabaseSync(path.join(directory,'talk.sqlite'),{readOnly:true});let b,job;
 try{assert.equal(raw.prepare('SELECT COUNT(*) n FROM scheduling_bookings').get().n,1);b=raw.prepare(emailBookingSql).get(saved.bookingId);assert.equal(b.status,'confirmed');assert.equal(b.title,'Talk Booking Confirmation Test');assert.equal(b.host_name,'Synthetic Talk Host');assert.equal(b.name,'Synthetic Test Invitee');assert.equal(b.email,approved);assert.equal(b.starts_at,approvedStart);assert.equal(b.ends_at,approvedEnd);assert.equal(b.version,1);
  assert.ok(raw.prepare('SELECT 1 ok FROM scheduling_invitations WHERE booking_id=? AND revoked=0 AND expires_at>?').get(b.id,Date.now()));
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM scheduling_jobs WHERE status!='cancelled'").get().n,1);job=raw.prepare("SELECT id,status,attempts FROM scheduling_jobs WHERE booking_id=? AND kind='confirmation:invitee'").get(b.id);assert.equal(job.status,'queued');assert.equal(job.attempts,0);
 }finally{raw.close();}
 const links=createEmailLinks({baseUrl:origin,secret:env.SCHEDULING_EMAIL_LINK_SECRET}),link=links.inviteeUrl(b),credential=new URL(link).hash.slice(1);
 assert.ok(links.verify(b,credential,Date.now()));assert.equal(fs.readFileSync(path.join(directory,'invitation.private.txt'),'utf8').trim(),link);assert.equal(saved.origin,origin);
 const rendered=renderSchedulingEmail({kind:'confirmation',recipient:'invitee',b,host:{name:b.host_name,email:b.host_email,timezone:b.host_timezone},inviteeUrl:link,hostUrl:links.hostUrl(b),managementEnabled:false});
 const stamp=/^DTSTAMP:(\d{8}T\d{6}Z)\r?$/m.exec(saved.calendar)?.[1];assert.ok(stamp);
 const ics=calendarInvitation({id:b.id,title:b.title,start:b.starts_at,end:b.ends_at,version:b.version}).replace(/^DTSTAMP:[^\r\n]+/m,'DTSTAMP:'+stamp);
 const reviewed={sender:approved,recipient:approved,jobId:job.id,to:approved,...rendered,calendar:ics},fingerprint=createHash('sha256').update(JSON.stringify(reviewed)).digest('hex');
 assert.equal(saved.fingerprint,fingerprint);assert.equal(saved.subject,subject);assert.equal(saved.sender,approved);assert.equal(saved.recipient,approved);for(const [key,value] of Object.entries(reviewed))assert.equal(saved[key],value);
 assert.equal(fs.readFileSync(path.join(directory,'confirmation.https.private.txt'),'utf8'),reviewed.text);assert.equal(fs.readFileSync(path.join(directory,'confirmation.https.private.html'),'utf8'),reviewed.html);assert.equal(fs.readFileSync(path.join(directory,'talk-booking-https.ics'),'utf8'),ics);
 scope='booking:'+b.id+':invitee:confirmation:v1';const guard=new DatabaseSync(ledger,{readOnly:true});try{const row=guard.prepare('SELECT * FROM confirmation_attempt WHERE scope=?').get(scope);assert.equal(row.consumed,0);assert.equal(row.status,'awaiting_approval');assert.equal(row.fingerprint,fingerprint);}finally{guard.close();}
 stage='isolated HTTPS and local health';await getHealth(origin);await getHealth('http://127.0.0.1:3003',{Host:new URL(origin).host,'X-Forwarded-Proto':'https','CF-Connecting-IP':'127.0.0.1'});
 stage='live signed-link authorization';const formResponse=await fetch(origin+'/api/auth/scheduling/form',{redirect:'error',signal:AbortSignal.timeout(12000)});assert.equal(formResponse.status,200);const form=await formResponse.json();
 const detailResponse=await fetch(origin+'/api/auth/scheduling/booking/'+b.id+'/detail',{method:'POST',redirect:'error',headers:{Origin:origin,'Content-Type':'application/json','X-Scheduling-Token':form.formToken},body:JSON.stringify({credential}),signal:AbortSignal.timeout(12000)});assert.equal(detailResponse.status,200);const detail=await detailResponse.json();assert.equal(detail.booking.id,b.id);assert.equal(detail.booking.start,approvedStart);assert.equal(detail.booking.end,approvedEnd);assert.ok(Date.now()<approvedStart);result.joiningLinkValid=true;result.exactReviewedMessageAndIcs=true;
 if(mode==='--check'){result.preflight='PASS';result.deliveryDisabledAfterward=true;console.log(JSON.stringify(result));}
 else{
  assert.equal(fs.existsSync(resultFile),false);runtimeEnv={...env,SCHEDULING_EMAIL_ENABLED:'true',SCHEDULING_PUBLIC_URL:origin};
  const adapter=schedulingTransport(runtimeEnv,{createTransport:options=>{
   assert.equal(options.requireTLS,true);assert.equal(options.tls.rejectUnauthorized,true);assert.equal(options.logger,false);assert.equal(options.debug,false);assert.equal(options.host,'smtp.gmail.com');assert.equal(options.port,587);
   smtp=nodemailer.createTransport({...options,pool:false,maxRequeues:0});const send=smtp.sendMail.bind(smtp);
   smtp.sendMail=async message=>{assert.equal(result.realSendAttempts,0);assert.equal(message.to,approved);assert.equal(message.subject,subject);assert.equal(message.text,reviewed.text);assert.equal(message.html,reviewed.html);assert.equal(message.attachments.length,1);assert.equal(message.attachments[0].content,ics);assert.ok(!message.cc&&!message.bcc);result.realSendAttempts++;result.sendAttempted=true;
    const response=await send(message);assert.deepEqual(response.accepted?.map(v=>v.toLowerCase()),[approved]);assert.equal(response.rejected?.length||0,0);assert.equal(response.pending?.length||0,0);return response;};return smtp;
  }});
  stage='durable single-attempt reservation';reserveConfirmationAttempt(ledger,scope,fingerprint);reserved=true;
  stage='Gmail SMTP authentication preflight';try{assert.equal(await smtp.verify(),true);result.smtpAuthentication='PASS';}catch(error){result.smtpAuthentication=error?.code==='EAUTH'?'FAIL':'UNVERIFIED';throw new Error('SMTP_AUTH_PREFLIGHT_FAILED');}
  stage='single authorized dispatch';assert.ok(Date.now()<approvedStart);const response=await adapter.send(reviewed);result.smtpAccepted=response.accepted===true;result.smtpCode=response.smtpCode;result.status=result.smtpAccepted?'smtp_accepted':'failed_or_acceptance_unknown';
  completeConfirmationAttempt(ledger,scope,result.status);
 }
}catch{
 result.stoppedAt=stage;result.status=result.realSendAttempts?'failed_or_acceptance_unknown':'preflight_failed_no_send';if(reserved)completeConfirmationAttempt(ledger,scope,result.status);process.exitCode=1;
}finally{
 smtp?.close();if(runtimeEnv)runtimeEnv.SCHEDULING_EMAIL_ENABLED='false';
 result.deliveryDisabledAfterward=!runtimeEnv||runtimeEnv.SCHEDULING_EMAIL_ENABLED==='false';result.normalEnvironmentUnchanged=originalEnv?fs.readFileSync('.env.local').equals(originalEnv):true;result.attemptConsumed=reserved;result.completedAt=new Date().toISOString();
 if(mode==='--send-approved-once'){
  try{await getHealth(origin);result.isolatedDeliveryDisabledConfirmed=true;}catch{result.isolatedDeliveryDisabledConfirmed=false;}
  fs.writeFileSync(resultFile,JSON.stringify(result,null,2),{mode:0o600,flag:'wx'});console.log(JSON.stringify(result));
 }
}
