// Against the explicitly isolated local runtime only. Never logs bearer URLs.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import {chromium,expect} from '@playwright/test';
import {localChrome} from '../scripts/browser-options.mjs';
const directory=path.resolve(process.argv[2]||'');
assert.ok(directory.startsWith(path.resolve('data/booking-link-test')+path.sep));
const link=readFileSync(path.join(directory,'invitation.private.txt'),'utf8').trim();
assert.equal(new URL(link).origin,'http://127.0.0.1:3003');
let browser,passed=false,stage="launch";
try{
 browser=await chromium.launch({...localChrome(),headless:true});
 const context=await browser.newContext();
 await context.route('**/*',route=>new URL(route.request().url()).origin==='http://127.0.0.1:3003'?route.continue():route.abort());
 const page=await context.newPage();
 stage="open confirmation";await page.goto(link);
 stage='confirmation heading';await expect(page.getByRole('heading',{name:'Booking confirmed'})).toBeVisible();
 stage='synthetic title';await expect(page.getByText('Synthetic OrbitMeet booking link test',{exact:true})).toBeVisible();
 stage='disabled verification notice';await expect(page.getByRole('status').filter({hasText:'Guest verification email is not configured'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Send email code',exact:true})).toHaveCount(0);
 const host=JSON.parse(readFileSync(path.join(directory,'host-access.private.json')));
 stage='sign-in page';await page.goto('http://127.0.0.1:3003/sign-in');
 stage='email field';await page.getByLabel('Email address',{exact:true}).fill(host.email);
 await page.getByLabel('Password',{exact:true}).fill(host.password);
 // Verify the existing sign-in API independently of dashboard redirects, which
 // intentionally remain blocked in this restricted test runtime.
 stage="host authentication";const result=await page.evaluate(async access=>{
   const cfg=await fetch('/api/auth/config').then(r=>r.json());
   return (await fetch('/api/auth/email/login',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':cfg.csrfToken},body:JSON.stringify(access)})).status;
 },{email:host.email,password:host.password});
 assert.equal(result,200);passed=true;
}catch{console.error('Isolated local browser verification FAIL at '+stage+'. Private details withheld.');process.exitCode=1;}
finally{await browser?.close();}
if(passed)console.log('PASS: built booking page, signed detail loading, disabled guest delivery and authenticated synthetic host. No external browser requests allowed.');
