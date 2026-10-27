import assert from 'node:assert/strict';import fs from 'node:fs/promises';import {expect} from '@playwright/test';
import {meetingHarness,count,openPanel} from './helpers/live-meeting.mjs';import {cloudFixture} from './helpers/cloud-fixture.mjs';
import {localSfu} from './helpers/local-sfu.mjs';
const sfu=await localSfu(),f=cloudFixture(),gate={enabled:false},h=await meetingHarness({livekitConfig:sfu.config,frontendBuild:'artifacts/qa/phase10-build',lowResourceMedia:true,whiteboardIntelligence:{cloudProvider:f.provider,cloudExecutionGate:()=>gate.enabled}});
const evidence={passed:false,provider:'Injected in-process mock only; no cloud AI connection or inference',livekit:'Real local SFU with synthetic camera/audio'};let a,b,step='launch';
const progress=setInterval(()=>console.log('Cloud UI check: '+step),30000);
try{
  a=await h.member('CloudMockAlice');b=await h.member('CloudMockBob');await h.join(a.page,'CloudMockAlice',true);await h.join(b.page,'CloudMockBob',true);await count(a.page,2);
  step='existing whiteboard and external approval UI';await a.page.getByRole('button',{name:'Whiteboard',exact:true}).click();await a.page.getByRole('button',{name:'Open meeting whiteboard',exact:true}).click();await openPanel(a.page,'AI Assistant');
  const assistant=a.page.getByRole('complementary',{name:'Whiteboard AI Assistant'}),cloud=assistant.getByRole('region',{name:'Cloud AI privacy controls'});
  await assistant.locator('.wb-provider-options > summary').click();
  await assistant.getByLabel('Canvas assistant prompt').fill('Synthetic diagram for mock testing');await cloud.getByText('Cloud AI request and privacy',{exact:true}).click();await cloud.getByRole('button',{name:'Review external data request'}).click();
  const approval=cloud.getByRole('region',{name:'External AI data approval'});await expect(approval).toBeVisible();assert.equal(f.calls.length,0);await expect(approval).toContainText('llm.example.com');await expect(approval).toContainText('Unknown');await expect(approval).toContainText('Excluded');
  await expect(approval.getByRole('button',{name:'Confirm external processing'})).toBeDisabled();gate.enabled=true;
  step='payload change invalidates consent';await assistant.getByLabel('Canvas assistant prompt').fill('Changed synthetic diagram');await expect(approval).toHaveCount(0);await cloud.getByRole('button',{name:'Review external data request'}).click();await expect(approval).toBeVisible();await approval.getByRole('button',{name:'Cancel',exact:true}).click();await expect(approval).toHaveCount(0);assert.equal(f.calls.length,0);
  step='mock confirmation creates review-only proposal';await cloud.getByRole('button',{name:'Review external data request'}).click();await approval.getByRole('button',{name:'Confirm external processing'}).click();await expect(assistant.getByRole('img',{name:'Editable diagram proposal preview'})).toBeVisible({timeout:15000});assert.equal(f.calls.length,1);await expect(a.page.locator('.talk-whiteboard')).toHaveAttribute('data-elements','0');
  await assistant.getByRole('button',{name:'Insert into Canvas',exact:true}).click();await expect(a.page.locator('.talk-whiteboard')).toHaveAttribute('data-elements','6');
  await b.page.getByRole('button',{name:'Whiteboard',exact:true}).click();await expect(b.page.locator('.talk-whiteboard')).toHaveAttribute('data-elements','6');
  step='undo synchronizes through existing collaboration';await a.page.getByRole('button',{name:'Undo my last change'}).click();await expect(b.page.locator('.talk-whiteboard')).toHaveAttribute('data-elements','0');
  await a.page.screenshot({path:'artifacts/qa/phase10i-cloud-desktop.png'});await a.page.setViewportSize({width:390,height:844});assert.ok(await a.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await a.page.screenshot({path:'artifacts/qa/phase10i-cloud-mobile.png'});
  assert.deepEqual(h.errors,[]);evidence.passed=true;console.log('PASS: real Chrome consent, change invalidation/cancel, mock-only job preview, native apply/remote sync/undo and mobile layout.');
}catch{evidence.failedStep=step;if(a)await a.page.screenshot({path:'artifacts/qa/phase10i-cloud-failure.png'}).catch(()=>{});console.error('Cloud mock browser test failed at: '+step+'. Raw request details withheld.');process.exitCode=1;}
finally{clearInterval(progress);await fs.writeFile('artifacts/qa/phase10i-cloud-browser.json',JSON.stringify(evidence,null,2));await h.close();await sfu.stop();}
