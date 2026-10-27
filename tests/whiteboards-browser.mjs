import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import sharp from 'sharp';
import {expect} from '@playwright/test';
import {meetingHarness,connected,count,stats,openPanel,panel} from './helpers/live-meeting.mjs';
const h=await meetingHarness({frontendBuild:'artifacts/qa/phase10-build',lowResourceMedia:true});
const evidence={passed:false,transport:'real local LiveKit SFU; three Chrome processes; synthetic camera/microphone; fixture identity verifier; no remote physical devices'},pages=[];
const saves=[];let peakBackendRss=process.memoryUsage().rss;const began=performance.now(),cpuBegan=process.cpuUsage();
const resources=setInterval(()=>{peakBackendRss=Math.max(peakBackendRss,process.memoryUsage().rss);},1000);resources.unref();
let step='launch three browsers';
const progress=setInterval(()=>console.log('Whiteboard browser check: '+step),20000);progress.unref();
const report='artifacts/qa/phase10-whiteboard-browser.json';
async function state(member,room='talk-workshop'){const response=await member.context.request.get(`${h.origin}/api/auth/meetings/${room}/whiteboard`);assert.equal(response.status(),200);return response.json();}
async function total(page,n){await expect(page.locator('.talk-whiteboard')).toHaveAttribute('data-elements',String(n),{timeout:20000});}
async function draw(page,tool,x=100,y=100,dx=140,dy=90){await page.getByRole('button',{name:tool,exact:true}).click();const bounds=await page.locator('.wb-canvas').boundingBox();assert.ok(bounds&&bounds.height>100);await page.mouse.move(bounds.x+x,bounds.y+y);await page.mouse.down();await page.mouse.move(bounds.x+x+dx,bounds.y+y+dy,{steps:8});await page.mouse.up();}
try{
  const a=await h.member('BoardAlice',440),b=await h.member('BoardBob',660),c=await h.member('BoardCarla',880);pages.push(a.page,b.page,c.page);
  for(const page of pages)page.on('requestfinished',request=>{if(request.method()==='POST'&&request.url().endsWith('/whiteboard/operations'))saves.push(request.timing().responseEnd);});
  for(const [member,name,media] of [[a,'Alice',true],[b,'Bob',true],[c,'Carla',false]])await h.join(member.page,name,media);
  await count(a.page,3);for(const member of [a,b])await expect.poll(async()=>(await stats(member.page)).frames,{timeout:30000}).toBeGreaterThan(5);
  evidence.rtpBefore={alice:await stats(a.page),bob:await stats(b.page)};
  const audio=await a.page.locator('audio[data-audio-source="microphone"]').first().elementHandle();
  step='open board and admit editing through host UI';
  for(const member of [a,b,c])await member.page.getByRole('button',{name:'Whiteboard',exact:true}).click();
  await a.page.getByRole('button',{name:'Open meeting whiteboard',exact:true}).click();for(const member of [a,b,c])await total(member.page,0);
  await expect(b.page.getByRole('button',{name:'Pen',exact:true})).toBeDisabled();
  await a.page.getByRole('button',{name:'Whiteboard permissions and snapshots'}).click();await a.page.getByLabel('Allow participant editing by default').click();await expect(a.page.getByLabel('Allow participant editing by default')).toBeChecked({timeout:15000});await a.page.getByRole('button',{name:'Close whiteboard settings'}).click();await expect(b.page.getByRole('button',{name:'Pen',exact:true})).toBeEnabled();
  step='three people concurrently create a rectangle, sticky note and arrow';
  await Promise.all([draw(a.page,'Rectangle'),draw(c.page,'Arrow',300,180,100,80)]);
  await b.page.getByRole('button',{name:'Sticky note',exact:true}).click();const box=await b.page.locator('.wb-canvas').boundingBox();await b.page.mouse.click(box.x+270,box.y+80);await b.page.getByRole('textbox',{name:'Sticky note',exact:true}).fill('Follow up with the design team');await b.page.getByRole('button',{name:'Save text',exact:true}).click();
  for(const member of [a,b,c])await total(member.page,3);
  const snapshots=await Promise.all([a,b,c].map(member=>state(member)));assert.deepEqual(snapshots[0].elements,snapshots[1].elements);assert.deepEqual(snapshots[1].elements,snapshots[2].elements);evidence.threeEditors=true;
  step='pen, highlighter, ellipse, rounded rectangle, line and text';
  let n=3;for(const tool of ['Pen','Highlighter','Ellipse','Rounded rectangle','Line']){await draw(a.page,tool,80+(n%3)*80,200,90,50);await total(a.page,++n);}
  await a.page.getByRole('button',{name:'Text',exact:true}).click();const bounds=await a.page.locator('.wb-canvas').boundingBox();await a.page.mouse.click(bounds.x+80,bounds.y+50);await a.page.getByRole('textbox',{name:'Text',exact:true}).fill('Talk whiteboard\nSecond line');await a.page.getByRole('button',{name:'Save text',exact:true}).click();await total(a.page,++n);
  step='private image upload and cross-browser image rendering';
  await a.page.getByLabel('Whiteboard image file').setInputFiles({name:'whiteboard.png',mimeType:'image/png',buffer:await sharp({create:{width:80,height:50,channels:4,background:'#2678b7'}}).png().toBuffer()});await total(a.page,++n);await total(b.page,n);
  step='personal undo and redo preserve others';await a.page.getByRole('button',{name:'Undo my last change'}).click();await total(a.page,n-1);await a.page.getByRole('button',{name:'Redo my last change'}).click();await total(a.page,n);
  step='selection, movement, duplication, resizing and predictable object erasing';
  await a.page.getByRole('button',{name:'Select',exact:true}).click();const moveBox=await a.page.locator('.wb-canvas').boundingBox();
  let rectangle=(await state(a)).elements.find(e=>e.type==='rectangle');const originalX=rectangle.x;
  await a.page.mouse.move(moveBox.x+rectangle.x+20,moveBox.y+rectangle.y+rectangle.height);await a.page.mouse.down();await a.page.mouse.move(moveBox.x+rectangle.x+50,moveBox.y+rectangle.y+rectangle.height+25,{steps:6});await a.page.mouse.up();
  await expect.poll(async()=>(await state(a)).elements.find(e=>e.id===rectangle.id).x).toBeGreaterThan(originalX+20);
  await a.page.getByRole('button',{name:'Duplicate selected objects'}).click();await total(a.page,++n);
  let copy=(await state(a)).elements.filter(e=>e.type==='rectangle').at(-1);
  await a.page.getByRole('button',{name:'Eraser',exact:true}).click();await a.page.mouse.click(moveBox.x+copy.x,moveBox.y+copy.y+30);await total(a.page,--n);
  // Resize a fresh object in clear space; the original is overlapped by later
  // notes/strokes, which correctly take precedence in canvas hit testing.
  await draw(a.page,'Rectangle',650,90,130,100);await total(a.page,++n);
  rectangle=(await state(a)).elements.find(e=>e.type==='rectangle'&&e.x>600);await a.page.getByRole('button',{name:'Select',exact:true}).click();await a.page.mouse.click(moveBox.x+rectangle.x+20,moveBox.y+rectangle.y+rectangle.height);
  await expect.poll(()=>a.page.evaluate(()=>window.Konva.stages[0].findOne('Transformer').nodes().map(node=>node.id()))).toEqual([rectangle.id]);
  const handle=await a.page.evaluate(()=>{const rect=window.Konva.stages[0].findOne('Transformer').findOne('.bottom-right').getClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};});
  await a.page.mouse.move(moveBox.x+handle.x,moveBox.y+handle.y);await a.page.mouse.down();await a.page.mouse.move(moveBox.x+handle.x+30,moveBox.y+handle.y+30,{steps:5});await a.page.mouse.up();
  await expect.poll(async()=>(await state(a)).elements.find(e=>e.id===rectangle.id).width).toBeGreaterThan(rectangle.width+10);
  const painted=await a.page.locator('.wb-canvas canvas').first().evaluate(canvas=>{const ctx=canvas.getContext('2d'),bytes=ctx.getImageData(0,0,canvas.width,canvas.height).data;let ink=0;for(let i=0;i<bytes.length;i+=4)if(bytes[i+3]&&bytes[i+2]>bytes[i]+30)ink++;return ink;});assert.ok(painted>100);evidence.canvasInkPixels=painted;
  step='zoom, pan and fit';await a.page.getByRole('button',{name:'Zoom in',exact:true}).click();await expect(a.page.getByLabel('Whiteboard zoom')).toHaveText('120%');await a.page.getByRole('button',{name:'Fit whiteboard to screen'}).click();await a.page.getByRole('button',{name:'Reset zoom'}).click();await expect(a.page.getByLabel('Whiteboard zoom')).toHaveText('100%');
  await a.page.getByRole('button',{name:'Pan',exact:true}).click();await a.page.mouse.move(bounds.x+100,bounds.y+100);await a.page.mouse.down();await a.page.mouse.move(bounds.x+150,bounds.y+140);await a.page.mouse.up();await a.page.getByRole('button',{name:'Reset zoom'}).click();
  step='presence, video/audio mounted while board open, close and reopen';
  await b.page.mouse.move(box.x+200,box.y+180);await expect.poll(async()=>(await state(a)).cursors.length,{timeout:15000}).toBeGreaterThan(0);
  assert.equal(await audio.evaluate(element=>element.isConnected&&!!element.srcObject),true);await connected(a.page);evidence.rtpDuring=await stats(a.page);assert.ok(evidence.rtpDuring.frames>evidence.rtpBefore.alice.frames);
  await a.page.getByRole('button',{name:'Close whiteboard and return to meeting'}).click();await expect(a.page.locator('.talk-whiteboard')).toHaveCount(0);assert.equal(await audio.evaluate(element=>element.isConnected&&!!element.srcObject),true);await a.page.getByRole('button',{name:'Whiteboard',exact:true}).click();await total(a.page,n);
  step='refresh/rejoin recovers authoritative saved board';await c.page.reload();await connected(c.page);await c.page.getByRole('button',{name:'Whiteboard',exact:true}).click();await total(c.page,n);
  step='lost save acknowledgment retains exact retry without duplicate save';
  // Drop the response after the server commits. Going fully offline before
  // drawing correctly pauses the board, and cannot exercise an unsaved edit.
  const saveEndpoint='**/api/auth/meetings/talk-workshop/whiteboard/operations';
  const loseAcknowledgment=async route=>{const response=await route.fetch();assert.equal(response.status(),200);await route.abort('internetdisconnected');};
  await b.page.route(saveEndpoint,loseAcknowledgment);await draw(b.page,'Rectangle',350,80,90,60);await expect(b.page.getByRole('button',{name:'Retry save',exact:true})).toBeVisible({timeout:25000});await b.page.unroute(saveEndpoint,loseAcknowledgment);await b.page.getByRole('button',{name:'Retry save',exact:true}).click();await total(b.page,++n);await total(a.page,n);
  step='known offline state pauses drawing and recovers saved work';
  await b.context.setOffline(true);await expect(b.page.getByText('Connection interrupted. Saved work is safe. Drawing is paused until reconnected.',{exact:true})).toBeVisible({timeout:15000});await b.context.setOffline(false);await connected(b.page);await expect(b.page.getByRole('button',{name:'Pen',exact:true})).toBeEnabled({timeout:15000});await total(b.page,n);
  step='lock revokes editing in remote browser';await a.page.getByRole('button',{name:'Whiteboard permissions and snapshots'}).click();await a.page.getByRole('button',{name:'Lock editing',exact:true}).click();await expect(b.page.getByRole('button',{name:'Pen',exact:true})).toBeDisabled();await a.page.getByRole('button',{name:'Unlock editing',exact:true}).click();await a.page.getByRole('button',{name:'Close whiteboard settings'}).click();await expect(b.page.getByRole('button',{name:'Pen',exact:true})).toBeEnabled();
  step='existing chat while whiteboard stays open';await openPanel(a.page,'Chat');await panel(a.page).getByLabel('Message everyone').fill('Whiteboard transport check');await panel(a.page).getByRole('button',{name:'Send message'}).click();await openPanel(b.page,'Chat');await expect(panel(b.page).getByRole('log')).toContainText('Whiteboard transport check');await panel(a.page).getByRole('button',{name:'Close meeting panel'}).click();await panel(b.page).getByRole('button',{name:'Close meeting panel'}).click();
  step='screen sharing remains live while switching between board and presentation';
  const presentation=await a.context.newPage();await presentation.goto(h.origin+'/test-presentation');await a.page.bringToFront();await a.page.getByRole('button',{name:'Share screen',exact:true}).click();await expect(a.page.getByRole('button',{name:'Stop sharing',exact:true})).toBeVisible({timeout:30000});
  await b.page.getByRole('button',{name:'Close whiteboard and return to meeting'}).click();const remote=b.page.locator('.live-presentation-tile video');await expect.poll(()=>remote.evaluate(video=>video.videoWidth),{timeout:30000}).toBeGreaterThan(0);
  evidence.screenShare={remoteWidth:await remote.evaluate(video=>video.videoWidth)};await b.page.getByRole('button',{name:'Whiteboard',exact:true}).click();await total(b.page,n);await a.page.getByRole('button',{name:'Stop sharing',exact:true}).click();await presentation.close();
  step='mobile responsive board and touch drawing';await c.page.setViewportSize({width:390,height:844});await c.page.screenshot({path:'artifacts/qa/phase10-whiteboard-mobile.png'});assert.ok(await c.page.locator('.wb-canvas').isVisible());assert.ok(await c.page.getByRole('button',{name:'Leave Meeting',exact:true}).isVisible());
  step='room isolation and private exports';
  const other=await h.createMeeting(a.context,'Independent whiteboard',false);const csrf=(await state(a)).csrfToken;
  await a.context.request.post(`${h.origin}/api/auth/meetings/${other.id}/token`,{headers:{Origin:h.origin,'X-CSRF-Token':csrf},data:{displayName:'Alice'}});
  assert.equal((await a.context.request.post(`${h.origin}/api/auth/meetings/${other.id}/whiteboard/open`,{headers:{Origin:h.origin,'X-CSRF-Token':csrf},data:{}})).status(),200);assert.equal((await state(a,other.id)).elements.length,0);
  assert.equal((await c.context.request.get(`${h.origin}/api/auth/meetings/${other.id}/whiteboard`)).status(),404);
  const second=await a.context.newPage();await h.join(second,'Alice second room',false,other.id);await second.getByRole('button',{name:'Whiteboard',exact:true}).click();await total(second,0);await draw(second,'Ellipse');await total(second,1);await total(a.page,n);await connected(a.page);await second.getByRole('button',{name:'Leave Meeting',exact:true}).click();await second.close();evidence.twoIndependentLiveKitRooms=true;
  for(const format of ['svg','png','pdf']){const response=await a.context.request.get(`${h.origin}/api/auth/meetings/talk-workshop/whiteboard/export/${format}`,{timeout:60000});assert.equal(response.status(),200,`Export ${format}`);await fs.writeFile(`artifacts/qa/phase10-whiteboard.${format}`,await response.body());}
  await a.page.screenshot({path:'artifacts/qa/phase10-whiteboard-desktop.png'});
  step='end meeting and reopen saved board in Meeting Details';await h.api(a.context,'end');await expect(a.page.locator('.live-meeting')).toHaveAttribute('data-connection-state','ended',{timeout:20000});await a.page.goto(h.origin+'/meeting-history/talk-workshop?tab=whiteboard');await total(a.page,n);
  assert.deepEqual(h.errors,[]);evidence.passed=true;evidence.elements=n;evidence.finalRevision=(await state(a)).board.revision;evidence.pageErrors=h.errors;
  const samples=saves.filter(ms=>ms>=0).sort((a,b)=>a-b);evidence.performance={successfulSaveSamples:samples.length,saveMedianMs:samples[Math.floor(samples.length/2)],saveMaxMs:samples.at(-1),peakTestBackendRssMB:Math.round(peakBackendRss/1048576),elapsedSeconds:Math.round((performance.now()-began)/1000),backendCpuSeconds:(process.cpuUsage(cpuBegan).user+process.cpuUsage(cpuBegan).system)/1000000};
  console.log('PASS: Three-browser whiteboard collaboration, real local LiveKit RTP, tools, persistence, reconnect, permissions, chat, exports and Meeting Details.');
}catch(error){evidence.failedStep=step;console.error('Whiteboard browser check failed at: '+step);for(let i=0;i<pages.length;i++)await pages[i].screenshot({path:`artifacts/qa/phase10-whiteboard-failure-${i}.png`,timeout:5000}).catch(()=>{});throw error;}
finally{clearInterval(progress);clearInterval(resources);await fs.writeFile(report,JSON.stringify(evidence,null,2));await h.close();}
