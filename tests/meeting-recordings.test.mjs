import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createAuthApp } from '../backend/src/auth.mjs';
import { openAuthDatabase } from '../backend/src/database.mjs';
import { createMeetingService } from '../backend/src/meetings.mjs';
import { createRecordingStorage } from '../backend/src/recording-storage.mjs';
import { asyncDatabase } from '../backend/src/async-database.mjs';
import { createMeetingRecordings } from '../backend/src/meeting-recordings.mjs';
import { createMeetingManagement } from '../backend/src/meeting-management.mjs';

async function harness({transcribe,recorderFails=false,stopBarrier,runtimeOverrides={},persistent=false}={}) {
  const directory=path.resolve(`artifacts/qa/recordings-unit-${randomUUID()}`);let now=Date.now();const peers=[],calls=[];
  const databasePath=path.join(directory,'auth.sqlite'),database=openAuthDatabase(persistent?databasePath:':memory:'),adapter=asyncDatabase(database),service=createMeetingService({NODE_ENV:'development',LIVEKIT_URL:'ws://127.0.0.1:7880',LIVEKIT_API_KEY:'recording-test-key',LIVEKIT_API_SECRET:'recording-test-secret-at-least-32-chars'});
  service.admin={listParticipants:async()=>peers,sendData:async()=>{},removeParticipant:async(_room,id)=>{const i=peers.findIndex(p=>p.identity===id);if(i>=0)peers.splice(i,1);},updateParticipant:async()=>{},deleteRoom:async()=>{peers.length=0;}};
  const storage=createRecordingStorage({RECORDING_LOCAL_PATH:directory});
  const runtime={configured:true,name:'Unit provider fixture',pauseSupported:false,transcriptionDelayMs:0,storage,recorder:{start:async options=>{calls.push(options);if(recorderFails)throw new Error('Unit provider rejection, not public');await fs.writeFile(options.outputPath,Buffer.from('UNIT-MEDIA-FIXTURE-NOT-REAL-RECORDING'));return{setAllowed:async()=>{},stop:async()=>{await stopBarrier;return{path:options.outputPath,mimeType:options.mode==='audio'?'audio/webm':'video/webm',durationMs:10000};},abort:async()=>{}};}},transcriber:{configured:true,transcribe:transcribe||(async()=>({language:'en',segments:[{start:1,end:3,text:'Unit transcript fixture — नमस्ते',speaker:null}]}))}};
  Object.assign(runtime,runtimeOverrides);
  const origin='http://localhost:3001';const app=createAuthApp({clientId:'recording-test.apps.googleusercontent.com',origins:[origin],database,now:()=>now,meetings:service,recordings:runtime,verifyCredential:async value=>JSON.parse(value)});
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}/api/auth/`;
  async function account(name){const jar=new Map();let csrf='';const raw=async(route,body,headers={})=>{const response=await fetch(base+route,{signal:AbortSignal.timeout(60000),method:body===undefined?'GET':'POST',headers:{Cookie:[...jar].map(([k,v])=>k+'='+v).join('; '),...(body===undefined?{}:{Origin:origin,'Content-Type':'application/json','X-CSRF-Token':csrf}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});for(const cookie of response.headers.getSetCookie()){const[k,v]=cookie.split(';')[0].split('=');jar.set(k,v);}return response;};const request=async(...args)=>{const response=await raw(...args);return{status:response.status,body:await response.json()};};const cfg=(await request('config')).body;csrf=cfg.csrfToken;const seconds=Math.floor(now/1000);const signed=await request('google',{credential:JSON.stringify({iss:'https://accounts.google.com',aud:'recording-test.apps.googleusercontent.com',sub:name,name,email:name+'@example.test',email_verified:true,nonce:cfg.nonce,iat:seconds,exp:seconds+3600})});assert.equal(signed.status,200);csrf=signed.body.csrfToken;await request('google/confirm',{});return{request,raw,id:signed.body.user.id,join:()=>request('meetings/talk-workshop/token',{displayName:name}),action:(action,target)=>request('meetings/talk-workshop/actions',{action,target})};}
  const connect=result=>{assert.equal(result.status,200);peers.push({identity:result.body.identity,permission:{canPublish:true,canSubscribe:true,canPublishData:true,canPublishSources:[1,2,3,4]}});};
  const wait=async predicate=>{for(let i=0;i<100;i++){if(await predicate())return;await new Promise(r=>setTimeout(r,20));}assert.fail('Timed out waiting for fixture background work.');};
  return{account,connect,peers,calls,database,databasePath,storage,service,runtime,app,wait,now:()=>now,advance:ms=>{now+=ms;},tick:()=>adapter.withContext(()=>app.locals.recordings.tick()),close:async()=>{await app.locals.closeAuthDatabase();server.closeAllConnections();await new Promise(r=>server.close(r));database.close();if(directory.startsWith(path.resolve('artifacts/qa')+path.sep))await fs.rm(directory,{recursive:true,force:true});}};
}
const prefix='meetings/talk-workshop/recordings';
async function setup(h){const host=await h.account('Host'),member=await h.account('Member');assert.equal((await host.request('meetings/talk-workshop/create',{approvalRequired:false})).status,201);h.connect(await host.join());h.connect(await member.join());return{host,member};}
async function request(h,host,mode='audio'){const value=await host.request(prefix+'/request',{mode,language:'en',retentionDays:7});assert.equal(value.status,202);return value.body.id;}
async function start(h,host,member,id){await host.request(prefix+'/'+id+'/consent',{accept:true});await member.request(prefix+'/'+id+'/consent',{accept:true});assert.equal((await host.request(prefix+'/'+id+'/start',{})).status,202);await h.wait(()=>h.database.prepare('SELECT status FROM talk_recordings WHERE id=?').get(id).status==='recording');}

test('a stale transcription worker cannot overwrite a job reclaimed by another worker',async t=>{let release,started=false;const barrier=new Promise(resolve=>{release=resolve;});const h=await harness({transcribe:async()=>{started=true;await barrier;return{language:'en',segments:[{start:0,end:1,text:'stale result',speaker:null}]};}});t.after(async()=>{release();await h.close();});const{host,member}=await setup(h),id=await request(h,host);await start(h,host,member,id);await host.request(prefix+'/'+id+'/stop',{});await h.wait(()=>h.database.prepare('SELECT status FROM talk_recordings WHERE id=?').get(id).status==='completed');await h.tick();await h.wait(()=>started);h.database.prepare("UPDATE talk_recording_jobs SET lease_owner='another-worker',lease_expires_at=? WHERE recording_id=?").run(Date.now()+120000,id);release();await h.wait(()=>h.database.prepare("SELECT 1 FROM talk_recording_events WHERE recording_id=? AND action='stale_transcription_discarded'").get(id));assert.equal(h.database.prepare('SELECT COUNT(*) AS n FROM talk_transcript_segments WHERE recording_id=?').get(id).n,0);assert.equal(h.database.prepare('SELECT lease_owner FROM talk_recording_jobs WHERE recording_id=?').get(id).lease_owner,'another-worker');assert.equal(h.database.prepare('SELECT transcript_status FROM talk_recordings WHERE id=?').get(id).transcript_status,'processing');});

test('recording finalization survives completion of the initiating HTTP request',async t=>{let release;const stopBarrier=new Promise(resolve=>{release=resolve;});const h=await harness({stopBarrier});t.after(async()=>{release();await h.close();});const{host,member}=await setup(h),id=await request(h,host);await start(h,host,member,id);let timer;try{const response=await Promise.race([host.request(prefix+'/'+id+'/stop',{}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Stop HTTP request waited for encoder flush')),5000);})]);assert.equal(response.status,202);assert.equal(h.database.prepare('SELECT status FROM talk_recordings WHERE id=?').get(id).status,'stopping');}finally{clearTimeout(timer);release();}await h.wait(()=>h.database.prepare('SELECT status FROM talk_recordings WHERE id=?').get(id).status==='completed');});

test('a rejected capture worker clears active state and returns a sanitized, recoverable host error',async t=>{const h=await harness({recorderFails:true});t.after(h.close);const{host,member}=await setup(h),id=await request(h,host);await host.request(prefix+'/'+id+'/consent',{accept:true});await member.request(prefix+'/'+id+'/consent',{accept:true});assert.equal((await host.request(prefix+'/'+id+'/start',{})).status,202);await h.wait(()=>h.database.prepare('SELECT status FROM talk_recordings WHERE id=?').get(id).status==='failed');const state=(await host.request('meetings/talk-workshop/recording-state')).body;assert.equal(state.active,null);assert.equal(state.lastFailure.id,id);assert.doesNotMatch(state.lastFailure.error,/Unit provider/);assert.equal(h.database.prepare("SELECT COUNT(*) AS n FROM talk_recording_events WHERE recording_id=? AND action='capture_failed'").get(id).n,1);});

test('bundle preparation failure is explicit and a later recording can recover',async t=>{
  const h=await harness();t.after(h.close);const{host,member}=await setup(h),id=await request(h,host);
  const original=h.runtime.recorder.start;
  h.runtime.recorder.start=async()=>{const failure=new Error('Private compiler details');failure.code='recording_bundle_failed';throw failure;};
  await host.request(prefix+'/'+id+'/consent',{accept:true});await member.request(prefix+'/'+id+'/consent',{accept:true});await host.request(prefix+'/'+id+'/start',{});
  await h.wait(()=>h.database.prepare('SELECT status FROM talk_recordings WHERE id=?').get(id).status==='failed');
  const status=(await host.request('meetings/talk-workshop/recording-state')).body;
  assert.match(status.lastFailure.error,/recording:prepare/);assert.doesNotMatch(status.lastFailure.error,/Private compiler/);
  assert.equal((await host.request('meeting-history/talk-workshop')).body.recordings[0].status,'failed');
  h.runtime.recorder.start=original;const next=await request(h,host);await start(h,host,member,next);await host.request(prefix+'/'+next+'/stop',{});
  await h.wait(()=>h.database.prepare('SELECT status FROM talk_recordings WHERE id=?').get(next).status==='completed');
});

test('Processing stays visible and private until file persistence is verified',async t=>{
  const h=await harness();t.after(h.close);const{host,member}=await setup(h),id=await request(h,host);await start(h,host,member,id);
  let release;const barrier=new Promise(resolve=>{release=resolve;}),commit=h.runtime.storage.commit;
  h.runtime.storage.commit=async(...args)=>{await barrier;return commit(...args);};
  try{
    await host.request(prefix+'/'+id+'/stop',{});await h.wait(()=>h.database.prepare('SELECT status FROM talk_recordings WHERE id=?').get(id).status==='processing');
    const status=(await host.request('meetings/talk-workshop/recording-state')).body;
    assert.equal(status.latest.status,'processing');assert.equal(status.active,null);
    assert.equal((await host.raw('recordings/'+id+'/playback')).status,409);
    assert.equal((await member.request('meetings/talk-workshop/recording-state')).body.latest,null);
  }finally{release();}
  await h.wait(()=>h.database.prepare('SELECT status FROM talk_recordings WHERE id=?').get(id).status==='completed');
  assert.equal((await host.request('meetings/talk-workshop/recording-state')).body.latest.status,'completed');
});

test('missing persisted media never reports Ready even after storage commit acknowledges',async t=>{
  const h=await harness();t.after(h.close);const{host,member}=await setup(h),id=await request(h,host);await start(h,host,member,id);
  h.runtime.storage.commit=async()=>({key:h.storage.keyFor(id),bytes:123,mimeType:'video/webm'});
  await host.request(prefix+'/'+id+'/stop',{});await h.wait(()=>h.database.prepare('SELECT status FROM talk_recordings WHERE id=?').get(id).status==='failed');
  assert.equal((await host.raw('recordings/'+id+'/playback')).status,409);
  assert.equal((await host.request('meeting-history')).body.meetings[0].recordingCount,0);
});

test('repeated stop actions and provider callbacks finalize a segment and queue transcription only once',async t=>{const h=await harness();t.after(h.close);const{host,member}=await setup(h),id=await request(h,host);await start(h,host,member,id);await Promise.all([host.request(prefix+'/'+id+'/stop',{}),host.request(prefix+'/'+id+'/stop',{}),h.calls[0].onFailure('recorder_failed')]);assert.equal(h.database.prepare('SELECT status FROM talk_recordings WHERE id=?').get(id).status,'completed');assert.equal(h.database.prepare("SELECT COUNT(*) AS n FROM talk_recording_events WHERE recording_id=? AND action='capture_completed'").get(id).n,1);assert.equal(h.database.prepare("SELECT COUNT(*) AS n FROM talk_recording_jobs WHERE recording_id=? AND kind='transcribe'").get(id).n,1);});

test('an account outside the meeting cannot stop active capture by submitting a consent decline',async t=>{const h=await harness();t.after(h.close);const{host,member}=await setup(h),id=await request(h,host);await start(h,host,member,id);const outsider=await h.account('Outsider');await outsider.request(prefix+'/'+id+'/consent',{accept:true});await outsider.request(prefix+'/'+id+'/consent',{accept:false});assert.equal(h.database.prepare('SELECT status FROM talk_recordings WHERE id=?').get(id).status,'recording');assert.equal((await outsider.request(prefix+'/'+id+'/stop',{})).status,404);});

test('an expired capture lease fails closed and cleans the unfinished private file',async t=>{const h=await harness();t.after(h.close);const{host}=await setup(h),id=await request(h,host);const output=await h.storage.allocate(id);await fs.writeFile(output,'UNFINISHED FIXTURE');h.database.prepare("UPDATE talk_recordings SET status='recording',worker_id='lost-worker',lease_expires_at=?,output_path=? WHERE id=?").run(1,output,id);await h.tick();assert.equal(h.database.prepare('SELECT status FROM talk_recordings WHERE id=?').get(id).status,'failed');await assert.rejects(fs.stat(output));assert.equal((await host.raw('recordings/'+id+'/playback')).status,409);});

test('a third crashed transcription attempt cannot be reclaimed indefinitely',async t=>{const h=await harness();t.after(h.close);const{host}=await setup(h),id=await request(h,host);h.database.prepare("UPDATE talk_recordings SET status='completed',transcript_status='processing' WHERE id=?").run(id);h.database.prepare("INSERT INTO talk_recording_jobs(id,recording_id,kind,status,attempts,next_run_at,lease_owner,lease_expires_at,created_at,updated_at) VALUES (?,?,'transcribe','running',3,1,'lost-worker',1,1,1)").run(randomUUID(),id);await h.tick();assert.equal(h.database.prepare('SELECT status FROM talk_recording_jobs WHERE recording_id=?').get(id).status,'failed');assert.equal(h.database.prepare('SELECT transcript_status FROM talk_recordings WHERE id=?').get(id).transcript_status,'failed');});

test('authorized transcript regeneration changes spoken language, preserves old revision and rejects duplicate jobs',async t=>{
  const languages=[];
  const h=await harness({transcribe:async({language})=>{languages.push(language);return{language,segments:[{start:0,end:1,text:'Fixture '+language,speaker:null}]};}});t.after(h.close);
  const{host,member}=await setup(h),id=await request(h,host);await start(h,host,member,id);await host.request(prefix+'/'+id+'/stop',{});
  await h.wait(()=>h.database.prepare('SELECT status FROM talk_recordings WHERE id=?').get(id).status==='completed');await h.tick();
  await h.wait(()=>h.database.prepare('SELECT transcript_status FROM talk_recordings WHERE id=?').get(id).transcript_status==='completed');
  const previous=h.database.prepare('SELECT * FROM talk_transcript_revisions WHERE recording_id=?').get(id);
  assert.equal((await member.request('recordings/'+id+'/retry-transcript',{language:'hi'})).status,404);
  assert.equal((await host.request('recordings/'+id+'/retry-transcript',{language:'es'})).status,400);
  const replies=await Promise.all([host.request('recordings/'+id+'/retry-transcript',{language:'hi'}),host.request('recordings/'+id+'/retry-transcript',{language:'hi'})]);
  assert.deepEqual(replies.map(r=>r.status).sort(),[202,409]);await h.tick();
  await h.wait(()=>h.database.prepare('SELECT transcript_status FROM talk_recordings WHERE id=?').get(id).transcript_status==='completed');
  assert.equal(languages.at(-1),'hi');assert.equal(h.database.prepare('SELECT language FROM talk_recordings WHERE id=?').get(id).language,'hi');
  assert.equal(h.database.prepare('SELECT content_hash FROM talk_transcript_revisions WHERE id=?').get(previous.id).content_hash,previous.content_hash);
  assert.equal(h.database.prepare('SELECT COUNT(*) AS n FROM talk_transcript_revisions WHERE recording_id=?').get(id).n,2);
  assert.equal(h.database.prepare("SELECT COUNT(*) AS n FROM talk_recording_jobs WHERE recording_id=? AND kind='transcribe'").get(id).n,1);
});

test('recording authorization, explicit consent, late-join gating and unprivileged privacy are enforced',async t=>{const h=await harness();t.after(h.close);const{host,member}=await setup(h);assert.equal((await member.request(prefix+'/request',{mode:'audio',language:'en',retentionDays:7,role:'host'})).status,404);const id=await request(h,host);assert.equal(h.calls.length,0);assert.equal((await host.request(prefix+'/'+id+'/start',{})).status,409);await host.request(prefix+'/'+id+'/consent',{accept:true});await member.request(prefix+'/'+id+'/consent',{accept:false});assert.equal((await host.request(prefix+'/'+id+'/start',{})).status,409);assert.equal((await member.request('meetings/talk-workshop/recording-state')).body.consent.decision,'declined');assert.equal((await member.request('meeting-history/talk-workshop')).status,404);const late=await h.account('Late');assert.equal((await late.join()).body.error,'recording_consent_required');const notice=(await late.request('meetings/talk-workshop/recording-state')).body;assert.equal(notice.canManage,false);assert.equal(notice.consent.pending,undefined);await late.request(prefix+'/'+id+'/consent',{accept:true});assert.equal((await late.join()).status,200);await start(h,host,member,id);assert.equal(h.calls.length,1);assert.equal(h.calls[0].allowedIdentities.length,2);assert.equal((await member.request('recordings/'+id+'/transcript')).status,404);});

test('completed segments have private Range playback, asynchronous transcript/TXT/PDF and durable deletion',async t=>{const h=await harness();t.after(h.close);const{host,member}=await setup(h),id=await request(h,host,'video');await start(h,host,member,id);assert.equal((await host.request(prefix+'/'+id+'/stop',{})).status,202);await h.wait(()=>h.database.prepare('SELECT status FROM talk_recordings WHERE id=?').get(id).status==='completed');assert.equal(h.database.prepare('SELECT status FROM talk_recordings WHERE id=?').get(id).status,'completed');const partial=await host.raw('recordings/'+id+'/playback',undefined,{Range:'bytes=0-3'});assert.equal(partial.status,206);assert.equal((await partial.arrayBuffer()).byteLength,4);assert.match(partial.headers.get('Cache-Control'),/no-store/);assert.equal((await member.raw('recordings/'+id+'/playback')).status,404);assert.equal((await host.raw('recordings/'+id+'/playback',undefined,{Range:'bytes=999-1000'})).status,416);await h.tick();await h.wait(()=>h.database.prepare('SELECT transcript_status FROM talk_recordings WHERE id=?').get(id).transcript_status==='completed');const transcript=(await host.request('recordings/'+id+'/transcript')).body;assert.equal(transcript.segments[0].speaker,null);assert.match(transcript.segments[0].text,/नमस्ते/);const txt=await host.raw('recordings/'+id+'/transcript.txt');assert.match(await txt.text(),/00:00:01.*00:00:03/);const pdf=await host.raw('recordings/'+id+'/transcript.pdf');assert.equal(pdf.status,200);assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0,4).toString(),'%PDF');assert.equal((await host.request('meeting-history')).body.meetings[0].recordingCount,1);const key=h.database.prepare('SELECT storage_key FROM talk_recordings WHERE id=?').get(id).storage_key;assert.equal((await host.request('recordings/'+id+'/delete',{})).status,202);assert.equal((await host.raw('recordings/'+id+'/playback')).status,404);await h.tick();await h.wait(async()=>!await h.storage.exists(key));assert.equal(h.database.prepare('SELECT COUNT(*) AS n FROM talk_transcript_segments WHERE recording_id=?').get(id).n,0);});

test('consent withdrawal stops capture and each new segment requires fresh consent; co-host revocation removes private access',async t=>{const h=await harness();t.after(h.close);const{host,member}=await setup(h),id=await request(h,host);await start(h,host,member,id);assert.equal((await member.request(prefix+'/'+id+'/consent',{accept:false})).status,202);await h.wait(()=>h.database.prepare('SELECT status FROM talk_recordings WHERE id=?').get(id).status==='completed');assert.equal(h.database.prepare('SELECT status FROM talk_recordings WHERE id=?').get(id).status,'completed');const next=await request(h,host);assert.notEqual(next,id);assert.equal((await host.request(prefix+'/'+next+'/start',{})).status,409);await host.action('cohost_add',member.id);assert.equal((await member.request('meeting-history/talk-workshop')).status,200);await host.action('cohost_remove',member.id);assert.equal((await member.request('meeting-history/talk-workshop')).status,404);assert.ok(h.database.prepare("SELECT 1 FROM talk_recording_events WHERE recording_id=? AND action='consent_declined'").get(id));});

test('failed transcription retries persist and retention revokes access before deleting private files',async t=>{let attempts=0;const h=await harness({transcribe:async()=>{attempts++;throw new Error('Fixture failure');}});t.after(h.close);const{host,member}=await setup(h),id=await request(h,host);await start(h,host,member,id);await host.request(prefix+'/'+id+'/stop',{});await h.wait(()=>h.database.prepare('SELECT status FROM talk_recordings WHERE id=?').get(id).status==='completed');for(let i=0;i<3;i++){await h.tick();await h.wait(()=>h.database.prepare('SELECT status FROM talk_recording_jobs WHERE recording_id=?').get(id).status!=='running');h.advance(60000);}assert.equal(attempts,3);assert.equal(h.database.prepare('SELECT transcript_status FROM talk_recordings WHERE id=?').get(id).transcript_status,'failed');const key=h.database.prepare('SELECT storage_key FROM talk_recordings WHERE id=?').get(id).storage_key;h.advance(8*86400000);await h.tick();assert.equal(h.database.prepare('SELECT status FROM talk_recordings WHERE id=?').get(id).status,'deleted');await h.wait(async()=>!await h.storage.exists(key));});

test('recording mutations reject CSRF and Origin spoofing; file keys cannot escape private storage',async t=>{const h=await harness();t.after(h.close);const{host}=await setup(h);assert.equal((await host.request(prefix+'/request',{mode:'audio'},{'X-CSRF-Token':'invalid'})).status,403);assert.equal((await host.request(prefix+'/request',{mode:'audio'},{Origin:'https://attacker.invalid'})).status,403);await assert.rejects(h.storage.localPath('../../.env.local'));await assert.rejects(h.storage.discard(path.resolve('.env.local')));assert.equal((await host.request(prefix+'/request',{mode:'audio',language:'en',retentionDays:99999})).status,400);});

test('a capture that never finishes startup is aborted and cannot strand Starting',async t=>{
  let aborted=false;
  const h=await harness({runtimeOverrides:{startTimeoutMs:30,recorder:{start:async({signal})=>{signal.addEventListener('abort',()=>{aborted=true;},{once:true});return new Promise(()=>{});}}}});t.after(h.close);
  const{host,member}=await setup(h),id=await request(h,host);
  await host.request(prefix+'/'+id+'/consent',{accept:true});await member.request(prefix+'/'+id+'/consent',{accept:true});
  assert.equal((await host.request(prefix+'/'+id+'/start',{})).status,202);
  await h.wait(()=>h.database.prepare('SELECT status FROM talk_recordings WHERE id=?').get(id).status==='failed');
  assert.equal(aborted,true);assert.equal((await host.request('meetings/talk-workshop/recording-state')).body.active,null);
});

test('bounded encoder finalization fails safely instead of leaving Stopping indefinitely',async t=>{
  const h=await harness({stopBarrier:new Promise(()=>{}),runtimeOverrides:{stopTimeoutMs:30}});t.after(h.close);
  const{host,member}=await setup(h),id=await request(h,host);await start(h,host,member,id);
  assert.equal((await host.request(prefix+'/'+id+'/stop',{})).status,202);
  await h.wait(()=>h.database.prepare('SELECT status FROM talk_recordings WHERE id=?').get(id).status==='failed');
  assert.equal(h.database.prepare('SELECT error_code FROM talk_recordings WHERE id=?').get(id).error_code,'recording_timeout');
  // Failure status is persisted before asynchronous file cleanup completes.
  // Wait for that cleanup instead of racing it on a busy Windows filesystem.
  await h.wait(async()=>{try{await fs.stat(h.calls[0].outputPath);return false;}catch(error){return error.code==='ENOENT';}});
  await assert.rejects(fs.stat(h.calls[0].outputPath));
});

test('a late storage acknowledgement cannot revive a timed-out recording and is durably cleaned',async t=>{
  let release,uploaded=false,acknowledged=false;const barrier=new Promise(resolve=>{release=resolve;});
  const h=await harness({runtimeOverrides:{stopTimeoutMs:30}});t.after(async()=>{release();await h.close();});
  h.runtime.storage={...h.storage,commit:async(...args)=>{const value=await h.storage.commit(...args);uploaded=true;await barrier;acknowledged=true;return value;}};
  const{host,member}=await setup(h),id=await request(h,host);await start(h,host,member,id);await host.request(prefix+'/'+id+'/stop',{});
  await h.wait(()=>uploaded&&h.database.prepare('SELECT status FROM talk_recordings WHERE id=?').get(id).status==='failed');release();await h.wait(()=>acknowledged);
  await h.tick();await h.wait(async()=>!await h.storage.exists(h.storage.keyFor(id)));
  assert.equal(h.database.prepare('SELECT status FROM talk_recordings WHERE id=?').get(id).status,'failed');
  assert.equal(h.database.prepare("SELECT COUNT(*) AS n FROM talk_recording_events WHERE recording_id=? AND action='capture_completed'").get(id).n,0);
  assert.equal(h.database.prepare("SELECT COUNT(*) AS n FROM talk_recording_jobs WHERE recording_id=? AND kind='delete'").get(id).n,1);
});

test('a late failed upload acknowledgement re-arms deletion after an earlier cleanup already completed',async t=>{
  let release,uploading=false,objectExists=false,rejected=false;const barrier=new Promise(resolve=>{release=resolve;});
  const h=await harness({runtimeOverrides:{stopTimeoutMs:30}});t.after(async()=>{release();await h.close();});
  h.runtime.storage={...h.storage,commit:async()=>{uploading=true;await barrier;objectExists=true;rejected=true;throw new Error('Lost provider acknowledgement');},remove:async()=>{objectExists=false;}};
  const{host,member}=await setup(h),id=await request(h,host);await start(h,host,member,id);await host.request(prefix+'/'+id+'/stop',{});
  await h.wait(()=>uploading&&h.database.prepare('SELECT status FROM talk_recordings WHERE id=?').get(id).status==='failed');
  await h.tick();await h.wait(()=>h.database.prepare("SELECT status FROM talk_recording_jobs WHERE recording_id=? AND kind='delete'").get(id).status==='completed');
  release();await h.wait(()=>rejected&&h.database.prepare("SELECT status FROM talk_recording_jobs WHERE recording_id=? AND kind='delete'").get(id).status==='queued');
  assert.equal(objectExists,true);await h.tick();await h.wait(()=>!objectExists);
  assert.equal(h.database.prepare('SELECT status FROM talk_recordings WHERE id=?').get(id).status,'failed');
});

test('a stalled speech process reaches its deadline, records retry metadata and cannot strand Processing',async t=>{
  let aborted=false;
  const h=await harness({runtimeOverrides:{transcriptionTimeoutMs:30},transcribe:async({signal})=>{signal.addEventListener('abort',()=>{aborted=true;},{once:true});return new Promise(()=>{});}});t.after(h.close);
  const{host,member}=await setup(h),id=await request(h,host);await start(h,host,member,id);await host.request(prefix+'/'+id+'/stop',{});
  await h.wait(()=>h.database.prepare('SELECT status FROM talk_recordings WHERE id=?').get(id).status==='completed');await h.tick();
  await h.wait(()=>h.database.prepare('SELECT error_code FROM talk_recording_jobs WHERE recording_id=?').get(id).error_code==='processing_failed');
  assert.equal(aborted,true);const value=(await host.request('recordings/'+id+'/transcript')).body;
  assert.equal(value.status,'queued');assert.equal(value.processing.attempt,1);assert.equal(value.processing.maxAttempts,3);assert.ok(value.processing.nextRetryAt>h.now());
  assert.equal(h.database.prepare("SELECT COUNT(*) AS n FROM talk_recording_events WHERE recording_id=? AND action='transcription_retry_scheduled'").get(id).n,1);
});

test('backend shutdown cancels active speech work promptly and leaves a durable retry',async t=>{
  let started=false;
  const h=await harness({transcribe:async()=>{started=true;return new Promise(()=>{});}});t.after(h.close);
  const{host,member}=await setup(h),id=await request(h,host);await start(h,host,member,id);await host.request(prefix+'/'+id+'/stop',{});
  await h.wait(()=>h.database.prepare('SELECT status FROM talk_recordings WHERE id=?').get(id).status==='completed');await h.tick();await h.wait(()=>started);
  await Promise.race([h.app.locals.recordings.shutdown(),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('Shutdown was blocked by speech worker')),1500);timer.unref();})]);
  assert.equal(h.database.prepare('SELECT status FROM talk_recording_jobs WHERE recording_id=?').get(id).status,'queued');
});

test('a backend without a speech model exposes Unavailable instead of repeatedly failing queued jobs',async t=>{
  const h=await harness();t.after(h.close);const{host,member}=await setup(h),id=await request(h,host);await start(h,host,member,id);await host.request(prefix+'/'+id+'/stop',{});
  await h.wait(()=>h.database.prepare('SELECT status FROM talk_recordings WHERE id=?').get(id).status==='completed');h.runtime.transcriber.configured=false;await h.tick();
  await h.wait(()=>h.database.prepare('SELECT transcript_status FROM talk_recordings WHERE id=?').get(id).transcript_status==='unavailable');
  const job=h.database.prepare('SELECT status,error_code,attempts FROM talk_recording_jobs WHERE recording_id=?').get(id);
  assert.equal(job.status,'failed');assert.equal(job.error_code,'not_configured');assert.equal(job.attempts,1);
  assert.equal((await host.request('recordings/'+id+'/retry-transcript',{})).status,503);
});

test('transcription capacity is enforced across service instances, not only a local process map',async t=>{
  let release,started=0;const barrier=new Promise(resolve=>{release=resolve;});
  const h=await harness({transcribe:async()=>{started++;await barrier;return{language:'en',segments:[]};}});t.after(async()=>{release();await h.close();});
  const{host,member}=await setup(h),id=await request(h,host);await start(h,host,member,id);await host.request(prefix+'/'+id+'/stop',{});
  await h.wait(()=>h.database.prepare('SELECT status FROM talk_recordings WHERE id=?').get(id).status==='completed');await h.tick();await h.wait(()=>started===1);
  const second=randomUUID();h.database.prepare("INSERT INTO talk_recordings(id,meeting_id,requested_by,mode,language,status,created_at,recorder_identity,expires_at,storage_key,duration_ms,transcript_status) SELECT ?,meeting_id,requested_by,mode,language,'completed',created_at,?,expires_at,storage_key,duration_ms,'queued' FROM talk_recordings WHERE id=?").run(second,'rec_'+second,id);
  h.database.prepare("INSERT INTO talk_recording_jobs(id,recording_id,kind,status,next_run_at,created_at,updated_at) VALUES (?,?,'transcribe','queued',1,1,1)").run(randomUUID(),second);
  const adapter=asyncDatabase(h.database),manager=createMeetingManagement({db:adapter,service:h.service,now:h.now});
  const sibling=createMeetingRecordings({db:adapter,service:h.service,manager,runtime:h.runtime,now:h.now});
  try{await sibling.tick();assert.equal(started,1);assert.equal(h.database.prepare('SELECT status FROM talk_recording_jobs WHERE recording_id=?').get(second).status,'queued');}
  finally{await sibling.shutdown();release();}
});

test('fresh backend and database handles recover persisted unfinished capture and speech jobs after restart',async t=>{
  const h=await harness({persistent:true});t.after(h.close);const{host}=await setup(h),capture=await request(h,host),speech=randomUUID();
  const partial=await h.storage.allocate(capture);await fs.writeFile(partial,'UNFLUSHED UNIT FIXTURE');
  h.database.prepare("UPDATE talk_recordings SET status='processing',worker_id='terminated-backend',lease_expires_at=NULL,output_path=? WHERE id=?").run(partial,capture);
  const output=await h.storage.allocate(speech);await fs.writeFile(output,'SAVED UNIT MEDIA FIXTURE');const stored=await h.storage.commit(speech,{path:output,mimeType:'audio/webm'});
  h.database.prepare("INSERT INTO talk_recordings(id,meeting_id,requested_by,mode,language,status,created_at,recorder_identity,expires_at,storage_key,duration_ms,transcript_status) VALUES (?,'talk-workshop',?,'audio','en','completed',?,?,?, ?,10000,'processing')").run(speech,host.id,h.now(),'rec_'+speech,h.now()+86400000,stored.key);
  h.database.prepare("INSERT INTO talk_recording_jobs(id,recording_id,kind,status,attempts,next_run_at,lease_owner,lease_expires_at,created_at,updated_at) VALUES (?,?,'transcribe','running',1,1,'terminated-backend',NULL,1,1)").run(randomUUID(),speech);
  await h.app.locals.recordings.shutdown();
  const reopened=openAuthDatabase(h.databasePath),adapter=asyncDatabase(reopened),manager=createMeetingManagement({db:adapter,service:h.service,now:h.now});
  const restarted=createMeetingRecordings({db:adapter,service:h.service,manager,runtime:h.runtime,now:h.now});
  try{
    await restarted.tick();assert.equal(reopened.prepare('SELECT status FROM talk_recordings WHERE id=?').get(capture).status,'failed');await assert.rejects(fs.stat(partial));
    // Delete cleanup has priority over CPU-heavy recognition.
    await h.wait(()=>reopened.prepare("SELECT status FROM talk_recording_jobs WHERE recording_id=? AND kind='delete'").get(capture)?.status==='completed');
    await restarted.tick();await h.wait(()=>reopened.prepare('SELECT transcript_status FROM talk_recordings WHERE id=?').get(speech).transcript_status==='completed');
    assert.equal(reopened.prepare('SELECT attempts FROM talk_recording_jobs WHERE recording_id=?').get(speech).attempts,2);
    assert.equal(reopened.prepare('SELECT COUNT(*) AS n FROM talk_transcript_segments WHERE recording_id=?').get(speech).n,1);
  }finally{await restarted.shutdown();reopened.close();}
});
