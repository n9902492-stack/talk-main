import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
import sharp from 'sharp';
import {expect} from '@playwright/test';
import {meetingHarness,connected,count,openPanel,panel,stats} from './helpers/live-meeting.mjs';

await fs.mkdir('artifacts/qa',{recursive:true});
const pixels=Buffer.alloc(640*360*3);
for(let y=0;y<360;y++)for(let x=0;x<640;x++){const value=(Math.floor(x/10)+Math.floor(y/10))%2?245:15;pixels.fill(value,(y*640+x)*3,(y*640+x)*3+3);}
const portrait=await sharp('tests/fixtures/astronaut.png').resize(360,360).png().toBuffer();
const image=path.resolve('artifacts/qa/background-camera-input.png');
await sharp(pixels,{raw:{width:640,height:360,channels:3}}).composite([{input:portrait,left:140,top:0}]).png().toFile(image);
const cameraFile=path.resolve('artifacts/qa/background-camera.y4m');
execFileSync(ffmpeg.path,['-y','-loop','1','-i',image,'-t','2','-r','15','-pix_fmt','yuv420p',cameraFile],{stdio:'ignore',windowsHide:true});
const h=await meetingHarness({cameraFile});let step='startup',mainPage;const evidence={};
async function measure(video){return video.evaluate(element=>{
  const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const ctx=canvas.getContext('2d');ctx.drawImage(element,0,0,640,360);const p=ctx.getImageData(0,0,640,360).data;
  let energy=0,n=0;const color=[0,0,0],face=[0,0,0];
  for(let y=30;y<300;y+=2)for(let x=20;x<110;x+=2){const i=(y*640+x)*4;energy+=Math.abs(p[i]-p[i+8])+Math.abs(p[i+1]-p[i+9])+Math.abs(p[i+2]-p[i+10]);for(let c=0;c<3;c++)color[c]+=p[i+c];n++;}
  let f=0;for(let y=70;y<140;y+=2)for(let x=260;x<330;x+=2){const i=(y*640+x)*4;for(let c=0;c<3;c++)face[c]+=p[i+c];f++;}
  return{energy:energy/n,color:color.map(v=>v/n),face:face.map(v=>v/f),width:element.videoWidth};
});}
try{
 const alice=await h.member('BackgroundAlice'),bob=await h.member('BackgroundBob',660);const a=alice.page,b=bob.page;mainPage=a;
 a.on('console',message=>{if(message.type()==='error')console.log('Camera processor console error:',message.text().slice(0,200));});
 step='prejoin camera';await a.goto(h.origin+'/device-test');await a.getByLabel('Your display name').fill('Alice');await a.getByRole('button',{name:'Enable camera & microphone',exact:true}).click();await expect(a.getByRole('button',{name:'Turn camera off',exact:true})).toBeVisible({timeout:20000});
 const preview=a.getByLabel('Your camera preview');await expect.poll(()=>preview.evaluate(v=>v.videoWidth),{timeout:15000}).toBeGreaterThan(0);await expect.poll(async()=>(await measure(preview)).energy,{timeout:15000}).toBeGreaterThan(10);const raw=await measure(preview);evidence.raw=raw;
 await a.locator('.talk-prejoin-backgrounds > summary').click();const choices=a.getByRole('group',{name:'Background choices'});
 step='real prejoin background blur';await expect(choices.getByRole('button',{name:'Blur',exact:true})).toBeEnabled({timeout:20000});await choices.getByRole('button',{name:'Blur',exact:true}).click();
 await expect(a.locator('[data-background-state="active"]')).toBeVisible({timeout:60000});
 await expect.poll(async()=>(await measure(preview)).energy,{timeout:30000}).toBeLessThan(raw.energy*.65);evidence.blurredPreview=await measure(preview);
 await a.getByLabel('Blur strength', {exact:true}).fill('24');await expect(a.getByLabel('Blur strength',{exact:true})).toHaveValue('24');
 step='prejoin office selection';await choices.getByRole('button',{name:'Office',exact:true}).click();await expect(a.locator('[data-background-state="active"]')).toBeVisible({timeout:60000});
 await a.screenshot({path:'artifacts/qa/background-prejoin.png',fullPage:true});
 step='processed outgoing camera across LiveKit';await a.getByRole('link',{name:'Join session',exact:true}).click();await connected(a);await h.join(b,'Bob',false);await count(a,2);await count(b,2);
 const remote=b.locator('.live-participant-tile[data-local="false"] video');await expect.poll(()=>remote.evaluate(v=>v.videoWidth),{timeout:20000}).toBeGreaterThan(0);
 await expect.poll(async()=>(await measure(remote)).energy,{timeout:30000}).toBeLessThan(raw.energy*.65);evidence.officeRemote=await measure(remote);
 await expect.poll(async()=>{const m=await measure(remote);return m.color[0]>160&&m.color[1]>180&&m.color[2]>m.color[0]+10;},{timeout:30000}).toBe(true);
 step='in-meeting blur and remote person preservation';await openPanel(a,'Settings');await panel(a).getByRole('button',{name:'Backgrounds',exact:true}).click();const picker=panel(a).getByRole('group',{name:'Background choices'});
 await picker.getByRole('button',{name:'Blur',exact:true}).click();await expect.poll(async()=>(await measure(remote)).energy,{timeout:30000}).toBeLessThan(raw.energy*.65);evidence.blurRemote=await measure(remote);
 assert.ok(evidence.blurRemote.face.every((v,i)=>Math.abs(v-raw.face[i])<35),'person foreground remains visible');
 step='nature and custom background transport';await picker.getByRole('button',{name:'Nature',exact:true}).click();await expect(panel(a).locator('[data-background-state="active"]')).toBeVisible({timeout:30000});
 await expect.poll(async()=>{const m=await measure(remote);return m.color[1]>m.color[0]+10&&m.color[1]>m.color[2];},{timeout:30000}).toBe(true);evidence.natureRemote=await measure(remote);
 const custom=await sharp({create:{width:640,height:360,channels:3,background:'#ff573d'}}).png().toBuffer();
 await panel(a).getByLabel('Upload background image').setInputFiles({name:'coral.png',mimeType:'image/png',buffer:custom});
 await expect(picker.getByRole('button',{name:'Custom',exact:true})).toHaveAttribute('aria-pressed','true',{timeout:30000});
 await expect.poll(async()=>{const m=await measure(remote);return m.color[0]>200&&m.color[1]<130&&m.color[2]<120;},{timeout:30000}).toBe(true);evidence.customRemote=await measure(remote);
 await a.screenshot({path:'artifacts/qa/background-settings-desktop.png'});await b.screenshot({path:'artifacts/qa/background-remote.png'});
 step='none restores original camera';await picker.getByRole('button',{name:'None',exact:true}).click();await expect.poll(async()=>(await measure(remote)).energy,{timeout:30000}).toBeGreaterThan(raw.energy*.65);
 step='camera off resources and restoring effect';await picker.getByRole('button',{name:'Custom',exact:true}).click();await expect.poll(async()=>(await measure(remote)).color[0],{timeout:30000}).toBeGreaterThan(200);await a.getByRole('button',{name:'Turn camera off',exact:true}).click();await expect(b.locator('.live-participant-tile[data-local="false"]').getByText('Camera off',{exact:true})).toBeVisible();
 await expect.poll(()=>a.evaluate(()=>window.__talkBackgroundOutputs.length>0&&window.__talkBackgroundOutputs.every(track=>track.readyState==='ended')),{timeout:15000}).toBe(true);
 await a.getByRole('button',{name:'Enable camera',exact:true}).click();await expect.poll(async()=>(await measure(remote)).color[0],{timeout:40000}).toBeGreaterThan(200);
 evidence.bobRtp=await stats(b);assert.ok(evidence.bobRtp.frames>0&&evidence.bobRtp.audioPackets>0);
 step='mobile and preference persistence';await a.setViewportSize({width:390,height:844});await expect(panel(a)).toHaveAttribute('role','dialog');assert.equal(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await a.screenshot({path:'artifacts/qa/background-settings-mobile.png'});
 await panel(a).getByRole('button',{name:'Close meeting panel'}).click();await a.getByRole('button',{name:'Leave Meeting',exact:true}).click();await a.waitForURL('**/device-test?room=talk-workshop');
 await expect.poll(()=>a.evaluate(()=>window.__talkBackgroundOutputs.every(track=>track.readyState==='ended')),{timeout:15000}).toBe(true);
 await a.locator('.talk-prejoin-backgrounds > summary').click();await expect(a.getByRole('button',{name:'Custom',exact:true})).toHaveAttribute('aria-pressed','true');
 step='unsupported-device fallback';const unsupported=await h.member('UnsupportedEffects',880);await unsupported.context.addInitScript(()=>Object.defineProperty(window,'OffscreenCanvas',{value:undefined}));
 await unsupported.page.goto(h.origin+'/device-test');await unsupported.page.locator('.talk-prejoin-backgrounds > summary').click();await expect(unsupported.page.getByRole('button',{name:'Blur',exact:true})).toBeDisabled();await expect(unsupported.page.getByRole('button',{name:'None',exact:true})).toBeEnabled();
 await unsupported.page.getByRole('button',{name:'Enable camera & microphone',exact:true}).click();await expect(unsupported.page.getByRole('button',{name:'Turn camera off',exact:true})).toBeVisible({timeout:20000});
 assert.deepEqual(h.errors,[]);
 await fs.writeFile('artifacts/qa/background-effects-results.json',JSON.stringify({passed:true,realSegmentation:true,twoChromeProcesses:true,realLiveKitRemoteFrames:true,fixture:'public-domain NASA portrait and synthetic checkerboard camera; real Talk API/SQLite; provider identities and media hardware are fixtures',evidence},null,2));
 console.log('PASS real segmentation on camera frames: prejoin blur/office, remote LiveKit blur/nature/custom, None restore, camera off/on, mobile, persisted preference. Generated camera input and test identities, not physical webcam hardware.');
}catch(error){if(mainPage){await mainPage.screenshot({path:'artifacts/qa/background-failure.png',fullPage:true}).catch(()=>{});console.error('Background states:',await mainPage.locator('[data-background-state]').allTextContents());}console.error('FAIL background browser step:',step,error.message);await fs.writeFile('artifacts/qa/background-effects-results.json',JSON.stringify({passed:false,step,message:error.message},null,2));process.exitCode=1;}
finally{await h.close();}
