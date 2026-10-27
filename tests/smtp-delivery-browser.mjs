import fs from 'node:fs';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {chromium,expect} from '@playwright/test';import {localChrome} from '../scripts/browser-options.mjs';import {schedulingHarness} from './helpers/scheduling.mjs';
const h=await schedulingHarness({frontendBuild:'artifacts/qa/smtp-reliability-build',transportEnabled:false}),report={passed:false,checks:[],externalEmails:0,browserErrors:[]};let browser;
try{
 const host=await h.account('ReliabilityUI');
 // Seed only this in-memory fixture through existing repositories/booking APIs.
 await host.request('scheduling/profile',{slug:'reliability-ui',timezone:'Asia/Kolkata',settings:{notice:0},windows:Array.from({length:7},(_,weekday)=>({weekday,start:0,end:1440}))});
 const e=(await host.request('scheduling/events',{title:'Synthetic email diagnostics',slug:'diagnostics',duration:30})).body.event;
 const c=h.client(),token=(await c.request('scheduling/form')).body.formToken;const b=await c.request('scheduling/events/'+e.id+'/book',{start:Math.ceil((h.now()+3*3600000)/900000)*900000,name:'Synthetic Guest',email:'guest@example.invalid',timezone:'Asia/Kolkata',credential:Buffer.alloc(32,1).toString('base64url'),answers:{}},{'X-Scheduling-Token':token});assert.equal(b.status,201);
 h.raw.prepare("UPDATE scheduling_jobs SET status='failed',attempts=1,delivery_outcome='UNKNOWN_AMBIGUOUS' WHERE booking_id=? AND kind='confirmation:invitee'").run(b.body.booking.id);
 const job=h.raw.prepare("SELECT id FROM scheduling_jobs WHERE booking_id=? AND kind='confirmation:invitee'").get(b.body.booking.id);
 h.raw.prepare("INSERT INTO scheduling_email_attempts(id,job_id,attempt_number,message_id,started_at,completed_at,outcome,phase,error_category,events_json) VALUES (?,?,1,?,?,?,'UNKNOWN_AMBIGUOUS','AMBIGUOUS','timeout','[]')").run(randomUUID(),job.id,'<synthetic@talk.local>',h.now(),h.now());
 browser=await chromium.launch({...localChrome(),headless:true});
 for(const [label,width,height] of [['desktop',1440,1000],['mobile',390,844]]){
  const context=await browser.newContext({viewport:{width,height}});await context.route('**/*',r=>new URL(r.request().url()).origin===h.origin?r.continue():r.abort());await context.addCookies([...host.jar].map(([name,value])=>({name,value,url:h.origin+'/api/auth',httpOnly:true,sameSite:'Lax'})));
  const page=await context.newPage();page.on('pageerror',e=>report.browserErrors.push(e.message));await page.goto(h.origin+'/bookings');const section=page.getByRole('region',{name:'Email delivery',exact:true});await expect(section).toContainText('Automatic email delivery is disabled.');await expect(section).toContainText('Acceptance unknown');await expect(section).toContainText('Automatic retries are stopped');assert.equal(await section.getByRole('button').count(),1);await section.getByRole('button',{name:'Refresh email status'}).click();await expect(section).toContainText('Acceptance unknown');await section.scrollIntoViewIfNeeded();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await section.screenshot({path:'artifacts/qa/smtp-delivery-'+label+'.png'});report.checks.push(label+' actual backend status, ambiguity warning, disabled delivery, refresh and no horizontal overflow');await context.close();
 }
 assert.deepEqual(report.browserErrors,[]);report.passed=true;console.log('PASS email delivery UI: desktop and mobile, live mock backend status, ambiguity warning, disabled delivery, refresh, no browser errors.');
}catch{console.error('FAIL email delivery browser verification. No external requests or emails sent.');process.exitCode=1;}finally{await browser?.close();await h.close();fs.writeFileSync('artifacts/qa/smtp-delivery-browser.json',JSON.stringify(report,null,2));}
