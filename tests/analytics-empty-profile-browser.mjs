import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {schedulingHarness} from './helpers/scheduling.mjs';
import {localChrome} from '../scripts/browser-options.mjs';
const h=await schedulingHarness({frontendBuild:process.env.TALK_TEST_FRONTEND_BUILD||'frontend/dist',transportEnabled:false});let browser;
const report={passed:false,browserErrors:[]};
try{
 const host=await h.account('AnalyticsNoSchedule');
 assert.equal((await host.request('scheduling/dashboard')).body.profile,null);
 browser=await chromium.launch({...localChrome(),headless:true});const context=await browser.newContext();await context.route('**/*',r=>new URL(r.request().url()).origin===h.origin?r.continue():r.abort());
 await context.addCookies([...host.jar].map(([name,value])=>({name,value,url:h.origin+'/api/auth',httpOnly:true,sameSite:'Lax'})));
 const page=await context.newPage(),errors=report.browserErrors;page.on('pageerror',error=>errors.push(error.message));
 await page.goto(h.origin+'/dashboard');await expect(page.getByRole('heading',{name:/Welcome back/})).toBeVisible();
 await page.getByRole('navigation',{name:'Workspace navigation'}).getByRole('link',{name:'Analytics',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Analytics',exact:true})).toBeVisible();
 await expect(page.locator('.analytics-kpis')).toHaveAttribute('aria-busy','false');
 await expect(page.locator('.analytics-kpi>strong')).toHaveText(['0','0','0','0','0','0']);
 assert.deepEqual(errors,[]);report.passed=true;console.log('PASS Analytics sidebar navigation and empty scheduling profile render without an exception.');
}catch{report.passed=false;process.exitCode=1;console.error('FAIL Analytics with no scheduling profile.');}
finally{fs.writeFileSync('artifacts/qa/analytics-empty-profile-results.json',JSON.stringify(report));await browser?.close();await h.close();}
