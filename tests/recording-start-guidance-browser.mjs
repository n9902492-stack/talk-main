import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
import {expect} from '@playwright/test';
import {meetingHarness,openPanel,panel} from './helpers/live-meeting.mjs';

// Existing public speech fixture and generated cameras/microphones only.
// No private meeting content, external providers or public runtime involved.
const speech=path.resolve('artifacts/qa/recording-guidance-public-speech.wav');
execFileSync(ffmpeg.path,['-y','-i','artifacts/qa/recording-speech-48k.wav','-ss','3','-t','5','-ar','48000','-ac','1',speech],{stdio:'ignore',windowsHide:true});
const h=await meetingHarness({recordings:true,rawAudio:true,lowResourceMedia:true,
  frontendBuild:'artifacts/qa/phase10-build',
  audioFiles:{GuidanceSpeaker:speech},
  cameraFiles:{GuidanceSpeaker:path.resolve('artifacts/qa/RecordingAlice-recording-camera.y4m'),GuidanceMember:path.resolve('artifacts/qa/RecordingBob-recording-camera.y4m')},
});
let step='join';
try{
  const host=await h.member('GuidanceSpeaker'),member=await h.member('GuidanceMember',660),page=host.page;
  await h.join(page,'Guidance host',true);await h.join(member.page,'Guidance member',true);
  await member.page.getByRole('button',{name:'Mute microphone',exact:true}).click();
  await openPanel(page,'More options');await panel(page).getByLabel('Recording mode',{exact:true}).selectOption('video');
  await panel(page).getByLabel('Speech language',{exact:true}).selectOption('en');
  await panel(page).getByRole('button',{name:'Request recording consent',exact:true}).click();
  await expect(page.getByRole('dialog').getByRole('heading',{name:'This meeting requests recording'})).toBeVisible();
  const state=async()=>(await host.context.request.get(h.origin+'/api/auth/meetings/talk-workshop/recording-state')).json();
  const id=(await state()).active.id;
  step='pending details guidance on both tabs';
  const details=await host.context.newPage();await details.goto(h.origin+'/meeting-history/talk-workshop');
  await expect(details.getByRole('heading',{name:'Recording has not started'})).toBeVisible();
  await expect(details.getByRole('link',{name:'Return to meeting to start recording'})).toHaveAttribute('href','/device-test?room=talk-workshop');
  await details.getByRole('tab',{name:'Transcript',exact:true}).click();await expect(details.getByRole('heading',{name:'Recording has not started'})).toBeVisible();
  await expect(details.getByText('No audio or video has been captured for this segment.',{exact:false})).toBeVisible();
  step='explicit consent and prominent start';
  await page.getByRole('button',{name:'I consent to recording',exact:true}).click();
  await expect(page.locator('.talk-recording-start')).toHaveCount(0);
  await member.page.getByRole('button',{name:'I consent to recording',exact:true}).click();
  await expect(page.locator('.talk-recording-start')).toBeEnabled({timeout:30000});
  assert.equal((await state()).active.status,'awaiting_consent','Consent alone must never start capture');
  await page.locator('.talk-recording-start').click();
  const row=()=>h.database.prepare('SELECT * FROM talk_recordings WHERE id=?').get(id);
  await expect.poll(()=>{const r=row();if(r.status==='failed')throw new Error(r.error_code);return r.status;},{timeout:180000}).toBe('recording');
  await new Promise(resolve=>setTimeout(resolve,8000));
  step='save real video and run local Whisper';
  await panel(page).getByRole('button',{name:'Stop Recording',exact:true}).click();
  await expect.poll(()=>row().status,{timeout:120000}).toBe('completed');
  const r=row(),file=await h.recordingRuntime.storage.localPath(r.storage_key);assert.equal((await fs.stat(file)).size,r.bytes);assert.ok(r.bytes>10000);
  await details.getByRole('tab',{name:'Recording',exact:true}).click();
  const player=details.getByLabel('Meeting recording',{exact:true});await expect(player).toBeVisible({timeout:20000});
  await player.evaluate(el=>el.play());await expect.poll(()=>player.evaluate(el=>el.currentTime)).toBeGreaterThan(.5);await player.evaluate(el=>el.pause());
  // These are test-owned pages/processes, not the user's open browsers. Free
  // their media pipelines before CPU transcription on this small laptop.
  await page.close();await member.context.browser().close();
  await expect.poll(()=>row().transcript_status,{timeout:240000,intervals:[1000,2000,5000]}).toBe('completed');
  await details.getByRole('tab',{name:'Transcript',exact:true}).click();
  await expect(details.locator('.talk-transcript-segment').first()).toBeVisible({timeout:20000});
  await expect(details.locator('.talk-history-segments')).toContainText(/country/i);
  await details.screenshot({path:'artifacts/qa/recording-start-guidance-transcript.png',fullPage:true});
  assert.deepEqual(h.errors,[]);
  await fs.writeFile('artifacts/qa/recording-start-guidance-results.json',JSON.stringify({passed:true,pendingGuidanceBothTabs:true,consentDoesNotAutoStart:true,prominentExplicitStart:true,realVideoPlayed:true,realLocalWhisper:true,bytes:r.bytes,transcriptSegments:h.database.prepare('SELECT COUNT(*) AS n FROM talk_transcript_segments WHERE recording_id=?').get(id).n,fixtureMediaOnly:true},null,2));
  console.log('PASS consent guidance, explicit visible Start, actual saved video playback and actual local Whisper transcript in Meeting Details.');
}catch(failure){console.error('FAIL',step,failure.message);process.exitCode=1;}finally{await h.close();}
