// Offline preparation only. No SMTP transport, worker, listener or tunnel.
import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';import {DatabaseSync} from 'node:sqlite';import dotenv from 'dotenv';
import {openAuthDatabase} from '../backend/src/database.mjs';import {asyncDatabase} from '../backend/src/async-database.mjs';
import {createScheduling,secret} from '../backend/src/scheduling/service.mjs';import {createEmailLinks} from '../backend/src/scheduling/email-links.mjs';
import {emailBookingSql} from '../backend/src/scheduling/email-outbox.mjs';import {calendarInvitation} from '../backend/src/scheduling/calendar.mjs';
import {renderSchedulingEmail} from '../backend/src/scheduling/email-templates.mjs';import {deliveryMessageId} from '../backend/src/scheduling/delivery-diagnostics.mjs';
import {schedulingEmailSmokeConfiguration} from '../backend/src/scheduling/email-smoke-test.mjs';
const pointer=path.resolve('artifacts/qa/smtp-reliability-fixture.private.json'),recipient='niknikhil.sharma22@gmail.com';
const pending='[SECURE_TALK_JOIN_LINK_PENDING_PUBLIC_APPROVAL]',internalOrigin='https://pending-public-approval.invalid';
const check=ok=>{if(!ok)throw Error('Offline preparation preflight failed. Private details withheld.');};
const write=(file,value)=>fs.writeFileSync(file,value,{flag:'wx',mode:0o600});
function protect(directory){
 check(spawnSync('git',['check-ignore','--quiet','--',directory],{windowsHide:true}).status===0);
 if(process.platform!=='win32'){fs.chmodSync(directory,0o700);return;}
 const who=spawnSync('whoami',['/user','/fo','csv','/nh'],{encoding:'utf8',windowsHide:true});const self=/S-1-5-[\d-]+/.exec(who.stdout||'')?.[0];check(self);
 const ownerFile='artifacts/qa/confirmation-runtime-owner.sid';const owner=fs.existsSync(ownerFile)?fs.readFileSync(ownerFile,'utf8').trim():self;check(/^S-1-5-[\d-]+$/.test(owner));
 const grants=[...new Set([self,owner])].flatMap(sid=>['/grant:r',`*${sid}:(OI)(CI)F`]);
 check(spawnSync('icacls',[directory,'/inheritance:r',...grants],{windowsHide:true,stdio:'ignore'}).status===0);
}
let stage='configuration';
try{
 const local=dotenv.parse(fs.readFileSync('.env.local')),test=dotenv.parse(fs.readFileSync('.env.tunnel-test.local'));
 const allowlist=(test.TUNNEL_TEST_EMAILS||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
 check(allowlist.length===5&&new Set(allowlist).size===5&&allowlist.includes(recipient));
 // Configuration validation only: the verification mailer initializes lazily.
 let smtpReadiness='OFFLINE_CONFIGURATION_INCOMPLETE';
 try{const c=schedulingEmailSmokeConfiguration({...local,SCHEDULING_PUBLIC_URL:internalOrigin});check(c.sender===recipient&&local.SMTP_USER===recipient&&(local.SMTP_HOST||'smtp.gmail.com')==='smtp.gmail.com');smtpReadiness='OFFLINE_CONFIGURATION_PASS_AUTHENTICATION_NOT_ATTEMPTED';}catch{}
 const links=createEmailLinks({baseUrl:internalOrigin,secret:local.SCHEDULING_EMAIL_LINK_SECRET});
 if(fs.existsSync(pointer)){
  const previous=JSON.parse(fs.readFileSync(pointer,'utf8'));check(previous.syntheticFixture===true&&previous.publicAccess==='BLOCKED');
  console.log(JSON.stringify({...previous.review,reusedExistingFixture:true}));
 }else{
  stage='private directory';fs.mkdirSync('data/smtp-reliability-test',{recursive:true});
  const directory=fs.mkdtempSync(path.resolve('data/smtp-reliability-test/run-'));protect(directory);
  const databasePath=path.join(directory,'talk.sqlite'),raw=openAuthDatabase(databasePath),db=asyncDatabase(raw),now=Date.now(),hostId=randomUUID();let b,job;
  try{
   stage='synthetic booking';const service=createScheduling({db,now:()=>now,links,transport:null});
   await db.withContext(async()=>{
    await service.run('INSERT INTO accounts(id,name,email,email_verified,created_at) VALUES (?,?,?,1,?)',hostId,'Talk Synthetic Reliability Host',recipient,now);
    await service.saveProfile(hostId,{slug:'reliability-'+hostId,timezone:'Asia/Kolkata',settings:{notice:0,bufferAfter:0},windows:Array.from({length:7},(_,weekday)=>({weekday,start:0,end:1440}))});
    const {event}=await service.createEvent(hostId,{title:'SMTP Reliability Test',slug:'smtp-reliability',duration:30,capacity:1,questions:[]});
    const from=Math.ceil((now+3*3600000)/900000)*900000;
    const {slots}=await service.slots(event.id,{from,to:from+86400000,timezone:'Asia/Kolkata'});check(slots.length);
    const result=await service.book(event.id,{start:slots[0].start,name:'Synthetic Reliability Guest',email:recipient,timezone:'Asia/Kolkata',credential:secret(),answers:{}});
    b=await service.get(emailBookingSql,result.booking.id);check(b.starts_at-now>=2*3600000&&b.ends_at-b.starts_at===1800000);
    await service.run("UPDATE scheduling_jobs SET status='cancelled',error_code='isolated_no_delivery' WHERE kind<>'confirmation:invitee'");
    job=await service.get("SELECT * FROM scheduling_jobs WHERE booking_id=? AND kind='confirmation:invitee'",b.id);
   });
   check(raw.prepare('SELECT COUNT(*) n FROM accounts').get().n===1&&raw.prepare('SELECT COUNT(*) n FROM scheduling_bookings').get().n===1);
  }finally{raw.close();}
  stage='invitation and calendar';const privateUrl=links.inviteeUrl(b),credential=new URL(privateUrl).hash.slice(1),expiresAt=b.ends_at+3600000;
  check(links.verify(b,credential,now)&&links.verify(b,credential,b.starts_at)&&links.verify(b,credential,expiresAt)&&!links.verify(b,credential,expiresAt+1));
  check(!links.verify({...b,status:'cancelled'},credential,now)&&!links.verify({...b,id:randomUUID()},credential,now)&&!links.verify(b,'x'.repeat(43),now));
  const calendar=calendarInvitation({id:b.id,title:b.title,start:b.starts_at,end:b.ends_at,version:b.version});const stamp=n=>new Date(n).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
  check(calendar.includes('DTSTART:'+stamp(b.starts_at))&&calendar.includes('DTEND:'+stamp(b.ends_at)));
  const rendered=renderSchedulingEmail({kind:'confirmation',recipient:'invitee',b,host:{name:b.host_name,timezone:b.host_timezone},inviteeUrl:privateUrl,hostUrl:links.hostUrl(b),managementEnabled:false});
  // An inaccessible link must never masquerade as a reviewed/sendable email.
  const html=rendered.html.replace(/<a href="[^"]*"[^>]*>View booking and join<\/a>/,'<span aria-disabled="true">'+pending+'</span>');
  const text=rendered.text.replace(privateUrl,pending);
  check(!html.includes(internalOrigin)&&!text.includes(internalOrigin)&&!html.includes(credential)&&!text.includes(credential));
  const messageId=deliveryMessageId(job.id),scope='talk:phase11:smtp-reliability:'+b.id;
  const fingerprint=createHash('sha256').update(JSON.stringify({scope,subject:rendered.subject,html,text,calendar,messageId,sender:recipient,recipient})).digest('hex');
  const guardPath=path.join(directory,'send-attempt-guard.sqlite'),guard=new DatabaseSync(guardPath);
  try{guard.exec('CREATE TABLE confirmation_attempt(scope TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,consumed INTEGER NOT NULL DEFAULT 0 CHECK(consumed IN(0,1)),status TEXT NOT NULL)');guard.prepare("INSERT INTO confirmation_attempt VALUES (?,?,0,'awaiting_public_verification')").run(scope,fingerprint);}finally{guard.close();}
  write(path.join(directory,'confirmation.draft.html'),html);write(path.join(directory,'confirmation.draft.txt'),text);write(path.join(directory,'talk-booking.ics'),calendar);
  write(path.join(directory,'invitation.private.json'),JSON.stringify({bookingId:b.id,credential,originPending:true,expiresAt}));
  const review={bookingId:b.id,database:path.relative(process.cwd(),databasePath),previewDirectory:path.relative(process.cwd(),directory),preparedAt:new Date(now).toISOString(),timezone:'Asia/Kolkata',startsAt:new Date(b.starts_at).toISOString(),endsAt:new Date(b.ends_at).toISOString(),joiningOpensAt:new Date(b.starts_at-900000).toISOString(),invitationExpiresAt:new Date(expiresAt).toISOString(),sender:recipient,recipient,subject:rendered.subject,messageId,publicAccess:'BLOCKED_NEW_DATABASE_NOT_SERVED',preview:'OFFLINE_NON_SENDABLE_DRAFT_WITH_LINK_PLACEHOLDER',ics:'VERIFIED_EXACT_UTC_TIMES',smtpReadiness,guardStatus:'awaiting_public_verification',guardConsumed:false,confirmationJobs:1,hostAndReminderJobs:'CANCELLED',workersRunning:false,emailsSent:0,automaticRetries:0};
  const manifest={syntheticFixture:true,publicAccess:'BLOCKED',directory,databasePath,hostId,bookingId:b.id,meetingId:b.meeting_id,jobId:job.id,guardPath,scope,fingerprint,review};
  write(path.join(directory,'fixture.private.json'),JSON.stringify(manifest,null,2));write(pointer,JSON.stringify(manifest,null,2));
  write(path.join(directory,'review.json'),JSON.stringify(review,null,2));console.log(JSON.stringify(review,null,2));
 }
}catch{console.error('Preparation stopped at '+stage+'. No email, OTP or network service started. Private details withheld.');process.exitCode=1;}
