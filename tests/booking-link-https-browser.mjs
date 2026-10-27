import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {localChrome} from '../scripts/browser-options.mjs';
const state=JSON.parse(fs.readFileSync('data/booking-link-test/public-tunnel.json'));
assert.ok(state.connected&&state.running&&/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(state.origin));
const link=fs.readFileSync('data/booking-link-test/run-k4g1R9/invitation.private.txt','utf8').trim();
assert.equal(new URL(link).origin,state.origin);
let browser,stage='browser launch';const result={origin:state.origin,emailSent:false};
try{
 browser=await chromium.launch({...localChrome(),headless:true});const context=await browser.newContext();
 await context.route('**/*',r=>new URL(r.request().url()).origin===state.origin?r.continue():r.abort());
 const page=await context.newPage();stage='public confirmation';
 await page.goto(link);await expect(page.getByRole('heading',{name:'Booking confirmed',exact:true})).toBeVisible({timeout:20000});
 await expect(page.getByRole('heading',{name:'Synthetic OrbitMeet booking link test',exact:true})).toBeVisible();
 assert.equal(await page.evaluate(()=>window.isSecureContext),true);
 stage='disabled verification notice';await expect(page.getByRole('status').filter({hasText:'Guest verification email is not configured'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Send email code',exact:true})).toHaveCount(0);
 result.securePageAndSignedDetail='PASS';result.smtpDisabledNotice='PASS';result.success=true;
}catch{result.success=false;result.failedStage=stage;process.exitCode=1;}
finally{await browser?.close();}
fs.writeFileSync('artifacts/qa/booking-https-browser.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
