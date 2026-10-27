import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {expect} from '@playwright/test';
import {meetingHarness} from './helpers/live-meeting.mjs';

const h=await meetingHarness({recordings:true,frontendBuild:'artifacts/qa/phase10-build'});
try {
  const {page,context}=await h.member('PrejoinConsentLayout');
  const base=h.origin+'/api/auth/meetings/talk-workshop';
  const cfg=await(await context.request.get(base+'/recording-state')).json();
  const requested=await context.request.post(base+'/recordings/request',{headers:{Origin:h.origin,'X-CSRF-Token':cfg.csrfToken},data:{mode:'video',language:'en',retentionDays:7}});
  assert.equal(requested.status(),202);
  const results=[];
  for(const size of [{width:1440,height:900},{width:1366,height:768},{width:390,height:844}]){
    await page.setViewportSize(size);await page.goto(h.origin+'/device-test');
    const consent=page.locator('.talk-prejoin-recording');await expect(consent.getByRole('heading',{name:'This meeting requests recording'})).toBeVisible();
    assert.equal(await consent.evaluate(el=>!!el.closest('.device-settings')),true);
    const geometry=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,heading:document.querySelector('.device-heading').getBoundingClientRect().top,preview:document.querySelector('.camera-preview').getBoundingClientRect().top,joinBottom:document.querySelector('.join-row').getBoundingClientRect().bottom}));
    assert.equal(geometry.overflow,false);assert.ok(geometry.heading>=0&&geometry.preview<size.height);
    if(size.width>1000)assert.ok(geometry.joinBottom<=size.height,`Join controls must remain in desktop viewport: ${JSON.stringify(geometry)}`);
    await page.screenshot({path:`artifacts/qa/prejoin-consent-${size.width}.png`,fullPage:true});results.push({...size,...geometry});
  }
  await page.getByRole('button',{name:'I do not consent',exact:true}).click();
  await expect(page.getByText('You declined recording.',{exact:false})).toBeVisible();
  let status=await(await context.request.get(base+'/recording-state')).json();assert.equal(status.consent.decision,'declined');assert.equal(status.active.status,'awaiting_consent');
  await page.getByRole('button',{name:'I consent to recording',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Recording consent accepted',exact:true})).toBeVisible();
  status=await(await context.request.get(base+'/recording-state')).json();assert.equal(status.consent.decision,'accepted');assert.equal(status.active.status,'awaiting_consent','Consent must not start capture automatically');
  assert.deepEqual(h.errors,[]);
  await fs.writeFile('artifacts/qa/prejoin-consent-results.json',JSON.stringify({passed:true,geometry:results,explicitConsentPreserved:true},null,2));
  console.log('PASS desktop/mobile prejoin layout, explicit decline/accept, and no automatic recording.');
} finally {await h.close();}
