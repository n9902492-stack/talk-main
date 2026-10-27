import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
import {expect} from '@playwright/test';
import {meetingHarness,connected,openPanel,panel} from './helpers/live-meeting.mjs';
await fs.mkdir('artifacts/qa',{recursive:true});
const speechFile=path.resolve('artifacts/qa/recording-speech-48k.wav');
execFileSync(ffmpeg.path,['-y','-i','artifacts/qa/jfk-transcription-fixture.wav','-ar','48000','-ac','1',speechFile],{stdio:'ignore',windowsHide:true});
// Distinct camera inputs prove both remote publications reach the recording,
// rather than accepting a single nonblank tile as proof of two-user capture.
const cameraFiles={};
for(const [name,color] of [['RecordingAlice','red'],['RecordingBob','blue']]){
  const file=path.resolve(`artifacts/qa/${name}-recording-camera.y4m`);
  execFileSync(ffmpeg.path,['-y','-f','lavfi','-i',`color=c=${color}:size=640x360:rate=15`,'-t','4','-pix_fmt','yuv420p',file],{stdio:'ignore',windowsHide:true});cameraFiles[name]=file;
}
const h=await meetingHarness({recordings:true,rawAudio:true,cameraFile:path.resolve('artifacts/qa/video-effects-camera.y4m'),cameraFiles,audioFiles:{RecordingSpeech:speechFile}}),evidence={stopTimings:[]};let step='startup',main;
async function state(context){return(await context.request.get(h.origin+'/api/auth/meetings/talk-workshop/recording-state')).json();}
async function action(context,path,body={}){const cfg=await state(context);return context.request.post(h.origin+'/api/auth/'+path,{headers:{Origin:h.origin,'X-CSRF-Token':cfg.csrfToken},data:body});}
async function accept(page){await page.getByRole('button',{name:'I consent to recording',exact:true}).click();}
async function request(a,participants,mode='audio'){
  await openPanel(a,'More options');await expect(panel(a).getByRole('button',{name:'Request recording consent',exact:true})).toBeEnabled({timeout:30000});
  await panel(a).getByLabel('Recording mode',{exact:true}).selectOption(mode);await panel(a).getByLabel('Speech language',{exact:true}).selectOption('en');
  await panel(a).getByRole('button',{name:'Request recording consent',exact:true}).click();
  await expect(participants[0].getByRole('dialog').getByRole('heading',{name:'This meeting requests recording',exact:true})).toBeVisible();
  const awaiting=await state(participants[0].context());
  assert.equal(awaiting.active.status,'awaiting_consent');
  assert.equal((await action(participants[0].context(),`meetings/talk-workshop/recordings/${awaiting.active.id}/start`)).status(),409,'host cannot capture before everyone consents');
  assert.equal(h.database.prepare('SELECT status FROM talk_recordings WHERE id=?').get(awaiting.active.id).status,'awaiting_consent');
  for(const page of participants)await accept(page);
  await expect(panel(a).getByRole('button',{name:'Start Recording',exact:true})).toBeEnabled({timeout:20000});
  const before=await state(participants[0].context());assert.ok(before.active);assert.equal(before.active.status,'awaiting_consent');
  await panel(a).getByRole('button',{name:'Start Recording',exact:true}).click();
  const deadline=Date.now()+180000; while(true){const status=h.database.prepare('SELECT status,error_code FROM talk_recordings WHERE id=?').get(before.active.id);if(status.status==='recording')break;if(status.status==='failed')throw new Error('Real recorder failed: '+status.error_code);if(Date.now()>deadline)throw new Error('Real recorder startup timed out');await new Promise(resolve=>setTimeout(resolve,1000));}
  for(const page of participants)await expect(page.locator('.talk-recording-notice.is-recording')).toBeVisible({timeout:20000});
  return before.active.id;
}
async function stop(a,id){
  const responsePromise=a.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith(`/recordings/${id}/stop`),{timeout:6000});
  const began=Date.now();await panel(a).getByRole('button',{name:'Stop Recording',exact:true}).click();
  const response=await responsePromise,acceptedMs=Date.now()-began;
  assert.equal(response.status(),202);assert.ok(acceptedMs<5000,`Stop must acknowledge without waiting for encoder finalization (${acceptedMs}ms)`);
  await connected(a);
  await expect.poll(()=>h.database.prepare('SELECT status FROM talk_recordings WHERE id=?').get(id).status,{timeout:45000}).toBe('completed');
  evidence.stopTimings.push({mode:h.database.prepare('SELECT mode FROM talk_recordings WHERE id=?').get(id).mode,acceptedMs,finalizedMs:Date.now()-began});
}
function toneEnergy(pcm,frequency){const count=Math.min(pcm.length/4,48000*7),n=4800;let power=0,windows=0;for(let start=0;start+n<count;start+=n){let re=0,im=0;for(let i=0;i<n;i++){const value=pcm.readFloatLE((start+i)*4),angle=2*Math.PI*frequency*i/48000;re+=value*Math.cos(angle);im+=value*Math.sin(angle);}power+=(re*re+im*im)/(n*n);windows++;}return Math.sqrt(power/Math.max(1,windows));}
try{
  const alice=await h.member('RecordingAlice'),bob=await h.member('RecordingBob',660);const a=alice.page,b=bob.page;main=a;
  await h.join(a,'Alice',true);await h.join(b,'Bob',true);
  evidence.senderAudioEnergy=await Promise.all([a,b].map(page=>page.evaluate(async()=>{let energy=0;for(const pc of window.__talkTestPeers){if(pc.connectionState==='closed')continue;for(const report of(await pc.getStats()).values())if(report.type==='media-source'&&report.kind==='audio')energy=Math.max(energy,report.totalAudioEnergy||0);}return energy;})));
  console.log('PASS two authenticated browsers joined with real LiveKit camera/audio tracks. Sender audio energy:',JSON.stringify(evidence.senderAudioEnergy));
  assert.equal((await action(bob.context,'meetings/talk-workshop/recordings/request',{mode:'audio',language:'en',retentionDays:7})).status(),404,'a participant cannot request a recording');
  step='audio consent and actual multi-participant capture';const audioId=await request(a,[a,b]);
  assert.equal((await action(bob.context,`meetings/talk-workshop/recordings/${audioId}/stop`)).status(),404,'a participant cannot stop host capture');
  await new Promise(resolve=>setTimeout(resolve,7000));await a.screenshot({path:'artifacts/qa/recording-active-desktop.png'});await stop(a,audioId);
  const audioRow=h.database.prepare('SELECT * FROM talk_recordings WHERE id=?').get(audioId);assert.ok(audioRow.bytes>1000);const audioPath=await h.recordingRuntime.storage.localPath(audioRow.storage_key);
  const pcm=execFileSync(ffmpeg.path,['-v','error','-i',audioPath,'-f','f32le','-ar','48000','-ac','1','pipe:1'],{maxBuffer:10*1024*1024,windowsHide:true});
  const energy440=toneEnergy(pcm,440),energy660=toneEnergy(pcm,660),noise=toneEnergy(pcm,520);assert.ok(energy440>0.0001&&energy660>0.0001&&energy440>noise*3&&energy660>noise*3,'recording contains BOTH participant microphone frequencies');
  assert.ok(audioRow.duration_ms>=6500&&audioRow.duration_ms<60000,'audio recording duration includes the requested capture window');
  evidence.audio={bytes:audioRow.bytes,durationMs:audioRow.duration_ms,energy440,energy660,noise};
  for(const endpoint of ['playback','playback?download=1','transcript','transcript.txt','transcript.pdf'])assert.equal((await bob.context.request.get(h.origin+`/api/auth/recordings/${audioId}/${endpoint}`)).status(),404,`participant cannot access private ${endpoint}`);
  const ranged=await alice.context.request.get(h.origin+`/api/auth/recordings/${audioId}/playback`,{headers:{Range:'bytes=0-31'}});assert.equal(ranged.status(),206);assert.equal((await ranged.body()).length,32);
  console.log('PASS real server recording includes both LiveKit microphones and private Range access.');

  step='video capture, late-join consent and withdrawal';const videoId=await request(a,[a,b],'video');
  // Capture an initial two-user layout before introducing a late joiner.
  await new Promise(resolve=>setTimeout(resolve,3000));
  const late=await h.member('RecordingLate',880);await late.page.goto(h.origin+'/device-test',{waitUntil:'domcontentloaded',timeout:60000});await expect(late.page.getByLabel('Your display name')).toBeVisible({timeout:30000});await expect(late.page.getByText('This meeting requests recording',{exact:true})).toBeVisible({timeout:20000});
  const denied=await action(late.context,'meetings/talk-workshop/token',{displayName:'Late'});assert.equal(denied.status(),409);assert.equal((await denied.json()).error,'recording_consent_required');
  assert.equal((await h.service.listParticipants(h.roomName())).length,3,'unconsenting user has no SFU access');
  await accept(late.page);await late.page.getByLabel('Your display name').fill('Late');await late.page.getByRole('link',{name:'Join session',exact:true}).click();
  try{await connected(late.page);}catch(failure){
    // Connection failures can appear in the empty stage or a live notice.
    // Snapshot the DOM without waiting for a CSS selector that may not exist.
    const snapshot=await late.page.evaluate(()=>({url:location.pathname,state:document.querySelector('.live-meeting')?.getAttribute('data-connection-state')||'missing',alerts:[...document.querySelectorAll('[role="alert"]')].map(el=>el.textContent?.trim()),stage:document.querySelector('.studio-empty-stage')?.textContent?.trim()||'',body:document.body.innerText.slice(0,5000)}));
    evidence.lateJoinInitialFailure={message:failure.message,...snapshot};
    await fs.writeFile('artifacts/qa/recording-late-join-diagnostic.json',JSON.stringify(evidence.lateJoinInitialFailure,null,2));
    await late.page.screenshot({path:'artifacts/qa/recording-late-join-failure.png',fullPage:true}).catch(()=>{});
    console.error('Late join connection failure:',JSON.stringify(snapshot));
    const rejoin=late.page.getByRole('button',{name:'Rejoin meeting',exact:true});
    if(!['error','disconnected'].includes(snapshot.state)||!await rejoin.isVisible())throw new Error('Late join failed without an available Rejoin action: '+JSON.stringify(snapshot),{cause:failure});
    evidence.lateJoinUsedExistingRejoin=true;await rejoin.click();await connected(late.page);
  }
  await new Promise(resolve=>setTimeout(resolve,5000));
  const withdrawalResponse=b.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith(`/recordings/${videoId}/consent`),{timeout:6000});
  const withdrewAt=Date.now();await b.locator('.talk-recording-notice').getByRole('button',{name:'Withdraw consent',exact:true}).click();
  assert.equal((await withdrawalResponse).status(),202);const withdrawalAcceptedMs=Date.now()-withdrewAt;assert.ok(withdrawalAcceptedMs<5000,'consent withdrawal must acknowledge without waiting for encoder finalization');
  await expect.poll(()=>h.database.prepare('SELECT status FROM talk_recordings WHERE id=?').get(videoId).status,{timeout:45000}).toBe('completed');await connected(a);await connected(b);
  const videoRow=h.database.prepare('SELECT * FROM talk_recordings WHERE id=?').get(videoId),videoPath=await h.recordingRuntime.storage.localPath(videoRow.storage_key);
  const image=execFileSync(ffmpeg.path,['-v','error','-ss','2','-i',videoPath,'-frames:v','1','-vf','scale=640:360','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{maxBuffer:1024*1024,windowsHide:true});assert.equal(image.length,640*360*3);
  let redPixels=0,bluePixels=0;for(let i=0;i<image.length;i+=3){const [r,g,b]=image.subarray(i,i+3);if(r>140&&r>g*1.7&&r>b*1.7)redPixels++;if(b>140&&b>g*1.7&&b>r*1.7)bluePixels++;}
  assert.ok(redPixels>10000&&bluePixels>10000,`recording must contain both distinct participant camera frames (red=${redPixels}, blue=${bluePixels})`);
  const videoPcm=execFileSync(ffmpeg.path,['-v','error','-i',videoPath,'-f','f32le','-ar','48000','-ac','1','pipe:1'],{maxBuffer:30*1024*1024,windowsHide:true});
  const videoEnergy440=toneEnergy(videoPcm,440),videoEnergy660=toneEnergy(videoPcm,660),videoNoise=toneEnergy(videoPcm,520);assert.ok(videoEnergy440>0.0001&&videoEnergy660>0.0001&&videoEnergy440>videoNoise*3&&videoEnergy660>videoNoise*3,'audio/video recording contains both participants\' microphone signals');
  assert.ok(videoRow.duration_ms>=7000&&videoRow.duration_ms<120000,'audio/video recording has a plausible captured duration');
  evidence.video={bytes:videoRow.bytes,durationMs:videoRow.duration_ms,decodedRedCameraPixels:redPixels,decodedBlueCameraPixels:bluePixels,energy440:videoEnergy440,energy660:videoEnergy660,noise:videoNoise,lateJoinBlockedBeforeConsent:true,withdrawalStoppedCapture:true,withdrawalAcceptedMs,withdrawalFinalizedMs:Date.now()-withdrewAt};
  console.log('PASS actual video recording, late-join privacy and consent withdrawal without ending the meeting.');

  step='genuine speech transcription through durable recording jobs';
  await a.getByRole('button',{name:'Mute microphone',exact:true}).click();await b.getByRole('button',{name:'Mute microphone',exact:true}).click();
  const speech=await h.member('RecordingSpeech',990);await h.join(speech.page,'Speech sample',true);
  const speechId=await request(a,[a,b,late.page,speech.page]);await new Promise(resolve=>setTimeout(resolve,16000));await stop(a,speechId);
  assert.equal((await h.api(alice.context,'end')).status(),200);await Promise.all([a,b,late.page,speech.page].map(page=>page.close()));
  await expect.poll(()=>h.database.prepare('SELECT transcript_status FROM talk_recordings WHERE id=?').get(speechId).transcript_status,{timeout:180000,intervals:[1000,2000,3000]}).toBe('completed');
  const transcript=await(await alice.context.request.get(h.origin+`/api/auth/recordings/${speechId}/transcript`)).json();assert.match(transcript.segments.map(s=>s.text).join(' '),/country/i);assert.ok(transcript.segments.every(s=>s.speaker===null));evidence.transcription={language:transcript.language,segments:transcript.segments.length,realWhisper:true,publicSpeechFixtureOnly:true};
  const history=await alice.context.newPage();await history.goto(h.origin+'/meeting-history/talk-workshop',{waitUntil:'domcontentloaded',timeout:60000});await expect(history.getByRole('heading',{name:'Social Media Marketing Workshop',exact:true})).toBeVisible({timeout:30000});
  await history.getByRole('tab',{name:'Transcript',exact:true}).click();await history.getByLabel('Search transcript',{exact:true}).fill('country');await expect(history.locator('.talk-transcript-segment').first()).toContainText(/country/i);
  await history.getByLabel('Search transcript',{exact:true}).fill('no-match-7e392');await expect(history.getByText('No matching transcript segments.',{exact:true})).toBeVisible();
  await history.getByLabel('Search transcript',{exact:true}).fill('');
  const seekIndex=transcript.segments.findIndex(segment=>segment.start>=1),targetIndex=seekIndex<0?0:seekIndex,targetSeconds=transcript.segments[targetIndex].start;
  await history.locator('.talk-transcript-segment button').nth(targetIndex).click();await expect(history.getByRole('tab',{name:'Recording',exact:true})).toHaveAttribute('aria-selected','true');
  const player=history.getByLabel('Meeting recording',{exact:true});await expect.poll(()=>player.evaluate(el=>Number.isFinite(el.duration)&&el.duration>0),{timeout:20000}).toBe(true);evidence.playbackDuration=await player.evaluate(el=>el.duration);
  await expect.poll(()=>player.evaluate((el,target)=>Math.abs(el.currentTime-target)<2,targetSeconds),{timeout:10000}).toBe(true);evidence.transcriptSeek={requestedSeconds:targetSeconds,observedSeconds:await player.evaluate(el=>{el.pause();return el.currentTime;}),nonzeroTimestamp:targetSeconds>=1};
  const txt=await alice.context.request.get(h.origin+`/api/auth/recordings/${speechId}/transcript.txt`);assert.match(await txt.text(),/country/i);
  const pdf=await alice.context.request.get(h.origin+`/api/auth/recordings/${speechId}/transcript.pdf`,{timeout:60000});assert.equal(pdf.status(),200);assert.equal((await pdf.body()).subarray(0,4).toString(),'%PDF');await fs.writeFile('artifacts/qa/recording-transcript.pdf',await pdf.body());
  await history.setViewportSize({width:390,height:844});assert.equal(await history.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await history.screenshot({path:'artifacts/qa/recording-history-mobile.png',fullPage:true});
  // Delete the already-inspected tone segment through the actual details UI.
  const audioSegment=history.getByLabel('Recording segments').getByRole('button').filter({hasText:/Audio/}).filter({hasNotText:'Audio & video'}).last();
  await audioSegment.click();await history.getByRole('tab',{name:'Recording',exact:true}).click();
  history.once('dialog',dialog=>dialog.accept());await history.getByRole('button',{name:'Delete recording & transcript',exact:true}).click();
  await expect.poll(()=>h.database.prepare('SELECT status FROM talk_recordings WHERE id=?').get(audioId).status,{timeout:10000}).toBe('deleted');
  assert.equal((await alice.context.request.get(h.origin+`/api/auth/recordings/${audioId}/playback`)).status(),404);assert.ok(h.database.prepare("SELECT 1 FROM talk_recording_events WHERE recording_id=? AND action='deleted'").get(audioId));evidence.detailsDeletion={throughActualUI:true,immediateAccessRevocation:true,audited:true};
  assert.deepEqual(h.errors,[]);await fs.writeFile('artifacts/qa/recording-browser-results.json',JSON.stringify({passed:true,realLiveKitRecording:true,realLocalWhisper:true,mediaHardwareAndIdentityAreFixtures:true,noPaidServices:true,evidence},null,2));
  console.log('PASS genuine recording → private storage → durable Whisper transcription → search/seek/TXT/PDF/mobile flow. Media and identity fixtures; actual LiveKit/recording/STT.');
}catch(failure){if(main&&!main.isClosed())await main.screenshot({path:'artifacts/qa/recording-browser-failure.png',fullPage:true}).catch(()=>{});console.error('FAIL recording browser:',step,failure.message); console.error('Worker diagnostics:',JSON.stringify(h.database.prepare("SELECT action,detail FROM talk_recording_events WHERE action IN ('worker_stage','capture_failed','capture_completed') ORDER BY created_at").all()));await fs.writeFile('artifacts/qa/recording-browser-results.json',JSON.stringify({passed:false,step,message:failure.message,evidence},null,2));process.exitCode=1;}finally{await h.close();}
