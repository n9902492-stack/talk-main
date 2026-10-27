import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
import sharp from 'sharp';
import {expect} from '@playwright/test';
import {meetingHarness,connected,count,openPanel,panel,stats} from './helpers/live-meeting.mjs';

// These are generated test camera frames. Capture/encode/transport/decode use two
// actual Chrome processes and the local LiveKit server; no media effect is mocked.
await fs.mkdir('artifacts/qa',{recursive:true});
const checker=Buffer.alloc(640*360*3);
for(let y=0;y<360;y++)for(let x=0;x<640;x++){
  const value=(Math.floor(x/10)+Math.floor(y/10))%2?245:15;
  checker.fill(value,(y*640+x)*3,(y*640+x)*3+3);
}
const portrait=await sharp('tests/fixtures/astronaut.png').resize(360,360).png().toBuffer();
const cameraImage=path.resolve('artifacts/qa/video-effects-camera-input.png');
await sharp(checker,{raw:{width:640,height:360,channels:3}}).composite([{input:portrait,left:140,top:0}]).modulate({brightness:.55}).png().toFile(cameraImage);
const cameraFile=path.resolve('artifacts/qa/video-effects-camera.y4m');
execFileSync(ffmpeg.path,['-y','-loop','1','-i',cameraImage,'-t','2','-r','15','-pix_fmt','yuv420p',cameraFile],{stdio:'ignore',windowsHide:true});

const h=await meetingHarness({cameraFile}),evidence={};let step='startup',mainPage;
async function measure(video){return video.evaluate(element=>{
  const width=320,height=180,canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(element,0,0,width,height);const data=ctx.getImageData(0,0,width,height).data;
  let luma=0,squared=0,chroma=0,edge=0,n=0,centerLuma=0,centerN=0,backgroundLuma=0,backgroundN=0;const color=[0,0,0],sample=[];
  for(let y=6;y<174;y+=2)for(let x=6;x<314;x+=2){
    const i=(y*width+x)*4,r=data[i],g=data[i+1],b=data[i+2],light=.2126*r+.7152*g+.0722*b;
    luma+=light;squared+=light*light;chroma+=Math.abs(r-g)+Math.abs(g-b)+Math.abs(b-r);color[0]+=r;color[1]+=g;color[2]+=b;
    if(x<50){edge+=Math.abs(r-data[i+8])+Math.abs(g-data[i+9])+Math.abs(b-data[i+10]);backgroundLuma+=light;backgroundN++;}
    if(x>125&&x<195&&y>30&&y<85){centerLuma+=light;centerN++;}
    if(x%12===6&&y%12===6)sample.push(r,g,b);
    n++;
  }
  return{luma:luma/n,contrast:Math.sqrt(Math.max(0,squared/n-(luma/n)**2)),chroma:chroma/n,color:color.map(value=>value/n),edge:edge/n,centerLuma:centerLuma/centerN,backgroundLuma:backgroundLuma/backgroundN,sample,width:element.videoWidth,height:element.videoHeight};
});}
const distance=(a,b)=>Math.sqrt(a.sample.reduce((sum,value,i)=>sum+(value-b.sample[i])**2,0)/a.sample.length);
const brief=measurement=>{const{sample,...result}=measurement;return result;};
const section=(page,name)=>page.getByRole('button',{name,exact:true}).or(page.getByRole('tab',{name,exact:true}));
async function selectSection(where,name){await section(where,name).click();}
async function active(where){await expect(where.locator('[data-background-state="active"]')).toBeVisible({timeout:60000});}
async function settle(){await new Promise(resolve=>setTimeout(resolve,1000));}

