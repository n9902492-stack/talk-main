// Preparation only. No SMTP adapter, verification call, dispatch or send flag.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import dotenv from 'dotenv';
import {DatabaseSync} from 'node:sqlite';
import {schedulingEmailSmokeConfiguration,prepareServedSchedulingEmailSmokeTest} from '../backend/src/scheduling/email-smoke-test.mjs';
import {createEmailLinks} from '../backend/src/scheduling/email-links.mjs';
import {emailBookingSql} from '../backend/src/scheduling/email-outbox.mjs';
const recipient='niknikhil.sharma22@gmail.com',directory=path.resolve('data/booking-link-test/run-k4g1R9');
let stage='configuration';
try{
 const state=JSON.parse(fs.readFileSync('data/booking-link-test/public-tunnel.json'));
 if(!state.connected||!state.running||state.origin!=='https://latin-candle-answers-hampshire.trycloudflare.com')throw 0;
 const local=dotenv.parse(fs.readFileSync('.env.local')),test=dotenv.parse(fs.readFileSync('.env.tunnel-test.local'));
 const emails=(test.TUNNEL_TEST_EMAILS||'').split(',').map(e=>e.trim().toLowerCase());
 if(emails.length!==5||new Set(emails).size!==5||!emails.includes(recipient))throw 0;
 const configuration=schedulingEmailSmokeConfiguration({...local,SCHEDULING_PUBLIC_URL:state.origin});
 if(configuration.sender!==recipient||(local.SMTP_HOST||'smtp.gmail.com').toLowerCase()!=='smtp.gmail.com'||local.SMTP_USER!==recipient)throw 0;
 const fixture=JSON.parse(fs.readFileSync(path.join(directory,'fixture.json')));
 const raw=new DatabaseSync(path.join(directory,'talk.sqlite'),{readOnly:true});let b;
 try{b=raw.prepare(emailBookingSql).get(fixture.bookingId);}finally{raw.close();}
 const link=fs.readFileSync(path.join(directory,'invitation.private.txt'),'utf8').trim();
 const links=createEmailLinks({baseUrl:state.origin,secret:configuration.linkSecret});
 if(link!==links.inviteeUrl(b)||!links.verify(b,new URL(link).hash.slice(1),Date.now()))throw 0;
 stage='public health and signed link';
 const request=async(p,body,headers={})=>{const r=await fetch(state.origin+p,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{Origin:state.origin,'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});const data=await r.json();return {status:r.status,data};};
 const health=await request('/healthz');if(health.status!==200||!health.data.isolatedBookingTest||['email','ai','recording','sms'].some(k=>health.data[k]!==false))throw 0;
 const form=await request('/api/auth/scheduling/form');if(form.status!==200)throw 0;
 const detail=await request('/api/auth/scheduling/booking/'+fixture.bookingId+'/detail',{credential:new URL(link).hash.slice(1)},{'X-Scheduling-Token':form.data.formToken});
 if(detail.status!==200||detail.data.booking.id!==fixture.bookingId)throw 0;
 stage='private preview protection';
 const parent=fs.mkdtempSync(path.resolve('artifacts/qa/served-gmail-review-'));
 if(spawnSync('git',['check-ignore','--quiet','--',parent],{windowsHide:true}).status!==0)throw 0;
 if(process.platform==='win32'){
   const who=spawnSync('whoami',['/user','/fo','csv','/nh'],{encoding:'utf8',windowsHide:true});const sid=/S-1-5-[\d-]+/.exec(who.stdout||'')?.[0];if(who.status!==0||!sid)throw 0;
   if(spawnSync('icacls',[parent,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`],{windowsHide:true,stdio:'ignore'}).status!==0)throw 0;
 }
 stage='exact preview and single-attempt binding';
 const prepared=prepareServedSchedulingEmailSmokeTest({...configuration,databasePath:path.join(directory,'talk.sqlite'),bookingId:fixture.bookingId,recipient,outputRoot:parent,managementEnabled:false});
 const summary={...prepared.review,previewDirectory:path.relative(process.cwd(),prepared.directory),publicHealth:'PASS',signedLinkReachability:'PASS',recipientAllowlist:'PASS',smtpReadiness:'OFFLINE_CONFIGURATION_PASS_AUTHENTICATION_UNVERIFIED',guestEmailVerification:'BLOCKED_SMTP_DISABLED',managementOperations:'BLOCKED_IN_RESTRICTED_RUNTIME',normalHostAndReminderJobs:'CANCELLED',automaticRetries:0,maximumRealEmailsAfterApproval:1};
 fs.writeFileSync(path.join(prepared.directory,'final-review.json'),JSON.stringify(summary,null,2),{flag:'wx',mode:0o600});
 console.log(JSON.stringify(summary,null,2));
}catch{console.error('Preview preparation stopped at '+stage+'. No email sent; private details withheld.');process.exitCode=1;}
