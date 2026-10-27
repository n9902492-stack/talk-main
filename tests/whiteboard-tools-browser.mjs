import assert from 'node:assert/strict';
import sharp from 'sharp';
import {expect} from '@playwright/test';
import {meetingHarness} from './helpers/live-meeting.mjs';
const h=await meetingHarness({frontendBuild:'artifacts/qa/phase10-build'});
try{
  const a=await h.member('BoardTools');await h.join(a.page,'Tool tester');const page=a.page;
  await page.getByRole('button',{name:'Whiteboard',exact:true}).click();await page.getByRole('button',{name:'Open meeting whiteboard',exact:true}).click();await expect(page.locator('.talk-whiteboard')).toHaveAttribute('data-revision','0');
  const box=await page.locator('.wb-canvas').boundingBox();await page.getByRole('button',{name:'Rectangle',exact:true}).click();await page.mouse.move(box.x+200,box.y+100);await page.mouse.down();await page.mouse.move(box.x+330,box.y+200,{steps:5});await page.mouse.up();await expect(page.locator('.talk-whiteboard')).toHaveAttribute('data-elements','1');
  await page.getByRole('button',{name:'Select',exact:true}).click();await page.mouse.click(box.x+220,box.y+200);
  const handle=await page.evaluate(()=>{const tr=window.Konva.stages[0].findOne('Transformer'),rect=tr.findOne('.bottom-right').getClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2,selected:tr.nodes().length};});assert.equal(handle.selected,1);
  await page.mouse.move(box.x+handle.x,box.y+handle.y);await page.mouse.down();await page.mouse.move(box.x+handle.x+40,box.y+handle.y+30,{steps:5});await page.mouse.up();
  const fetchState=async()=>{const r=await a.context.request.get(h.origin+'/api/auth/meetings/talk-workshop/whiteboard');return r.json();};
  await expect.poll(async()=>(await fetchState()).elements[0].width,{timeout:15000}).toBeGreaterThan(150);
  const strip=await page.locator('.wb-video-strip').boundingBox(),caption=await page.locator('.wb-video-strip .live-participant-name').boundingBox();assert.ok(caption.y+caption.height<=strip.y+strip.height+1,'participant caption stays inside the filmstrip');
  await page.getByLabel('Whiteboard image file').setInputFiles({name:'aspect.png',mimeType:'image/png',buffer:await sharp({create:{width:80,height:40,channels:4,background:'#2678b7'}}).png().toBuffer()});await expect(page.locator('.talk-whiteboard')).toHaveAttribute('data-elements','2');
  await page.getByRole('button',{name:'Select',exact:true}).click();await page.mouse.click(box.x+140,box.y+120);
  const imageHandle=await page.evaluate(()=>{const tr=window.Konva.stages[0].findOne('Transformer'),rect=tr.findOne('.bottom-right').getClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2,keepRatio:tr.keepRatio()};});assert.equal(imageHandle.keepRatio,true);
  await page.mouse.move(box.x+imageHandle.x,box.y+imageHandle.y);await page.mouse.down();await page.mouse.move(box.x+imageHandle.x+40,box.y+imageHandle.y,{steps:5});await page.mouse.up();await expect.poll(async()=>(await fetchState()).elements.find(e=>e.type==='image').width).toBeGreaterThan(90);
  const resized=(await fetchState()).elements.find(e=>e.type==='image');assert.ok(Math.abs(resized.width/resized.height-2)<.01);await page.screenshot({path:'artifacts/qa/phase10-whiteboard-filmstrip.png'});
  await page.getByLabel('Whiteboard image file').setInputFiles({name:'invalid.txt',mimeType:'text/plain',buffer:Buffer.from('Synthetic invalid upload')});
  await expect(page.getByRole('alert')).toContainText('Choose a still PNG, JPEG or WebP under 2 MB.');
  const palette=await page.locator('.wb-tools').boundingBox(),navigation=await page.locator('.wb-footer').boundingBox();
  assert.ok(navigation.y>=palette.y+palette.height,'A warning must not move the zoom controls over the tool palette');
  await page.getByRole('button',{name:'Refresh board',exact:true}).click();
  // Actual touch events, with a mobile viewport. This is browser emulation,
  // not a claim about a physical phone or stylus.
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Pen',exact:true}).click();const touch=await a.context.newCDPSession(page);await touch.send('Emulation.setTouchEmulationEnabled',{enabled:true});const mobile=await page.locator('.wb-canvas').boundingBox();
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:mobile.x+40,y:mobile.y+60}]});
  for(let i=1;i<=5;i++)await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:mobile.x+40+i*12,y:mobile.y+60+i*8}]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await expect(page.locator('.talk-whiteboard')).toHaveAttribute('data-elements','3',{timeout:15000});
  await page.screenshot({path:'artifacts/qa/phase10-whiteboard-touch.png'});assert.deepEqual(h.errors,[]);console.log('PASS: Real canvas resize handles and emulated mobile touch stroke persisted through the authenticated backend.');
}catch(error){console.error('Whiteboard focused canvas test failed.');throw error;}finally{await h.close();}
