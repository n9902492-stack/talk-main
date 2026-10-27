import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
import { expect } from '@playwright/test';
import { meetingHarness, openPanel, panel, connected } from './helpers/live-meeting.mjs';
import { localSfu } from './helpers/local-sfu.mjs';

const directory = await fs.mkdtemp(path.resolve('artifacts/qa/recording-save-'));
const databasePath = path.join(directory, 'test.sqlite'), mediaDirectory = path.join(directory, 'media');
const cameras = {};
for (const [name, color] of [['SaveHost','red'],['SaveMember','blue']]) {
  cameras[name] = path.join(directory, name+'.y4m');
  execFileSync(ffmpeg.path, ['-y','-f','lavfi','-i',`color=c=${color}:size=640x360:rate=10`,'-t','2','-pix_fmt','yuv420p',cameras[name]], {stdio:'ignore',windowsHide:true});
}
const sfu = await localSfu();
const options = { recordings:true, databasePath, cameraFiles:cameras, rawAudio:true, lowResourceMedia:true,
  frontendBuild:'artifacts/qa/phase10-build', livekitConfig:sfu.config,
  recordingEnv:{ RECORDING_LOCAL_PATH:mediaDirectory, WHISPER_EXECUTABLE:path.join(directory,'not-installed.exe') } };
