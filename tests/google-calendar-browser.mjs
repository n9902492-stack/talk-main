import fs from 'node:fs';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {chromium,expect} from '@playwright/test';
import {schedulingHarness} from './helpers/scheduling.mjs';
import {calendarConfiguration} from '../backend/src/scheduling/google-calendar/config.mjs';
import {mockGoogle} from './helpers/google-calendar.mjs';
import {secret} from '../backend/src/scheduling/service.mjs';
import {localChrome} from '../scripts/browser-options.mjs';
const config=calendarConfiguration({GOOGLE_CALENDAR_PUBLIC_URL:'http://localhost:3001',GOOGLE_CALENDAR_CLIENT_ID:'offline-ui',GOOGLE_CALENDAR_CLIENT_SECRET:'offline-ui-only',GOOGLE_CALENDAR_TOKEN_KEY:randomBytes(32).toString('base64url'),GOOGLE_CALENDAR_OAUTH_ENABLED:'true',GOOGLE_CALENDAR_SYNC_ENABLED:'true',GOOGLE_CALENDAR_READ_ENABLED:'true'}),provider=mockGoogle(config);
const h=await schedulingHarness({frontendBuild:process.env.TALK_TEST_FRONTEND_BUILD||'artifacts/qa/calendar-build',transportEnabled:false,calendar:{config,provider}}),report={passed:false,checks:[],browserErrors:[]};let browser;
try{
 const host=await h.account('CalendarUI'),slug='calendar-'+randomUUID();
 assert.equal((await host.request('scheduling/profile',{slug,timezone:'Asia/Kolkata',settings:{notice:0},windows:[0,1,2,3,4,5,6].map(weekday=>({weekday,start:0,end:1440}))})).status,200);
 const event=(await host.request('scheduling/events',{title:'Synthetic Calendar UI Meeting',slug:'ui',duration:30})).body.event;
 const form=(await host.request('scheduling/form')).body.formToken,result=await host.request('scheduling/events/'+event.id+'/book',{start:Math.ceil((h.now()+3*3600000)/900000)*900000,name:'Synthetic Guest',email:'guest@example.test',timezone:'Asia/Kolkata',credential:secret(),answers:{}},{'X-Scheduling-Token':form});assert.equal(result.status,201);
 const auth=(await host.request('scheduling/google-calendar/connect',{})).body;await host.request('scheduling/google-calendar/callback?state='+new URL(auth.authorizationUrl).searchParams.get('state')+'&code=offline-ui');
 browser=await chromium.launch({...localChrome(),headless:true});
 for(const [label,width,height] of [['desktop',1440,1000],['mobile',390,844]]){
  const context=await browser.newContext({viewport:{width,height},permissions:['clipboard-read','clipboard-write']});await context.route('**/*',r=>new URL(r.request().url()).origin===h.origin?r.continue():r.abort());
  await context.addCookies([...host.jar].map(([name,value])=>({name,value,url:h.origin+'/api/auth',httpOnly:true,sameSite:'Lax'})));
  const page=await context.newPage();page.on('pageerror',e=>report.browserErrors.push(e.message));await page.goto(h.origin+'/bookings#calendar-integration');
  await expect(page.getByRole('heading',{name:'Bookings',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Calendar Integration',exact:true})).toBeVisible();await expect(page.getByText('calendar@example.test',{exact:true})).toBeVisible();
  assert.equal(await page.getByRole('heading',{name:'Bookings',exact:true}).evaluate(e=>getComputedStyle(e).fontSize),width>640?'28px':'24px');
  await page.getByLabel('Popup reminder 1 day before').check();await page.getByRole('button',{name:'Save Calendar preferences',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Calendar preferences saved.'})).toBeVisible();
  const controls=page.locator('.calendar-booking').first();await controls.locator('summary').click();await expect(controls.getByRole('button',{name:'Add to Google Calendar',exact:true})).toBeVisible();await controls.getByRole('button',{name:'Add to Google Calendar',exact:true}).click();await expect(controls.getByRole('status')).toHaveText('Calendar sync queued.');
  await h.app.locals.scheduling.db.withContext(()=>h.app.locals.googleCalendar.worker.tick());await page.reload();await page.locator('.calendar-booking summary').first().click();await expect(page.locator('.calendar-booking').first().getByText('synced',{exact:true})).toBeVisible();
  const download=page.waitForEvent('download');await page.getByRole('link',{name:'Download ICS',exact:true}).click();const file=await download;await file.saveAs(`artifacts/qa/calendar-ui-${label}.ics`);assert.ok(fs.readFileSync(`artifacts/qa/calendar-ui-${label}.ics`,'utf8').includes('SUMMARY:Synthetic Calendar UI Meeting'));
  await page.getByRole('button',{name:'Copy Talk joining link',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Talk link copied.'})).toBeVisible();const copied=await page.evaluate(()=>navigator.clipboard.readText());assert.ok(copied.startsWith('http://localhost:3001/device-test?room='));assert.ok(!copied.includes('#'));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.locator('#calendar-integration').scrollIntoViewIfNeeded();await page.screenshot({path:`artifacts/qa/calendar-ui-${label}.png`});
  report.checks.push({viewport:label,width,pass:true,headingSize:width>640?28:24,icsDownload:true,preferences:true,copyTalkLink:true,syncStatus:true});await context.close();
 }
 assert.deepEqual(report.browserErrors,[]);assert.equal(h.outbox.length,0);assert.equal(h.codes.length,0);assert.equal(provider.calls.filter(c=>c.kind==='insert').length,1);report.passed=true;console.log('PASS Calendar UI: desktop/mobile, preference persistence, event status, ICS download and safe Talk link.');
}catch(e){report.error=e.message;process.exitCode=1;console.error('FAIL Calendar browser checks: '+e.message);}
finally{fs.writeFileSync('artifacts/qa/calendar-browser-results.json',JSON.stringify(report,null,2));await browser?.close();await h.close();}
