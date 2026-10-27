import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {expect} from '@playwright/test';
import {meetingHarness} from './helpers/live-meeting.mjs';

// Low-memory UI regression: real Talk session, authorization, canvas and saves.
// The separate collaboration suite exercises real local LiveKit transport.
const h=await meetingHarness({frontendBuild:process.env.TALK_TEST_FRONTEND_BUILD||'artifacts/qa/phase10-build',lowResourceMedia:true});
const report={passed:false,liveMeetingMedia:false,modelInference:false,physicalDevices:false};
let step='open authorized saved-board interface',debugPage;
try{
  const a=await h.member('WhiteboardReference'),page=a.page,base=h.origin+'/api/auth/meetings/talk-workshop';debugPage=page;
  step='authorize isolated board membership';
  const session=await(await a.context.request.get(base)).json();
  const access=await a.context.request.post(base+'/token',{headers:{Origin:h.origin,'X-CSRF-Token':session.csrfToken},data:{displayName:'Whiteboard reference'}});
  assert.equal(access.status(),200);
  step='load saved-board page';
  await page.goto(h.origin+'/meeting-history/talk-workshop?tab=whiteboard');
  step='open saved-board editor';
  await page.getByRole('button',{name:'Open meeting whiteboard',exact:true}).click();
  await expect(page.locator('.talk-whiteboard')).toHaveAttribute('data-elements','0');
  await expect(page.getByRole('complementary',{name:'Whiteboard AI Assistant'})).toBeVisible();
  await page.screenshot({path:'artifacts/qa/whiteboard-reference-final-desktop.png'});
  step='compact assistant keeps consent, preview and insertion separate';
  const assistant=page.getByRole('complementary',{name:'Whiteboard AI Assistant'});
  await expect(assistant.getByRole('button',{name:'Create editable template',exact:true})).toBeDisabled();
  await assistant.getByLabel('Canvas assistant prompt').fill('A fictional OrbitMeet SWOT layout for this local UI test.');
  await assistant.getByLabel('Use the displayed prompt or text selection for this proposal.').check();
  await assistant.getByRole('button',{name:'Create editable template',exact:true}).click();
  await expect(assistant.getByRole('img',{name:'Editable diagram proposal preview'})).toBeVisible({timeout:20000});
  await expect(page.locator('.talk-whiteboard')).toHaveAttribute('data-elements','0');
  await page.screenshot({path:'artifacts/qa/whiteboard-reference-compact-proposal.png'});
  await assistant.getByRole('button',{name:'Insert into Canvas',exact:true}).click();
  await expect.poll(()=>page.locator('.talk-whiteboard').getAttribute('data-elements')).not.toBe('0');
  await page.getByRole('button',{name:'Undo my last change'}).click();
  await expect(page.locator('.talk-whiteboard')).toHaveAttribute('data-elements','0');
  report.templateConsentPreviewInsertUndo=true;
  await page.getByRole('button',{name:'Close AI Assistant'}).click();

  step='real pointer recognition, confirmed conversion and original-ink undo';
  await page.getByLabel('Smart Drawing',{exact:true}).check();
  const box=await page.locator('.wb-canvas').boundingBox();
  await page.mouse.move(box.x+100,box.y+70);await page.mouse.down();
  for(const [x,y]of [[280,70],[280,185],[100,185],[100,70]])await page.mouse.move(box.x+x,box.y+y,{steps:1});
  await page.mouse.up();
  await expect(page.getByRole('dialog',{name:'Confirm shape recognition'})).toBeVisible({timeout:20000});
  await page.getByRole('button',{name:'Convert to rectangle',exact:true}).click();
  const firstType=async()=>(await(await a.context.request.get(base+'/whiteboard')).json()).elements[0]?.type;
  await expect.poll(firstType,{timeout:15000}).toBe('rectangle');
  await page.getByRole('button',{name:'Undo my last change'}).click();
  await expect.poll(firstType).toBe('pen');
  report.recognitionConversionUndo=true;

  step='upload validation warning keeps floating palettes separated';
  await page.getByLabel('Whiteboard image file').setInputFiles({name:'invalid.txt',mimeType:'text/plain',buffer:Buffer.from('Synthetic invalid image')});
  await expect(page.getByRole('alert')).toContainText('Choose a still PNG, JPEG or WebP under 2 MB.');
  const palette=await page.locator('.wb-tools').boundingBox(),navigation=await page.locator('.wb-footer').boundingBox();
  assert.ok(navigation.y>=palette.y+palette.height);
  await page.screenshot({path:'artifacts/qa/whiteboard-reference-final-warning.png'});
  await page.getByRole('button',{name:'Refresh board',exact:true}).click();
  report.warningGeometry=true;

  step='mobile canvas accepts actual emulated touch and persists ink';
  await page.getByLabel('Smart Drawing',{exact:true}).uncheck();
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'Pen',exact:true}).click();
  await page.locator('.wb-canvas-wrap').scrollIntoViewIfNeeded();
  const mobile=await page.locator('.wb-canvas').boundingBox();
  assert.ok(mobile.y>=0&&mobile.y+110<844);
  const touch=await a.context.newCDPSession(page);await touch.send('Emulation.setTouchEmulationEnabled',{enabled:true});
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:mobile.x+40,y:mobile.y+60}]});
  for(let i=1;i<=5;i++)await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:mobile.x+40+i*12,y:mobile.y+60+i*8}]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect(page.locator('.talk-whiteboard')).toHaveAttribute('data-elements','2',{timeout:15000});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:'artifacts/qa/whiteboard-reference-final-mobile.png'});
  assert.deepEqual(h.errors,[]);report.mobileTouch=true;report.passed=true;
  console.log('PASS Whiteboard reference UI: authorized saved-board interface, actual pointer recognition/convert/undo, warning layout and persisted emulated touch. No model inference or live meeting media in this focused check.');
}catch(error){
  report.failedAt=step;report.errorType=error?.name;report.assertion=String(error.message);report.fixtureAssistant=await debugPage?.locator('.wb-assistant').innerText().catch(()=>null);
  if(typeof error?.actual==='number')report.actual=error.actual;
  if(typeof error?.expected==='number')report.expected=error.expected;
  process.exitCode=1;console.error('FAIL Whiteboard reference UI: '+JSON.stringify(report));
}finally{
  await fs.writeFile('artifacts/qa/whiteboard-reference-results.json',JSON.stringify(report,null,2));
  await h.close();
}
