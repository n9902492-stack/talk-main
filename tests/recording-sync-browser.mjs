import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync,execFileSync} from 'node:child_process';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
import {expect} from '@playwright/test';
import {meetingHarness} from './helpers/live-meeting.mjs';
import {localSfu} from './helpers/local-sfu.mjs';

const directory=await fs.mkdtemp(path.resolve('artifacts/qa/recording-sync-'));
const camera=path.join(directory,'flash.y4m'),mic=path.join(directory,'beep.wav');
// Both fixtures have the same 2-second timeline: white + tone for 300 ms,
// then black + silence. Unlike static pictures/constant tones this detects drift.
execFileSync(ffmpeg.path,['-y','-f','lavfi','-i',"color=c=black:size=320x180:rate=30,drawbox=color=white:t=fill:enable='lt(mod(t,2),0.3)'",'-t','24','-pix_fmt','yuv420p',camera],{stdio:'ignore',windowsHide:true});
const rate=48000,samples=rate*24,wav=Buffer.alloc(44+samples*2);
wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
for(let i=0;i<samples;i++)wav.writeInt16LE(i%(rate*2)<rate*.3?Math.round(12000*Math.sin(2*Math.PI*440*i/rate)):0,44+i*2);
await fs.writeFile(mic,wav);
const sfu=await localSfu(),h=await meetingHarness({recordings:true,rawAudio:true,lowResourceMedia:true,frontendBuild:'artifacts/qa/phase10-build',livekitConfig:sfu.config,
  cameraFiles:{SyncHost:camera},audioFiles:{SyncHost:mic},recordingEnv:{RECORDING_LOCAL_PATH:path.join(directory,'media'),WHISPER_EXECUTABLE:path.join(directory,'disabled.exe')}});
