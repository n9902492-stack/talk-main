import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import {chromium,expect} from '@playwright/test';
import {createAuthApp} from '../backend/src/auth.mjs';
import {localChrome} from '../scripts/browser-options.mjs';

// Actual built React UI + real HTTP/authentication/SQLite. Only SMTP and the
// unrelated Google SDK are fixtures; no email, SMS or external API is used.
const app=express(),server=app.listen(0,'127.0.0.1');await once(server,'listening');
const origin=`http://127.0.0.1:${server.address().port}`,mail=[],errors=[];
const auth=createAuthApp({origins:[origin],clientId:'reset-browser.apps.googleusercontent.com',emailConfigured:true,sendVerification:async message=>{mail.push(message);}});
app.use(auth);
const build=path.resolve('artifacts/qa/phase10-build');app.use(express.static(build));app.get('*',(_req,res)=>res.sendFile(path.join(build,'index.html')));
let browser,step='launch browser';
try {
  browser=await chromium.launch({...localChrome(),headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  await context.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin===origin)return route.continue();
    if(url.href==='https://accounts.google.com/gsi/client')return route.fulfill({contentType:'text/javascript',body:'window.google={accounts:{id:{initialize(){},disableAutoSelect(){},renderButton(host){const b=document.createElement("button");b.textContent="Continue with Google";host.appendChild(b);}}}};'});
    return route.abort();
  });
  const page=await context.newPage();page.on('pageerror',()=>errors.push('Browser runtime error'));
  const email='reset-browser@example.test',password=randomBytes(24).toString('base64url'),replacement=randomBytes(24).toString('base64url');
  await page.goto(origin+'/sign-in');
  const api=(route,body,source='config')=>page.evaluate(async({route,body,source})=>{
    const context=await(await fetch('/api/auth/'+source)).json();
    const r=await fetch('/api/auth/'+route,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':context.csrfToken},body:JSON.stringify(body)});
    return r.status;
  },{route,body,source});
  step='create isolated verified account';assert.equal(await api('email/signup',{name:'Reset Browser Member',email,password}),202);
  assert.equal(await api('email/verify',{code:mail.at(-1).code},'email/verification'),200);
  await api('logout',{},'session');
  step='open Forgot password from existing sign-in';await page.reload();
  await page.getByRole('link',{name:'Forgot password?',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Forgot your password?',exact:true})).toBeVisible();
  await page.getByLabel('Email address',{exact:true}).fill(email);
  await page.getByRole('button',{name:'Send reset code',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Check your email.',exact:true})).toBeVisible();
  for(let i=0;i<100&&!mail.some(m=>m.purpose==='password-reset');i++)await new Promise(resolve=>setTimeout(resolve,100));
  const code=mail.find(m=>m.purpose==='password-reset')?.code;assert.ok(code,'Worker must deliver a reset code to the fixture');
  const first=page.getByLabel('Verification digit 1',{exact:true});
  await expect(first).toBeFocused();
  step='incorrect code error';await first.fill('999999');await page.getByRole('button',{name:'Verify code',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('incorrect');
  step='paste all six digits and verify';await first.evaluate((input,value)=>{const clipboardData=new DataTransfer();clipboardData.setData('text',value);input.dispatchEvent(new ClipboardEvent('paste',{clipboardData,bubbles:true,cancelable:true}));},code);
  await page.getByRole('button',{name:'Verify code',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Create a new password.',exact:true})).toBeVisible();
  step='refresh preserves verified browser-bound grant';await page.reload();await expect(page.getByLabel('New password',{exact:true})).toBeVisible();
  await page.getByLabel('New password',{exact:true}).fill(replacement);
  await page.getByLabel('Confirm new password',{exact:true}).fill('different password');
  await expect(page.getByRole('button',{name:'Change password',exact:true})).toBeDisabled();
  await page.getByLabel('Confirm new password',{exact:true}).fill(replacement);
  await page.getByRole('button',{name:'Change password',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Password changed.',exact:true})).toBeVisible();
  step='old password rejected and new password signs in';assert.equal(await api('email/login',{email,password}),401);
  assert.equal(await api('email/login',{email,password:replacement}),200);await api('logout',{},'session');
  await fs.mkdir('artifacts/qa/password-reset',{recursive:true});
  await page.getByRole('link',{name:'Sign in with your new password'}).click();
  await page.getByRole('link',{name:'Forgot password?',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Forgot your password?',exact:true})).toBeVisible();
  await page.screenshot({path:'artifacts/qa/password-reset/desktop.png'});
  step='mobile layout';await page.setViewportSize({width:390,height:844});
  await expect(page.getByRole('button',{name:'Send reset code',exact:true})).toBeVisible();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'Recovery form should not overflow horizontally');
  await page.screenshot({path:'artifacts/qa/password-reset/mobile.png',fullPage:true});
  assert.equal(errors.length,0);
  console.log('PASS: desktop/mobile Forgot password -> six-digit code -> new password -> sign-in; incorrect code, paste, refresh recovery and mismatched passwords. SMTP fixture only; no real email sent.');
} catch {console.error(`FAIL: password reset browser flow at ${step}. Credentials and codes withheld.`);process.exitCode=1;}
finally {await browser?.close();await auth.locals.closeAuthDatabase();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
