// One already reviewed synthetic message only. No workers, OTPs or server changes.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import {schedulingEmailSmokeConfiguration,restoreServedSchedulingEmailSmokeTest,dispatchPreparedSchedulingEmailSmokeTest} from '../backend/src/scheduling/email-smoke-test.mjs';
import {schedulingTransport} from '../backend/src/scheduling/transport.mjs';

const sender='niknikhil.sharma22@gmail.com',subject='Talk - Booking confirmed: Synthetic OrbitMeet booking link test';
const origin='https://latin-candle-answers-hampshire.trycloudflare.com';
const directory=path.resolve('artifacts/qa/served-gmail-review-4WfkEc/served-preview-KM3GSb');
const start=Date.parse('2026-10-23T08:45:00Z'),end=Date.parse('2026-10-23T09:15:00Z');
const mode=process.argv[2];let stage='arguments',smtp,sendCalls=0,authentication='UNVERIFIED',smtpCode=null,result,attemptReserved=false;
const check=(condition)=>{if(!condition)throw new Error('CHECK_FAILED');};
async function health(base,headers={}) {
 if(base==='http://127.0.0.1:3003') {
  const h=await new Promise((resolve,reject)=>{
   const req=http.get(base+'/healthz',{headers},r=>{
    let body='';r.on('data',c=>{body+=c;if(body.length>8192)req.destroy(new Error('INVALID_HEALTH'));});
    r.on('end',()=>{try{check(r.statusCode===200);resolve(JSON.parse(body));}catch{reject(new Error('INVALID_HEALTH'));}});
   });
   req.setTimeout(12000,()=>req.destroy(new Error('HEALTH_TIMEOUT')));req.on('error',reject);
  });
  check(h.isolatedBookingTest===true&&['email','ai','sms','recording'].every(k=>h[k]===false));return h;
 }
 const r=await fetch(base+'/healthz',{headers,signal:AbortSignal.timeout(12000)});check(r.status===200);
 const h=await r.json();check(h.isolatedBookingTest===true&&['email','ai','sms','recording'].every(k=>h[k]===false));return h;
}
try {
 check(process.argv.length===3&&['--check','--send-approved-once'].includes(mode));
 stage='future meeting';check(Date.now()<start);
 const envBytes=fs.readFileSync('.env.local'),env=dotenv.parse(envBytes),test=dotenv.parse(fs.readFileSync('.env.tunnel-test.local'));
 const state=JSON.parse(fs.readFileSync('data/booking-link-test/public-tunnel.json','utf8'));
 stage='isolated configuration';check(state.connected&&state.running&&state.origin===origin);
 const allowed=(test.TUNNEL_TEST_EMAILS||'').split(',').map(v=>v.trim().toLowerCase());
 check(allowed.length===5&&new Set(allowed).size===5&&allowed.includes(sender));
 check((env.SMTP_HOST||'smtp.gmail.com').toLowerCase()==='smtp.gmail.com'&&env.SMTP_USER===sender);
 const config=schedulingEmailSmokeConfiguration({...env,SCHEDULING_PUBLIC_URL:origin});check(config.sender===sender);
 stage='exact approved message';
 const prepared=restoreServedSchedulingEmailSmokeTest({directory,...config,recipient:sender});
 check(prepared.review.startsAt===start&&prepared.review.endsAt===end&&prepared.review.subject===subject&&prepared.review.sender===sender&&prepared.review.recipient===sender);
 check(prepared.databasePath===path.resolve('data/booking-link-test/run-k4g1R9/talk.sqlite'));
 stage='isolated HTTPS health';await health(origin);
 stage='isolated local health';await health('http://127.0.0.1:3003',{Host:new URL(origin).host,'X-Forwarded-Proto':'https','CF-Connecting-IP':'127.0.0.1'});
 stage='signed booking verification';
 const link=fs.readFileSync(path.join(path.dirname(prepared.databasePath),'invitation.private.txt'),'utf8').trim(),url=new URL(link);
 check(url.origin===origin&&link.includes('#')&&prepared.review.joiningLink===link.replace(/#[A-Za-z0-9_-]{43}/g,'#[PRIVATE_BOOKING_CREDENTIAL]'));
 const f=await fetch(origin+'/api/auth/scheduling/form',{signal:AbortSignal.timeout(12000)});check(f.status===200);const form=await f.json();
 const fixture=JSON.parse(fs.readFileSync(path.join(path.dirname(prepared.databasePath),'fixture.json'),'utf8'));
 const response=await fetch(origin+'/api/auth/scheduling/booking/'+fixture.bookingId+'/detail',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Scheduling-Token':form.formToken},body:JSON.stringify({credential:url.hash.slice(1)}),signal:AbortSignal.timeout(12000)});
 check(response.status===200);const detail=await response.json();check(detail.booking.id===fixture.bookingId&&detail.booking.start===start&&detail.booking.end===end);
 check(Date.now()<start);
 if(mode==='--check')console.log(JSON.stringify({preflight:'PASS',exactMessageAndICS:'PASS',bookingFuture:true,joiningLinkValid:true,sendAttempted:false,attemptsConsumed:0,smtpAuthentication:'UNVERIFIED',normalEmailDeliveryEnabled:false}));
 else {
  stage='durable reservation and single dispatch';
  const transport=schedulingTransport({...env,SCHEDULING_PUBLIC_URL:origin,SCHEDULING_EMAIL_ENABLED:'true'},{createTransport:options=>{
   check(options.host==='smtp.gmail.com'&&options.port===587&&options.requireTLS===true&&options.tls.rejectUnauthorized===true&&options.logger===false&&options.debug===false);
   smtp=nodemailer.createTransport({...options,pool:false,maxRequeues:0});
   const send=smtp.sendMail.bind(smtp);smtp.sendMail=async mail=>{check(sendCalls===0);sendCalls++;try{const r=await send(mail);if(r.accepted?.includes(sender)&&!r.rejected?.length)authentication='PASS';return r;}catch(error){authentication=error?.code==='EAUTH'?'FAIL':'UNVERIFIED';throw new Error('SMTP_ATTEMPT_FAILED');}};return smtp;
  }});
  result=await dispatchPreparedSchedulingEmailSmokeTest(prepared,{approval:{approved:true,recipient:sender,fingerprint:prepared.review.requestFingerprint,joiningLinkVerified:true},configurationIdentity:config.configurationIdentity,send:async mail=>{attemptReserved=true;check(Date.now()<start);const r=await transport.send(mail);smtpCode=r.smtpCode;return r;}});
  smtp?.close();
  check(fs.readFileSync('.env.local').equals(envBytes));
  stage='post-attempt disabled health';await health(origin);
  const report={sendAttempted:sendCalls===1,realSendAttempts:sendCalls,attemptsConsumed:result.attemptsConsumed,sender,recipient:sender,subject,smtpAuthentication:authentication,smtpAccepted:result.smtpAccepted,smtpCode,status:result.status,inboxDelivery:'UNVERIFIED',normalEmailDeliveryEnabled:false,retries:0,joiningLinkValid:Date.now()<prepared.review.expiresAt,meetingFuture:Date.now()<start};
  fs.writeFileSync('artifacts/qa/phase11-approved-gmail-result.json',JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify(report));
 }
}catch{
 console.log(JSON.stringify({stoppedAt:stage,sendAttempted:sendCalls>0,realSendAttempts:sendCalls,attemptReserved,smtpAuthentication:authentication,smtpAccepted:result?.smtpAccepted??false,smtpCode,retries:0,normalEmailDeliveryEnabled:false,automaticRetry:false}));process.exitCode=1;
}finally{smtp?.close();}