let step='join';const report={passed:false,syntheticPulses:true,realLiveKit:true,realMediaRecorder:true};
const ff=args=>{const r=spawnSync(ffmpeg.path,['-hide_banner',...args],{maxBuffer:12*1024*1024,windowsHide:true});assert.equal(r.status,0,'FFmpeg must decode the actual saved media');return r;};
try{
  const host=await h.member('SyncHost'),member=await h.member('SyncMember',660);
  await h.join(host.page,'Sync host',true);await h.join(member.page,'Sync member');
  // Fake camera/audio files can start at different offsets in Chrome. Publish
  // both generated signals from one explicit clock, so this test measures the
  // recorder's sync rather than independent fake-device startup timing.
  await host.page.evaluate(async()=>{
    const audio=new AudioContext({sampleRate:48000,latencyHint:'playback',sinkId:{type:'none'}}),destination=audio.createMediaStreamDestination();
    const oscillator=audio.createOscillator(),gain=audio.createGain();oscillator.frequency.value=440;gain.gain.value=0;
    oscillator.connect(gain).connect(destination);await audio.resume();
    const epoch=audio.currentTime+.5;
    for(let i=0;i<40;i++){gain.gain.setValueAtTime(.35,epoch+i*2);gain.gain.setValueAtTime(0,epoch+i*2+.3);}
    oscillator.start();
    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const context=canvas.getContext('2d');
    const draw=()=>{const time=audio.currentTime-epoch;context.fillStyle=time>=0&&time%2<.3?'white':'black';context.fillRect(0,0,640,360);};draw();setInterval(draw,1000/30);
    const senders=window.__talkTestPeers.flatMap(pc=>pc.getSenders());
    await senders.find(s=>s.track?.kind==='audio').replaceTrack(destination.stream.getAudioTracks()[0]);
    await senders.find(s=>s.track?.kind==='video').replaceTrack(canvas.captureStream(30).getVideoTracks()[0]);
    window.__talkSyncSource={audio,oscillator,canvas};
  });
  const base=h.origin+'/api/auth/meetings/talk-workshop',state=async()=>(await host.context.request.get(base+'/recording-state')).json();
  const action=async(suffix,body={})=>host.context.request.post(base+'/recordings/'+suffix,{headers:{Origin:h.origin,'X-CSRF-Token':(await state()).csrfToken},data:body});
  const requested=await action('request',{mode:'video',language:'en',retentionDays:7});assert.equal(requested.status(),202);const id=(await requested.json()).id;
  for(const p of [host.page,member.page])await p.getByRole('button',{name:'I consent to recording',exact:true}).click();
  await expect(host.page.locator('.talk-recording-start')).toBeEnabled({timeout:20000});await host.page.locator('.talk-recording-start').click();
  const row=()=>h.database.prepare('SELECT * FROM talk_recordings WHERE id=?').get(id);
  await expect.poll(()=>{if(row().status==='failed')throw new Error(row().error_code);return row().status;},{timeout:180000}).toBe('recording');
  step='capture repeated synchronized flashes and beeps';await new Promise(r=>setTimeout(r,20000));
  assert.equal((await action(id+'/stop')).status(),202);await expect.poll(()=>row().status,{timeout:120000}).toBe('completed');
  const r=row(),file=await h.recordingRuntime.storage.localPath(r.storage_key);
  step='decode audio sample continuity and visible/audio pulse timestamps';
  const raw=ff(['-i',file,'-an','-vf','crop=16:16:600:300,scale=1:1,fps=30','-pix_fmt','gray','-f','rawvideo','pipe:1']).stdout;
  const videoEdges=[];for(let i=1;i<raw.length;i++)if(raw[i]>180&&raw[i-1]<100)videoEdges.push(i/30);
  const audio=ff(['-i',file,'-vn','-af','aresample=async=1:first_pts=0','-ar','48000','-ac','1','-f','f32le','pipe:1']).stdout;
  const audioEdges=[];let last=false;const n=960;
  for(let pos=0;pos+n<=audio.length/4;pos+=n){let sum=0;for(let i=0;i<n;i++)sum+=audio.readFloatLE((pos+i)*4)**2;const on=Math.sqrt(sum/n)>.04;if(on&&!last&&pos>0)audioEdges.push(pos/rate);last=on;}
  const info=ff(['-i',file,'-vn','-af','ashowinfo','-f','null','-']).stderr.toString();
  const chunks=info.split('\n').filter(l=>l.includes('Parsed_ashowinfo')&&l.includes('pts_time:')).map(l=>({pts:Number(l.match(/pts_time:([\d.]+)/)?.[1]),samples:Number(l.match(/nb_samples:(\d+)/)?.[1])}));
  const sampleSeconds=chunks.reduce((n,c)=>n+c.samples,0)/rate,spanSeconds=chunks.at(-1).pts+chunks.at(-1).samples/rate-chunks[0].pts;
  const offsets=audioEdges.filter(t=>t>1&&t<18).map(t=>(t-videoEdges.reduce((best,v)=>Math.abs(v-t)<Math.abs(best-t)?v:best,videoEdges[0]))*1000);
  const diagnostics=JSON.parse(h.database.prepare("SELECT detail FROM talk_recording_events WHERE recording_id=? AND action='capture_completed'").get(id).detail).diagnostics;
  Object.assign(report,{file,bytes:r.bytes,durationMs:r.duration_ms,videoEdges,audioEdges,offsetsMs:offsets,audioSampleSeconds:sampleSeconds,audioTimestampSpanSeconds:spanSeconds,diagnostics});
  assert.ok(videoEdges.length>=7&&audioEdges.length>=7,'Enough repeated synchronized pulses must survive actual WebRTC capture');
  assert.ok(spanSeconds-sampleSeconds<.35,`Audio must be continuous, not missing seconds of samples: ${spanSeconds-sampleSeconds}s missing`);
  assert.ok(offsets.every(ms=>Math.abs(ms)<250),`Audio/video pulse offset must stay below 250ms: ${offsets}`);
  assert.ok(Math.max(...offsets)-Math.min(...offsets)<200,'No increasing audio/video drift');
  assert.ok(Math.abs(diagnostics.audioElapsedMs-diagnostics.captureElapsedMs)<250,'Recording audio sample clock must follow video wall clock');
  step='private recording browser playback';await host.page.goto(h.origin+'/meeting-history/talk-workshop');
  const player=host.page.getByLabel('Meeting recording',{exact:true});await expect(player).toBeVisible();await player.evaluate(el=>el.play());await expect.poll(()=>player.evaluate(el=>el.currentTime)).toBeGreaterThan(.5);await player.evaluate(el=>el.pause());
  report.browserPlayback=true;report.passed=true;console.log('PASS continuous audio and synchronized visual/audio pulses in actual LiveKit recording.');
}catch(e){report.step=step;report.error=e.message;process.exitCode=1;console.error('FAIL',step,e.message);}
finally{await fs.writeFile(path.join(directory,'results.json'),JSON.stringify(report,null,2));console.log('Evidence:',path.join(directory,'results.json'));await h.close();await sfu.stop();}
