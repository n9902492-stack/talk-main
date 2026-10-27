import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { localChrome } from '../scripts/browser-options.mjs';
import { canPublishToEmptySite, inspectSmsHosting } from '../scripts/sms-test-hosting-status.mjs';

// The real UI module runs here, but its Firebase imports are replaced at build
// time with this offline SDK. All HTTP requests are intercepted/blocked.
// No real phone, OTP, token, Firebase account, email or SMS is used.
const sdk = `
 const state=window.__smsFixture={sends:0,verifies:0,signOuts:0,auth:null,mode:'success',options:null};
 export const inMemoryPersistence={type:'NONE'};
 export const initializeApp=(config,name)=>({config,name});
 export const initializeAuth=(app,options)=>{state.options=options;return state.auth={app,settings:{},currentUser:null,useDeviceLanguage(){}}};
 export async function signOut(auth){state.signOuts++;auth.currentUser=null}
 export class RecaptchaVerifier{
  constructor(auth,id,options){this.host=document.getElementById(id);this.options=options;state.captcha=options}
  async render(){this.button=document.createElement('button');this.button.id='complete-captcha';this.button.textContent='Complete fixture captcha';this.button.onclick=()=>this.options.callback();this.host.appendChild(this.button);return 1}
  clear(){this.button?.remove()}
 }
 const fail=code=>Object.assign(new Error('sensitive fixture error payload'),{code});
 export async function signInWithPhoneNumber(auth,phone,captcha){
  state.sends++;
  if(auth.settings.appVerificationDisabledForTesting!==false)throw fail('fixture/unsafe');
  await new Promise(resolve=>setTimeout(resolve,30));
  if(state.mode==='send-failure')throw fail('auth/network-request-failed');
  if(state.mode==='quota')throw fail('auth/quota-exceeded');
  if(state.mode==='unauthorized')throw fail('auth/unauthorized-domain');
  return {async confirm(code){state.verifies++;if(state.mode==='expired')throw fail('auth/code-expired');
   if(state.mode==='wrong')throw fail('auth/invalid-verification-code');
   auth.currentUser={fixture:true};return {user:auth.currentUser}}};
 }
`;
const definitions = { 'import.meta.env.VITE_SMS_TEST_RUN_ID': '"fixture-standalone-run-20261015"' };
for (const key of ['API_KEY','AUTH_DOMAIN','PROJECT_ID','APP_ID']) definitions[`import.meta.env.VITE_FIREBASE_${key}`] = JSON.stringify(key==='PROJECT_ID'?'talk-fc3dc':'public-fixture');
const compiled = await build({ entryPoints: ['tools/firebase-sms-test/src/main.js'], bundle: true, write: false, outdir: 'artifacts/qa/virtual-sms-test', format: 'iife', define: definitions,
  plugins: [{ name:'offline-sms-sdk', setup(builder){
    builder.onResolve({filter:/^firebase\/(app|auth)$/},args=>({path:args.path,namespace:'fixture'}));
    builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:sdk}));
  } }],
});
const code = compiled.outputFiles.find(file=>file.path.endsWith('.js')).text;
const css = readFileSync('tools/firebase-sms-test/src/styles.css','utf8');
const html = readFileSync('tools/firebase-sms-test/index.html','utf8').replace('<script type="module" src="/src/main.js"></script>', '<link rel="stylesheet" href="/fixture.css"><script src="/fixture.js"></script>');
let browser; let step='hosting guard'; let passed=0;
const errors=[];
function mark(){passed++}
try {
  const empty={releasesRead:true,liveRead:true,releaseCount:0,moreReleases:false,hasLiveRelease:false};
  assert(canPublishToEmptySite(empty));
  for(const override of [{releasesRead:false},{liveRead:false},{releaseCount:1},{moreReleases:true},{hasLiveRelease:true}])assert(!canPublishToEmptySite({...empty,...override}));
  const methods=[];
  const snapshot=await inspectSmsHosting({accessToken:'private-fixture-token',fetcher:async(url,options)=>{
    methods.push(options.method);return {status:200,json:async()=>url.includes('/releases?')?{releases:[]}:{}};
  }});
  assert(snapshot.emptyLiveSiteVerified);assert(methods.every(value=>value==='GET'));assert(!JSON.stringify(snapshot).includes('private-fixture-token'));mark();
  browser=await chromium.launch({...localChrome(),headless:true});
  async function context({http=false,storageBlocked=false}={}){
    const c=await browser.newContext({viewport:{width:420,height:1100}});
    if(storageBlocked)await c.addInitScript(()=>{Storage.prototype.setItem=()=>{throw new Error('blocked')}});
    await c.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(!['https://talk-fc3dc.web.app','http://localhost:4444'].includes(url.origin)){errors.push('external-request');return route.abort()}
      if(url.pathname==='/fixture.js')return route.fulfill({contentType:'application/javascript',body:code});
      if(url.pathname==='/fixture.css')return route.fulfill({contentType:'text/css',body:css});
      return route.fulfill({contentType:'text/html',body:html});
    });
    const page=await c.newPage();page.on('pageerror',()=>errors.push('pageerror'));
    await page.goto((http?'http://localhost:4444':'https://talk-fc3dc.web.app')+'/sms-test-fixture/');
    return {c,page};
  }
  const state=page=>page.evaluate(()=>({sends:window.__smsFixture?.sends||0,verifies:window.__smsFixture?.verifies||0,signOuts:window.__smsFixture?.signOuts||0,persistence:window.__smsFixture?.options?.persistence.type,verificationDisabled:window.__smsFixture?.auth?.settings.appVerificationDisabledForTesting,user:window.__smsFixture?.auth?.currentUser}));
  async function ready(page){
    await page.locator('#phone').fill('9000000001');
    await page.locator('#consent').check();await page.locator('#complete-captcha').click();
  }
  step='HTTPS and consent/captcha guards';
  const local=await context({http:true});assert(await local.page.locator('#send').isDisabled());assert.equal((await state(local.page)).sends,0);await local.c.close();
  const blocked=await context({storageBlocked:true});assert(await blocked.page.locator('#send').isDisabled());assert.equal((await state(blocked.page)).sends,0);await blocked.c.close();
  const happy=await context();await happy.page.locator('#complete-captcha').waitFor();
  assert.equal((await state(happy.page)).persistence,'NONE');assert.equal((await state(happy.page)).verificationDisabled,false);
  await happy.page.locator('#phone').fill('9000000001');assert(await happy.page.locator('#send').isDisabled());
  await happy.page.locator('#consent').check();assert(await happy.page.locator('#send').isDisabled());
  await happy.page.locator('#complete-captcha').click();assert(await happy.page.locator('#send').isEnabled());mark();
  step='one request and successful verification';
  await happy.page.locator('#send').evaluate(button=>{button.click();button.click()});
  await happy.page.locator('#verification-section').waitFor();assert.equal((await state(happy.page)).sends,1);
  await happy.page.locator('#code').fill('908172');await happy.page.locator('#verify').click();
  await happy.page.getByRole('status').filter({hasText:'SMS code verified successfully'}).waitFor();
  assert.equal((await state(happy.page)).user,null);assert.equal((await state(happy.page)).signOuts,2);
  const saved=await happy.page.evaluate(()=>Object.entries(localStorage));assert.equal(saved.length,1);assert.equal(saved[0][1],'requested');
  await happy.page.reload();await happy.page.getByRole('status').filter({hasText:'already used'}).waitFor();assert(await happy.page.locator('#send').isDisabled());
  assert.equal((await state(happy.page)).sends,0);await happy.c.close();mark();
  step='unknown delivery, quota and domain errors cannot resend';
  for(const mode of ['send-failure','quota','unauthorized']){
    const attempt=await context();await ready(attempt.page);await attempt.page.evaluate(value=>window.__smsFixture.mode=value,mode);
    await attempt.page.locator('#send').click();await attempt.page.locator('#status[data-kind="error"]').waitFor();
    assert.equal((await state(attempt.page)).sends,1);assert(await attempt.page.locator('#send').isDisabled());
    assert(!(await attempt.page.locator('#status').innerText()).includes('sensitive fixture'));
    await attempt.page.reload();assert(await attempt.page.locator('#send').isDisabled());await attempt.c.close();
  }mark();
  step='wrong/expired OTP and attempt limits';
  for(const mode of ['wrong','expired']){
    const attempt=await context();await ready(attempt.page);await attempt.page.locator('#send').click();await attempt.page.locator('#verification-section').waitFor();
    await attempt.page.evaluate(value=>window.__smsFixture.mode=value,mode);
    const count=mode==='wrong'?5:1;
    for(let i=0;i<count;i++){
      await attempt.page.locator('#code').fill('908172');await attempt.page.locator('#verify').click();
      await attempt.page.waitForFunction(expected=>window.__smsFixture.verifies===expected,i+1);
      await attempt.page.locator('#status[data-kind="error"]').waitFor();
    }
    assert(await attempt.page.locator('#verify').isDisabled());assert.equal((await state(attempt.page)).sends,1);await attempt.c.close();
  }mark();
  step='same-browser tab lock';
  const tabs=await context();await ready(tabs.page);
  const second=await tabs.c.newPage();await second.goto('https://talk-fc3dc.web.app/sms-test-fixture/');await ready(second);
  await Promise.all([tabs.page.locator('#send').evaluate(button=>button.click()),second.locator('#send').evaluate(button=>button.click())]);
  // Cross-tab Web Lock callbacks may be throttled in a background tab. Wait
  // for the observed request rather than asserting after a wall-clock delay.
  await Promise.any([tabs.page.waitForFunction(()=>window.__smsFixture.sends===1),second.waitForFunction(()=>window.__smsFixture.sends===1)]);
  const firstTabSends=(await state(tabs.page)).sends;const secondTabSends=(await state(second)).sends;
  if(firstTabSends+secondTabSends!==1)console.error(JSON.stringify({diagnostic:'fixture-send-counts',firstTabSends,secondTabSends}));
  assert.equal(firstTabSends+secondTabSends,1);await tabs.c.close();mark();
  step='responsive blank screen';
  const visual=await context();await visual.page.locator('#complete-captcha').waitFor();mkdirSync('artifacts/qa',{recursive:true});
  for(const width of [420,390,320]){
    await visual.page.setViewportSize({width,height:1100});assert(await visual.page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
    await visual.page.screenshot({path:path.resolve(`artifacts/qa/standalone-sms-${width}.png`),fullPage:true});
  }await visual.c.close();mark();
  assert.equal(errors.length,0);
  console.log(`PASS ${passed} isolated SMS test groups: release guard, HTTPS/consent/captcha, one-request/double-click/reload/tab locks, verification/signout, delivery errors, incorrect/expired codes, attempts and responsive layout. Firebase SDK/reCAPTCHA/delivery are offline fixtures. No real SMS or deployment.`);
} catch(error){
  console.error(`FAIL standalone SMS test at ${step} (${error?.name||'Error'}). Private values withheld.`);process.exitCode=1;
} finally {await browser?.close()}