let h, main, step = 'startup';
const evidence = {syntheticMedia:true,realLiveKit:true,realMediaRecorder:true,externalRequests:false,results:[]};
const wait = (predicate, timeout=120000) => expect.poll(predicate,{timeout,intervals:[500,1000,2000]}).toBe(true);
let host, member;
const row = id => h.database.prepare('SELECT * FROM talk_recordings WHERE id=?').get(id);
async function state(context=host.context) { return (await context.request.get(h.origin+'/api/auth/meetings/talk-workshop/recording-state')).json(); }
async function action(context, suffix, body={}) {
  const cfg = await state(context);
  return context.request.post(h.origin+'/api/auth/meetings/talk-workshop/recordings/'+suffix,{headers:{Origin:h.origin,'X-CSRF-Token':cfg.csrfToken},data:body});
}
async function start() {
  await openPanel(host.page,'More options');
  await panel(host.page).getByLabel('Recording mode',{exact:true}).selectOption('video');
  await panel(host.page).getByRole('button',{name:'Request recording consent',exact:true}).click();
  await expect(host.page.getByRole('dialog').getByRole('heading',{name:'This meeting requests recording',exact:true})).toBeVisible();
  const id=(await state()).active.id;
  assert.equal((await action(host.context,id+'/start')).status(),409);
  for (const who of [host,member]) await who.page.getByRole('button',{name:'I consent to recording',exact:true}).click();
  await expect(panel(host.page).getByRole('button',{name:'Start Recording',exact:true})).toBeEnabled({timeout:30000});
  await panel(host.page).getByRole('button',{name:'Start Recording',exact:true}).click();
  await wait(()=>{const r=row(id);if(r.status==='failed')throw new Error('Capture startup failed: '+r.error_code);return r.status==='recording';},180000);
  await expect(host.page.locator('.talk-recording-notice.is-recording')).toBeVisible();
  await new Promise(resolve=>setTimeout(resolve,6000));
  return id;
}
function energy(pcm, frequency) {
  let sum=0,windows=0;const n=4800;
  for(let start=0;start+n<Math.min(pcm.length/4,48000*6);start+=n){let re=0,im=0;for(let i=0;i<n;i++){const x=pcm.readFloatLE((start+i)*4),angle=2*Math.PI*frequency*i/48000;re+=x*Math.cos(angle);im+=x*Math.sin(angle);}sum+=(re*re+im*im)/(n*n);windows++;}
  return Math.sqrt(sum/Math.max(1,windows));
}
async function verifySaved(id, reason) {
  await wait(()=>{if(row(id).status==='failed')throw new Error('Finalization failed: '+row(id).error_code);return row(id).status==='completed';});
  const r=row(id),filename=await h.recordingRuntime.storage.localPath(r.storage_key),info=await fs.stat(filename);
  assert.equal(info.size,r.bytes);assert.ok(info.size>10000);
  // Decode every packet, then inspect genuine participant colors and microphone tones.
  execFileSync(ffmpeg.path,['-v','error','-i',filename,'-f','null','-'],{windowsHide:true,stdio:'pipe'});
  const rgb=execFileSync(ffmpeg.path,['-v','error','-ss','2','-i',filename,'-frames:v','1','-vf','scale=640:360','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{windowsHide:true,maxBuffer:1024*1024});
  let red=0,blue=0;for(let i=0;i<rgb.length;i+=3){const[r,g,b]=rgb.subarray(i,i+3);if(r>140&&r>g*1.7&&r>b*1.7)red++;if(b>140&&b>g*1.7&&b>r*1.7)blue++;}
  assert.ok(red>10000&&blue>10000,`Both participant videos required (red ${red}, blue ${blue})`);
  const pcm=execFileSync(ffmpeg.path,['-v','error','-i',filename,'-f','f32le','-ar','48000','-ac','1','pipe:1'],{windowsHide:true,maxBuffer:30*1024*1024});
  const a=energy(pcm,440),b=energy(pcm,660),noise=energy(pcm,520);assert.ok(a>0.0001&&b>0.0001&&a>noise*3&&b>noise*3,'Both participant microphones required');
  const history=await host.context.newPage();await history.goto(h.origin+'/meeting-history/talk-workshop');
  const details=await (await host.context.request.get(h.origin+'/api/auth/meeting-history/talk-workshop')).json();
  const index=details.recordings.findIndex(recording=>recording.id===id);assert.ok(index>=0);
  await history.getByLabel('Recording segments').getByRole('button').nth(index).click();
  const player=history.getByLabel('Meeting recording',{exact:true});
  await expect(player).toHaveAttribute('src',`/api/auth/recordings/${id}/playback`);
  await expect.poll(()=>player.evaluate(el=>Number.isFinite(el.duration)&&el.duration>0),{timeout:30000}).toBe(true);
  await player.evaluate(el=>el.play());await expect.poll(()=>player.evaluate(el=>el.currentTime),{timeout:20000}).toBeGreaterThan(0.5);
  await player.evaluate(el=>el.pause());
  const playback={duration:await player.evaluate(el=>el.duration),time:await player.evaluate(el=>el.currentTime)};
  await history.screenshot({path:path.join(directory,reason+'-details.png'),fullPage:true});await history.close();
  assert.equal((await member.context.request.get(h.origin+`/api/auth/recordings/${id}/playback`)).status(),404);
  assert.equal((await host.context.request.get(h.origin+`/api/auth/recordings/${id}/playback?download=1`)).status(),200);
  evidence.results.push({id,reason,filename,bytes:r.bytes,durationMs:r.duration_ms,redPixels:red,bluePixels:blue,audio440:a,audio660:b,noise,playback,privateAccess:true});
  console.log('PASS saved and played actual two-participant video:',reason);
}
try {
  h=await meetingHarness(options);host=await h.member('SaveHost');member=await h.member('SaveMember',660);main=host.page;
  await h.join(host.page,'SaveHost',true);await h.join(member.page,'SaveMember',true);
  step='normal stop and private history playback';const id=await start();
  await panel(host.page).getByRole('button',{name:'Stop Recording',exact:true}).click();await verifySaved(id,'normal-stop');
  await connected(host.page);await connected(member.page);
  step='storage failure surfaced, then recovery';
  const originalCommit=h.recordingRuntime.storage.commit;
  h.recordingRuntime.storage.commit=async()=>{throw new Error('Synthetic permission/write failure');};
  const failedId=await start();assert.equal((await action(host.context,failedId+'/stop')).status(),202);
  await wait(()=>row(failedId).status==='failed');assert.equal(row(failedId).error_code,'storage_failed');assert.equal(row(failedId).bytes,0);
  await expect(host.page.getByRole('alert').filter({hasText:'could not be saved'}).first()).toBeVisible({timeout:20000});
  assert.equal((await host.context.request.get(h.origin+`/api/auth/recordings/${failedId}/playback`)).status(),409);
  h.recordingRuntime.storage.commit=originalCommit;evidence.failedSaveReported=true;
  step='host ends during active capture';const endedId=await start();assert.equal((await h.api(host.context,'end')).status(),200);await verifySaved(endedId,'host-ended');
  step='close server and reopen persistent database';const before=row(id);await h.close();h=undefined;
  h=await meetingHarness(options);host=await h.member('SaveHost');member=await h.member('SaveMember',660);main=host.page;
  assert.equal(row(id).storage_key,before.storage_key);assert.equal(row(id).bytes,before.bytes);
  await verifySaved(id,'after-restart');evidence.persistedAcrossServerRestart=true;
  assert.deepEqual(h.errors,[]);evidence.passed=true;console.log('PASS recording failure/recovery and disk-backed server restart.');
} catch(failure) {
  evidence.passed=false;evidence.step=step;evidence.error=failure.message;process.exitCode=1;
  if(h)evidence.workerEvents=h.database.prepare("SELECT action,detail FROM talk_recording_events WHERE action IN ('worker_stage','capture_failed','capture_finalizing','capture_completed') ORDER BY created_at").all();
  if(main&&!main.isClosed())await main.screenshot({path:path.join(directory,'failure.png'),fullPage:true}).catch(()=>{});
  console.error('FAIL',step,failure.message);
} finally {
  await fs.writeFile(path.join(directory,'results.json'),JSON.stringify(evidence,null,2));
  console.log('Evidence:',path.join(directory,'results.json'));
  if(h)await h.close();await sfu.stop();
}
