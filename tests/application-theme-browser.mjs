import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {localChrome} from '../scripts/browser-options.mjs';
import {schedulingHarness} from './helpers/scheduling.mjs';

// Private in-memory database, synthetic account, loopback requests only.
const h=await schedulingHarness({frontendBuild:process.env.TALK_TEST_FRONTEND_BUILD||'artifacts/qa/light-reference-build',transportEnabled:false});
const report={passed:false,routes:[],externalProviders:false};let browser,step='start';
try {
 const host=await h.account('ThemeReviewer');
 const meeting=await host.request('meetings',{title:'Synthetic typography review',approvalRequired:true});assert.equal(meeting.status,201);
 browser=await chromium.launch({...localChrome(),headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
 const context=await browser.newContext({viewport:{width:1440,height:960},reducedMotion:'reduce',permissions:['camera','microphone']});
 await context.route('**/*',r=>new URL(r.request().url()).origin===h.origin?r.continue():r.abort());
 const page=await context.newPage(),errors=[];page.on('pageerror',()=>errors.push('pageerror'));
 async function typography(route){
  await expect(page.locator('h1').first()).toBeVisible();await page.evaluate(()=>document.fonts.ready);
  const values=await page.evaluate(()=>({body:getComputedStyle(document.body).fontFamily,heading:getComputedStyle(document.querySelector('h1')).fontFamily,size:getComputedStyle(document.querySelector('h1')).fontSize,blue:getComputedStyle(document.documentElement).getPropertyValue('--talk-blue').trim(),overflow:document.documentElement.scrollWidth>innerWidth+1}));
  assert.match(values.body,/Inter/);assert.match(values.heading,/Plus Jakarta Sans/);assert.equal(values.size,'28px');assert.equal(values.blue,'#1679c4');assert.equal(values.overflow,false,route+' must fit viewport');report.routes.push({route,...values});
 }
 for(const route of ['/','/webinars','/sign-in','/sign-up','/forgot-password','/phone-sign-in']){
  step='public '+route;await page.goto(h.origin+route);await typography(route);
  if(['/','/sign-in'].includes(route))await page.screenshot({path:'artifacts/qa/unified-'+(route==='/'?'landing':'signin')+'.png'});
 }
 await context.addCookies([...host.jar].map(([name,value])=>({name,value,url:h.origin+'/api/auth',httpOnly:true,sameSite:'Lax'})));
 step='shared workspace navigation';await page.goto(h.origin+'/dashboard');await typography('/dashboard');
 const nav=page.getByRole('navigation',{name:'Workspace navigation',exact:true});
 assert.deepEqual(await nav.getByRole('link').allTextContents(),['Overview','Bookings','Meetings','Recordings','Whiteboard','Meeting History']);
 await page.getByRole('button',{name:'Collapse sidebar',exact:true}).click();
 await nav.getByRole('link',{name:'Bookings',exact:true}).click();await typography('/bookings');
 await expect(page.getByRole('button',{name:'Expand sidebar',exact:true})).toBeVisible();await expect(nav.getByRole('link',{name:'Bookings',exact:true})).toHaveAttribute('aria-current','page');
 await page.getByRole('button',{name:'Expand sidebar',exact:true}).click();
 await expect(page.getByLabel('Booking handle',{exact:true})).toBeVisible();
 assert.equal(await nav.getByRole('link',{name:'Bookings',exact:true}).evaluate(e=>getComputedStyle(e).fontSize),'14px');
 assert.ok(await page.locator('.scheduler>main').evaluate(e=>e.getBoundingClientRect().width>document.querySelector('.dashboard-main').getBoundingClientRect().width*.9),'Bookings uses the available workspace width');
 // Old open tabs can receive changed route/CSS modules before new HTML loads.
 await page.evaluate(()=>document.body.classList.remove('talk-application'));
 assert.ok(await page.locator('.scheduler>main').evaluate(e=>e.getBoundingClientRect().width>document.querySelector('.dashboard-main').getBoundingClientRect().width*.9),'Booking structure does not depend on a theme class');
 await page.evaluate(()=>document.body.classList.add('talk-application'));
 await page.screenshot({path:'artifacts/qa/unified-bookings.png'});
 await nav.getByRole('link',{name:'Meetings',exact:true}).click();await typography('/meetings');
 await expect(nav.getByRole('link',{name:'Meetings',exact:true})).toHaveAttribute('aria-current','page');
 await expect(page.locator('.meetings-hub-header')).toHaveCount(0);assert.equal(await page.getByRole('navigation',{name:'Workspace navigation',exact:true}).count(),1);
 await page.screenshot({path:'artifacts/qa/unified-meetings.png'});
 await page.goto(h.origin+'/meeting-history/'+meeting.body.meeting.id);await typography('/meeting-history/:id');
 await expect(nav.getByRole('link',{name:'Meeting History',exact:true})).toHaveAttribute('aria-current','page');
 await expect(page.locator('.skin-header')).toHaveCount(0);
 step='prejoin light theme';await page.goto(h.origin+'/device-test?room='+meeting.body.meeting.id);await typography('/device-test');
 assert.equal(await page.locator('.device-settings').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(255, 255, 255)');
 await page.screenshot({path:'artifacts/qa/unified-prejoin.png'});
 step='mobile shared navigation';await page.setViewportSize({width:390,height:844});
 for(const [link,title]of [['Overview','Welcome back, ThemeReviewer!'],['Bookings','Bookings'],['Meetings','Meetings']]){
  await page.goto(h.origin+'/dashboard');await page.getByRole('button',{name:'Open navigation',exact:true}).click();await nav.getByRole('link',{name:link,exact:true}).click();
  await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();await expect(nav).not.toBeVisible();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 }
 assert.deepEqual(errors,[]);report.passed=true;console.log('PASS: shared typography/palette across public/auth/workspace/prejoin routes, persistent navigation and mobile routing. No external provider requests.');
}catch(error){report.failedAt=step;report.error=String(error.message);process.exitCode=1;console.error('FAIL application theme at '+step+': '+error.message);}
finally{await fs.writeFile('artifacts/qa/application-theme-results.json',JSON.stringify(report,null,2));await browser?.close();await h.close();}