try{
  const alice=await h.member('EffectsAlice'),bob=await h.member('EffectsBob',660);const a=alice.page,b=bob.page;mainPage=a;
  // Capture canvas-produced outputs as well as the existing generator hook so
  // lifecycle assertions cover both supported pipeline implementations.
  await alice.context.addInitScript(()=>{
    const capture=HTMLCanvasElement.prototype.captureStream;
    if(capture)HTMLCanvasElement.prototype.captureStream=function(...args){const stream=capture.apply(this,args);window.__talkBackgroundOutputs.push(...stream.getVideoTracks());return stream;};
  });
  step='prejoin original camera';await a.goto(h.origin+'/device-test');await a.getByLabel('Your display name').fill('Alice');
  await a.getByRole('button',{name:'Enable camera & microphone',exact:true}).click();await expect(a.getByRole('button',{name:'Turn camera off',exact:true})).toBeVisible({timeout:20000});
  const preview=a.getByLabel('Your camera preview');await expect.poll(()=>preview.evaluate(video=>video.videoWidth),{timeout:20000}).toBeGreaterThan(0);
  await expect.poll(async()=>(await measure(preview)).chroma,{timeout:20000}).toBeGreaterThan(8);
  const raw=await measure(preview);evidence.raw=brief(raw);
  await a.locator('.talk-prejoin-backgrounds > summary').click();
  step='prejoin grayscale and brightness on processed frames';await selectSection(a,'Video Filters');
  await a.getByRole('button',{name:'Black & White',exact:true}).click();await active(a);
  await expect.poll(async()=>(await measure(preview)).chroma,{timeout:30000}).toBeLessThan(raw.chroma*.3);
  const grayscale=await measure(preview);evidence.prejoinGrayscale=brief(grayscale);
  await selectSection(a,'Appearance');await a.getByLabel('Brightness',{exact:true}).fill('145');
  await expect.poll(async()=>(await measure(preview)).luma,{timeout:30000}).toBeGreaterThan(grayscale.luma+9);
  evidence.prejoinBrightness=brief(await measure(preview));
  await a.screenshot({path:'artifacts/qa/video-effects-prejoin.png',fullPage:true});
  step='real outgoing LiveKit filter transport';await a.getByRole('link',{name:'Join session',exact:true}).click();await connected(a);await h.join(b,'Bob',false);await count(a,2);await count(b,2);
  const remote=b.locator('.live-participant-tile[data-local="false"] video');await expect.poll(()=>remote.evaluate(video=>video.videoWidth),{timeout:20000}).toBeGreaterThan(0);
  await expect.poll(async()=>(await measure(remote)).chroma,{timeout:30000}).toBeLessThan(raw.chroma*.4);
  await expect.poll(async()=>(await measure(remote)).luma,{timeout:30000}).toBeGreaterThan(grayscale.luma+7);
  evidence.grayscaleAndBrightnessRemote=brief(await measure(remote));
  console.log('PASS processed prejoin grayscale/brightness and actual remote LiveKit frames.');
  await openPanel(a,'Settings');await selectSection(panel(a),'Appearance');await panel(a).getByRole('button',{name:'Reset All Effects',exact:true}).click();await settle();
  await expect.poll(async()=>(await measure(remote)).chroma,{timeout:30000}).toBeGreaterThan(raw.chroma*.7);
  const neutral=await measure(remote);evidence.neutralRemote=brief(neutral);
  const neutralFrame=async()=>{
    await expect(panel(a).locator('[data-background-state="off"]')).toBeVisible({timeout:15000});await settle();
    await expect.poll(async()=>{const current=await measure(remote);evidence.lastResetFrame=brief(current);return Math.abs(current.luma-raw.luma)<8&&current.chroma>raw.chroma*.6&&current.chroma<raw.chroma*1.2&&current.contrast<raw.contrast*1.1;},{timeout:30000}).toBe(true);
  };
  const resetAppearance=async()=>{await panel(a).getByRole('button',{name:'Reset to Default',exact:true}).click();await neutralFrame();};

  step='appearance slider pixel changes';await panel(a).getByLabel('Brightness',{exact:true}).fill('145');
  await expect.poll(async()=>(await measure(remote)).luma,{timeout:30000}).toBeGreaterThan(neutral.luma+8);evidence.brightnessRemote=brief(await measure(remote));
  await resetAppearance();await panel(a).getByLabel('Contrast',{exact:true}).fill('150');
  // A bright preceding frame also has high variance. Require the mean to stay
  // near the neutral fixture so it cannot pass on stale brightness video.
  await expect.poll(async()=>{const current=await measure(remote);return current.contrast>neutral.contrast*1.1&&current.luma<neutral.luma+10;},{timeout:30000}).toBe(true);evidence.contrastRemote=brief(await measure(remote));
  await resetAppearance();await panel(a).getByLabel('Saturation',{exact:true}).fill('0');
  await expect.poll(async()=>(await measure(remote)).chroma,{timeout:30000}).toBeLessThan(neutral.chroma*.35);evidence.saturationRemote=brief(await measure(remote));
  await resetAppearance();await panel(a).getByLabel('Warmth',{exact:true}).fill('50');await settle();const warmed=await measure(remote);
  await panel(a).getByLabel('Warmth',{exact:true}).fill('-50');
  await expect.poll(async()=>{const m=await measure(remote);return warmed.color[0]-warmed.color[2]-(m.color[0]-m.color[2]);},{timeout:30000}).toBeGreaterThan(8);evidence.warmthRemote={warm:brief(warmed),cool:brief(await measure(remote))};
  await resetAppearance();await panel(a).getByLabel('Skin smoothing',{exact:true}).fill('30');await active(panel(a));await settle();
  const smoothed=await measure(remote);assert.ok(distance(smoothed,neutral)>.2,'smoothing changes outgoing pixels');evidence.smoothingRemote=brief(smoothed);
  await resetAppearance();

  step='filter presets switch real remote frames';await selectSection(panel(a),'Video Filters');
  const filterEvidence={};
  for(const name of ['Warm','Cool','Vintage','Cinematic','Soft Glow','High Contrast','Natural']){
    await panel(a).getByRole('button',{name,exact:true}).click();await active(panel(a));await settle();const current=await measure(remote);
    assert.ok(distance(current,neutral)>.2,`${name} changes transmitted camera pixels`);filterEvidence[name]=brief(current);
  }
  assert.ok(filterEvidence.Warm.color[0]-filterEvidence.Warm.color[2]>filterEvidence.Cool.color[0]-filterEvidence.Cool.color[2]+4,'warm and cool have different transmitted color temperatures');
  evidence.filterPresets=filterEvidence;
  console.log('PASS remote appearance sliders, smoothing and all selectable filter presets.');
  await panel(a).getByRole('button',{name:'None',exact:true}).click();

  step='studio light adjustments on dim camera frames';await selectSection(panel(a),'Studio Effects');const studioEvidence={};
  for(const name of ['Automatic lighting enhancement','Low-light adjustment','Soft portrait lighting','Subtle appearance enhancement']){
    await panel(a).getByRole('button',{name:'Reset All Effects',exact:true}).click();await neutralFrame();const control=panel(a).getByLabel(name,{exact:true});await control.check();await active(panel(a));await settle();
    const current=await measure(remote);assert.ok(distance(current,neutral)>.2,`${name} changes transmitted camera pixels`);studioEvidence[name]=brief(current);
  }
  assert.ok(studioEvidence['Automatic lighting enhancement'].luma>neutral.luma+2,'automatic light enhances a dim source');
  assert.ok(studioEvidence['Low-light adjustment'].luma>neutral.luma+2,'low-light raises dim camera luminance');
  const framing=panel(a).getByLabel('Automatic camera framing',{exact:true});
  if(await framing.isEnabled()){await framing.check();await active(panel(a));studioEvidence.framing='available; enabled without affecting transport';}
  else studioEvidence.framing='browser capability unavailable; control disabled';
  evidence.studio=studioEvidence;
  console.log('PASS non-AI studio lighting on outgoing camera frames.');
  await panel(a).getByRole('button',{name:'Reset All Effects',exact:true}).click();

  step='background replacement composed with filter and appearance';await selectSection(panel(a),'Backgrounds');const choices=panel(a).getByRole('group',{name:'Background choices'});
  await choices.getByRole('button',{name:'Office',exact:true}).click();await active(panel(a));await selectSection(panel(a),'Video Filters');await panel(a).getByRole('button',{name:'Black & White',exact:true}).click();
  await expect.poll(async()=>{const current=await measure(remote);return current.chroma<neutral.chroma*.4&&current.backgroundLuma>160;},{timeout:30000}).toBe(true);evidence.officeGrayscaleRemote=brief(await measure(remote));
  await selectSection(panel(a),'Backgrounds');const custom=await sharp({create:{width:640,height:360,channels:3,background:'#ff573d'}}).png().toBuffer();
  await panel(a).getByLabel('Upload background image').setInputFiles({name:'video-effects-coral.png',mimeType:'image/png',buffer:custom});await expect(choices.getByRole('button',{name:'Custom',exact:true})).toHaveAttribute('aria-pressed','true',{timeout:30000});
  await expect.poll(async()=>{const current=await measure(remote);return current.chroma<neutral.chroma*.4&&current.backgroundLuma>100&&current.backgroundLuma<150;},{timeout:30000}).toBe(true);evidence.customGrayscaleRemote=brief(await measure(remote));
  await selectSection(panel(a),'Video Filters');await panel(a).getByRole('button',{name:'None',exact:true}).click();
  await expect.poll(async()=>{const m=await measure(remote);return m.color[0]>m.color[1]+35&&m.color[0]>m.color[2]+40;},{timeout:30000}).toBe(true);evidence.customColorRemote=brief(await measure(remote));
  await selectSection(panel(a),'Appearance');await panel(a).getByLabel('Brightness',{exact:true}).fill('120');
  await expect(panel(a).getByText(/^Processing: about/)).toBeVisible({timeout:15000});
  evidence.performanceReports=(await panel(a).innerText()).split('\n').filter(line=>/Processing:|performance|reduced|slow|frame/i.test(line));
  await a.screenshot({path:'artifacts/qa/video-effects-settings-desktop.png'});await b.screenshot({path:'artifacts/qa/video-effects-remote.png'});

  step='camera off cleanup, avatar, media resume and reaction regression';await a.getByRole('button',{name:'Turn camera off',exact:true}).click();
  const aliceTile=b.locator('.live-participant-tile[data-local="false"]');await expect(aliceTile.getByText('Camera off',{exact:true})).toBeVisible();await expect(aliceTile.locator('[data-avatar-kind]')).toBeVisible();
  await expect.poll(()=>a.evaluate(()=>window.__talkBackgroundOutputs.length>0&&window.__talkBackgroundOutputs.every(track=>track.readyState==='ended')),{timeout:20000}).toBe(true);
  await a.getByRole('button',{name:'Enable camera',exact:true}).click();await expect.poll(async()=>{const m=await measure(remote);return m.color[0]>m.color[1]+35;},{timeout:60000}).toBe(true);
  await panel(a).getByRole('button',{name:'Close meeting panel'}).click();await openPanel(a,'Reactions');await panel(a).getByRole('button',{name:'React 👍',exact:true}).click();
  await expect(aliceTile.getByRole('img',{name:'Alice tile reaction 👍',exact:true})).toBeVisible({timeout:15000});await panel(a).getByRole('button',{name:'Close meeting panel'}).click();
  await openPanel(a,'Settings');await selectSection(panel(a),'Audio & video');const camera=panel(a).getByLabel('Camera',{exact:true});
  if(await camera.locator('option').count()>1){const alternate=await camera.locator('option').evaluateAll(options=>options.find(option=>option.value&&!option.selected)?.value);if(alternate){await camera.selectOption(alternate);await expect.poll(async()=>{const m=await measure(remote);return m.color[0]>m.color[1]+35;},{timeout:60000}).toBe(true);evidence.deviceSwitch='selected available alternate generated camera';}else evidence.deviceSwitch='no alternate generated camera available; restart covered by off/on';}
  else evidence.deviceSwitch='only one generated camera available; same-device restart covered by off/on';
  await expect.poll(async()=>{const result=await stats(b);return result.frames>0&&result.audioPackets>0;},{timeout:20000}).toBe(true);evidence.remoteRtp=await stats(b);
  const startFrames=evidence.remoteRtp.frames,startTime=Date.now();await settle();const finish=await stats(b);evidence.sampleDecodedFps=(finish.frames-startFrames)*1000/(Date.now()-startTime);assert.ok(finish.frames>startFrames,'processed frames keep arriving over LiveKit');await connected(a);await connected(b);

  step='mobile layout and saved preferences';await selectSection(panel(a),'Appearance');await a.setViewportSize({width:390,height:844});await expect(panel(a)).toHaveAttribute('role','dialog');
  assert.equal(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await expect(panel(a).getByLabel('Brightness',{exact:true})).toHaveValue('120');await a.screenshot({path:'artifacts/qa/video-effects-settings-mobile.png'});
  await panel(a).getByRole('button',{name:'Close meeting panel'}).click();await a.getByRole('button',{name:'Leave Meeting',exact:true}).click();await a.waitForURL('**/device-test?room=talk-workshop');
  await expect.poll(()=>a.evaluate(()=>window.__talkBackgroundOutputs.every(track=>track.readyState==='ended')),{timeout:20000}).toBe(true);await a.locator('.talk-prejoin-backgrounds > summary').click();await selectSection(a,'Appearance');await expect(a.getByLabel('Brightness',{exact:true})).toHaveValue('120');
  await selectSection(a,'Backgrounds');await expect(a.getByRole('button',{name:'Custom',exact:true})).toHaveAttribute('aria-pressed','true');
  await selectSection(a,'Appearance');await a.getByRole('button',{name:'Reset All Effects',exact:true}).click();await expect(a.getByLabel('Brightness',{exact:true})).toHaveValue('100');await selectSection(a,'Video Filters');await expect(a.getByRole('button',{name:'None',exact:true})).toHaveAttribute('aria-pressed','true');
  assert.deepEqual(h.errors,[]);
  await fs.writeFile('artifacts/qa/video-effects-results.json',JSON.stringify({passed:true,twoChromeProcesses:true,realLiveKitRemoteFrames:true,actualProcessedPixelChecks:true,fixture:'dimmed public-domain NASA portrait plus synthetic checkerboard; generated media hardware and test identities; actual Talk API/SQLite and local LiveKit',physicalWebcamTested:false,physicalMobileTested:false,evidence},null,2));
  console.log('PASS actual outgoing LiveKit video effects: prejoin/live filters, appearance, studio lighting, composed Office/custom backgrounds, camera off/on cleanup, avatars, reaction synchronization, generated-media RTP, mobile layout and saved preferences. Generated camera fixtures; no physical device or paid service.');
}catch(error){
  if(mainPage){await mainPage.screenshot({path:'artifacts/qa/video-effects-failure.png',fullPage:true}).catch(()=>{});console.error('Video processing state:',await mainPage.locator('[data-background-state]').allTextContents());}
  console.error('FAIL video effects browser step:',step,error.message);await fs.writeFile('artifacts/qa/video-effects-results.json',JSON.stringify({passed:false,step,message:error.message,evidence},null,2));process.exitCode=1;
}finally{await h.close();}
