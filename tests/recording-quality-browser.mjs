import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
import {expect} from '@playwright/test';
import {meetingHarness} from './helpers/live-meeting.mjs';
import {localSfu} from './helpers/local-sfu.mjs';

const directory=await fs.mkdtemp(path.resolve('artifacts/qa/recording-quality-'));
const camera=path.join(directory,'detail-chart.y4m'),silent=path.join(directory,'silence.wav');
execFileSync(ffmpeg.path,['-y','-f','lavfi','-i','testsrc2=size=1280x720:rate=24','-t','2','-pix_fmt','yuv420p',camera],{stdio:'ignore',windowsHide:true});
execFileSync(ffmpeg.path,['-y','-f','lavfi','-i','anullsrc=r=48000:cl=mono','-t','2',silent],{stdio:'ignore',windowsHide:true});
const speech=(await fs.readFile('artifacts/qa/recording-speech-48k.wav')).toString('base64');
const reference='And so my fellow Americans ask not what your country can do for you ask what you can do for your country';
const words=s=>s.toLowerCase().replace(/[^a-z\s]/g,'').trim().split(/\s+/);
function wer(expected,actual){const a=words(expected),b=words(actual);let prev=Array.from({length:b.length+1},(_,i)=>i);for(let i=0;i<a.length;i++){const next=[i+1];for(let j=0;j<b.length;j++)next[j+1]=Math.min(next[j]+1,prev[j+1]+1,prev[j]+(a[i]===b[j]?0:1));prev=next;}return prev[b.length]/a.length;}
const sfu=await localSfu(),h=await meetingHarness({recordings:true,rawAudio:true,frontendBuild:'artifacts/qa/phase10-build',livekitConfig:sfu.config,cameraFiles:{QualityHost:camera},audioFiles:{QualityHost:silent},recordingEnv:{RECORDING_LOCAL_PATH:path.join(directory,'media')}});
const report={passed:false,publicSpeechFixture:true,realLiveKit:true};let step='join';
try{
  const host=await h.member('QualityHost'),member=await h.member('QualityMember');
  await h.join(host.page,'Quality host',true);await h.join(member.page,'Quality member');
  const base=h.origin+'/api/auth/meetings/talk-workshop',state=async()=>(await host.context.request.get(base+'/recording-state')).json();
  const action=async(suffix,body={})=>host.context.request.post(base+'/recordings/'+suffix,{headers:{Origin:h.origin,'X-CSRF-Token':(await state()).csrfToken},data:body});
  const requested=await action('request',{mode:'video',language:'en',retentionDays:7});const id=(await requested.json()).id;
  for(const page of [host.page,member.page])await page.getByRole('button',{name:'I consent to recording',exact:true}).click();
  await expect(host.page.locator('.talk-recording-start')).toBeEnabled({timeout:20000});await host.page.locator('.talk-recording-start').click();
  const row=()=>h.database.prepare('SELECT * FROM talk_recordings WHERE id=?').get(id);
  await expect.poll(()=>{if(row().status==='failed')throw new Error(row().error_code);return row().status;},{timeout:180000}).toBe('recording');
  step='publish the complete known speech once through real WebRTC';
  await host.page.evaluate(async encoded=>{
    const audio=new AudioContext({sampleRate:48000,latencyHint:'playback',sinkId:{type:'none'}}),dest=audio.createMediaStreamDestination();
    const buffer=await audio.decodeAudioData(Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)).buffer),source=audio.createBufferSource();source.buffer=buffer;source.connect(dest);await audio.resume();
    const sender=window.__talkTestPeers.flatMap(pc=>pc.getSenders()).find(s=>s.track?.kind==='audio');if(!sender)throw new Error('Real microphone RTP sender required');
    await sender.replaceTrack(dest.stream.getAudioTracks()[0]);
    await new Promise(resolve=>{source.onended=resolve;source.start(audio.currentTime+.5);});await new Promise(r=>setTimeout(r,800));
    await sender.replaceTrack(null);dest.stream.getTracks().forEach(t=>t.stop());await audio.close();
  },speech);
  assert.equal((await action(id+'/stop')).status(),202);await expect.poll(()=>row().status,{timeout:120000}).toBe('completed');
  const r=row(),file=await h.recordingRuntime.storage.localPath(r.storage_key);report.file=file;report.bytes=r.bytes;
  step='decode actual HD video and verify the selected quality profile';
  const decoded=spawnSync(ffmpeg.path,['-hide_banner','-i',file,'-an','-vf','showinfo','-f','null','-'],{encoding:'utf8',maxBuffer:8*1024*1024,windowsHide:true});assert.equal(decoded.status,0);
  assert.match(decoded.stderr,/1280x720/);
  const diagnostics=JSON.parse(h.database.prepare("SELECT detail FROM talk_recording_events WHERE recording_id=? AND action='capture_completed'").get(id).detail).diagnostics;report.encoding=diagnostics.encoding;
  assert.equal(diagnostics.encoding.videoBitsPerSecond,4500000);assert.equal(diagnostics.encoding.audioBitsPerSecond,128000);
  const details=await host.context.newPage();await details.goto(h.origin+'/meeting-history/talk-workshop');
  const player=details.getByLabel('Meeting recording',{exact:true});await expect(player).toBeVisible();await player.evaluate(el=>el.play());await expect.poll(()=>player.evaluate(el=>el.currentTime)).toBeGreaterThan(.5);await player.evaluate(el=>el.pause());
  await details.screenshot({path:path.join(directory,'video.png'),fullPage:true});
  await host.page.close();await member.context.browser().close();
  step='real local recognition accuracy against the known complete utterance';
  await expect.poll(()=>row().transcript_status,{timeout:300000,intervals:[1000,2000,5000]}).toBe('completed');
  const transcript=(await(await host.context.request.get(h.origin+`/api/auth/recordings/${id}/transcript`)).json());
  report.wordErrorRate=wer(reference,transcript.segments.map(s=>s.text).join(' '));report.transcriptSegments=transcript.segments.length;
  assert.ok(report.wordErrorRate<=.15,`Known reference speech WER must be <=15%; actual ${report.wordErrorRate}`);
  await details.getByRole('tab',{name:'Transcript',exact:true}).click();await expect(details.getByLabel('Search transcript',{exact:true})).toBeVisible({timeout:20000});
  await expect(details.getByLabel('Language spoken in this recording',{exact:true})).toHaveValue('en');
  await details.screenshot({path:path.join(directory,'transcript.png'),fullPage:true});
  step='explicit language regeneration preserves media and prior transcript revision';
  const previous=h.database.prepare('SELECT content_hash FROM talk_transcript_revisions WHERE recording_id=? ORDER BY revision DESC LIMIT 1').get(id);
  await details.getByRole('button',{name:'Regenerate transcript',exact:true}).click();
  await expect.poll(()=>row().transcript_status).toBe('queued');assert.equal(row().storage_key,r.storage_key);assert.equal(row().bytes,r.bytes);
  assert.equal(h.database.prepare('SELECT content_hash FROM talk_transcript_revisions WHERE recording_id=? ORDER BY revision DESC LIMIT 1').get(id).content_hash,previous.content_hash);
  report.browserPlayback=true;report.languageRegeneration=true;report.mediaPreserved=true;report.passed=true;
  console.log('PASS actual HD recording, browser playback, reference-speech accuracy and explicit regeneration. WER:',report.wordErrorRate);
}catch(e){report.step=step;report.error=e.message;console.error('FAIL',step,e.message);process.exitCode=1;}
finally{await fs.writeFile(path.join(directory,'results.json'),JSON.stringify(report,null,2));console.log('Evidence:',path.join(directory,'results.json'));await h.close();await sfu.stop();}
