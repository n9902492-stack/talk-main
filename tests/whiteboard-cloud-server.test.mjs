import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';import os from 'node:os';import path from 'node:path';
import {whiteboardHarness,element,createEdit} from './helpers/whiteboard.mjs';
import {cloudFixture,diagram,response} from './helpers/cloud-fixture.mjs';
const input=(revision=0,extra={})=>({operation:'generate',prompt:'Synthetic architecture',sourceRevision:revision,selectedIds:[],...extra});
async function setup(t,options={},implementation){
  const f=cloudFixture(options,implementation),gate={enabled:true};
  const h=await whiteboardHarness({intelligence:{autoStart:false,cloudProvider:f.provider,cloudExecutionGate:()=>gate.enabled}});t.after(h.close);
  const host=await h.account('cloud-host');await host.create();await host.join();await host.board('/open',{});
  return {...f,h,host,gate};
}
async function preview(host,body=input()){const r=await host.board('/ai/cloud/preview',body);assert.equal(r.status,200,JSON.stringify(r.body));return r.body;}
const approval=t=>({id:t.id,proof:t.proof,payloadHash:t.payloadHash,confirm:true});
async function queued(host,body=input()){const ticket=await preview(host,body),r=await host.board('/ai/cloud/confirm',approval(ticket));assert.equal(r.status,202,JSON.stringify(r.body));return r.body;}

test('release gate blocks inference even with configured provider, user consent and later enablement',async t=>{
  const f=cloudFixture(),h=await whiteboardHarness({intelligence:{autoStart:false,cloudProvider:f.provider}});t.after(h.close);const host=await h.account('locked');await host.create();await host.join();await host.board('/open',{});
  const ticket=await preview(host);assert.equal(ticket.canConfirm,false);assert.equal((await host.board('/ai/cloud/confirm',approval(ticket))).status,503);
  assert.equal(h.database.prepare('SELECT COUNT(*) AS n FROM talk_whiteboard_ai_jobs').get().n,0);await h.app.locals.whiteboardIntelligence.tick();assert.equal(f.calls.length,0);
});
test('disabled-created approvals never become executable after a later server enable',async t=>{
  const {host,gate,calls,h}=await setup(t);gate.enabled=false;const ticket=await preview(host);gate.enabled=true;assert.equal((await host.board('/ai/cloud/confirm',approval(ticket))).status,503);await h.app.locals.whiteboardIntelligence.tick();assert.equal(calls.length,0);
});
test('mock diagram requires consent, previews before apply, native insertion is idempotent and undoable',async t=>{
  const {h,host,calls}=await setup(t);const ticket=await preview(host);assert.equal(calls.length,0);assert.equal((await host.board('/ai/cloud/confirm',{...approval(ticket),confirm:false})).status,409);
  const [first,second]=await Promise.all([host.board('/ai/cloud/confirm',approval(ticket)),host.board('/ai/cloud/confirm',approval(ticket))]);assert.equal(first.status,202);assert.equal(second.body.id,first.body.id);
  await h.app.locals.whiteboardIntelligence.tick();assert.equal(calls.length,1);const job=(await host.board('/ai/jobs/'+first.body.id)).body;assert.equal(job.mode,'cloud');assert.equal(job.status,'review_required');assert.equal(job.usage.total_tokens,150);assert.equal((await host.board()).body.elements.length,0);
  const payload={expectedVersion:job.version,currentRevision:0,placement:'new-area'};const apply=await host.board('/ai/jobs/'+job.id+'/apply',payload);assert.equal(apply.status,200);assert.ok(apply.body.changes.length>=3);assert.equal((await host.board('/ai/jobs/'+job.id+'/apply',payload)).body.revision,apply.body.revision);
  assert.equal((await host.board('/operations',{requestId:randomUUID(),undoRevision:apply.body.revision})).status,200);assert.equal((await host.board()).body.elements.length,0);
});
test('default scope never silently uses unrelated notes; image/recording/transcript/account data excluded',async t=>{
  const {host,calls}=await setup(t),one=element('sticky',{text:'TODO: review authentication'}),other=element('sticky',{text:'PRIVATE unrelated note'});await host.edit([createEdit(one),createEdit(other)]);
  assert.equal((await host.board('/ai/cloud/preview',input(1,{operation:'summarize'}))).status,413);
  const ticket=await preview(host,input(1,{operation:'summarize',selectedIds:[one.id]})),wire=JSON.stringify(ticket.exactPayload);assert.ok(wire.includes(one.text));assert.ok(!wire.includes(other.text));assert.ok(!wire.includes(host.id));assert.ok(!wire.includes('@example.test'));assert.equal(ticket.imagesIncluded,false);assert.equal(ticket.recordingsIncluded,false);assert.equal(ticket.transcriptsIncluded,false);assert.equal(calls.length,0);
  assert.equal((await host.board('/ai/cloud/preview',input(1,{operation:'summarize',scope:'all'}))).status,400);
  const full=await preview(host,input(1,{operation:'summarize',scope:'all',includeAll:true}));assert.equal(full.sourceCount,2);assert.ok(JSON.stringify(full.exactPayload).includes(other.text));
});
test('proof/session/payload tampering, consent expiry and cancelled approvals are rejected',async t=>{
  const {host,h,calls}=await setup(t);let ticket=await preview(host);
  for(const body of [{...approval(ticket),proof:'forged'},{...approval(ticket),payloadHash:'a'.repeat(64)}])assert.ok([403,409].includes((await host.board('/ai/cloud/confirm',body)).status));
  await host.board('/ai/cloud/cancel',{id:ticket.id,proof:ticket.proof});assert.equal((await host.board('/ai/cloud/confirm',approval(ticket))).status,409);
  ticket=await preview(host);h.advance(300001);assert.equal((await host.board('/ai/cloud/confirm',approval(ticket))).status,409);assert.equal(calls.length,0);
});
test('changed board or provider invalidates approval before queue and before execution',async t=>{
  const {host,h,provider,calls}=await setup(t);let ticket=await preview(host);await host.edit([createEdit(element())]);assert.equal((await host.board('/ai/cloud/confirm',approval(ticket))).status,409);
  ticket=await preview(host,input(1));provider.fingerprint='changed';assert.equal((await host.board('/ai/cloud/confirm',approval(ticket))).status,409);
  const job=await queued(host,input(1));provider.fingerprint='changed-again';await h.app.locals.whiteboardIntelligence.tick();assert.equal((await host.board('/ai/jobs/'+job.id)).body.status,'failed');assert.equal(calls.length,0);
});
test('queued jobs recheck enablement and authorization; client cannot bypass through local enqueue',async t=>{
  const {host,h,gate,calls}=await setup(t);const job=await queued(host);gate.enabled=false;await h.app.locals.whiteboardIntelligence.tick();assert.equal((await host.board('/ai/jobs/'+job.id)).body.status,'failed');assert.equal(calls.length,0);
  assert.equal((await host.board('/ai/generate',{...input(),requestId:randomUUID(),mode:'cloud',consent:true})).status,400);
});
test('waiting, removed, locked, view-only and cross-meeting users cannot approve or inspect cloud data',async t=>{
  const {host,h,calls}=await setup(t),viewer=await h.account('cloud-viewer');await viewer.join();const ticket=await preview(host);
  assert.equal((await viewer.board('/ai/cloud/preview',input())).status,403);assert.equal((await viewer.board('/ai/cloud/confirm',approval(ticket))).status,403);
  await host.action('approval_on');const waiter=await h.account('cloud-waiter');await waiter.join();assert.equal((await waiter.board('/ai/cloud/preview',input())).status,404);
  await host.action('remove',viewer.id);assert.equal((await viewer.board('/ai/cloud/preview',input())).status,404);
  const room=(await host.request('meetings',{title:'Other private room',approvalRequired:false})).body.meeting.id;await host.join(room);await host.board('/open',{},room);assert.equal((await host.board('/ai/cloud/confirm',approval(ticket),room)).status,403);
  assert.equal((await host.request('meetings/talk-workshop/whiteboard/ai/cloud/confirm',approval(ticket),{headers:{'X-CSRF-Token':'forged'}})).status,403);assert.equal(calls.length,0);
});
test('malformed/malicious/excessive schema fails safely; retries need fresh consent',async t=>{
  const {host,h,calls}=await setup(t,{},()=>response({...diagram,nodes:[{id:'bad',type:'image',text:'bad',src:'https://bad.example.com'}]}));const job=await queued(host);await h.app.locals.whiteboardIntelligence.tick();assert.equal((await host.board('/ai/jobs/'+job.id)).body.status,'failed');assert.equal((await host.board()).body.elements.length,0);assert.equal((await host.board('/ai/jobs/'+job.id+'/retry',{})).status,409);assert.equal(calls.length,1);
});
test('mock summaries cite exact selected sources with unknown owners/deadlines and separate review',async t=>{
  let note;const {host,h}=await setup(t,{},()=>response({schemaVersion:1,title:'Review',executive:[{text:note.text,sourceIds:[note.id]}],themes:[{title:'Follow-up',sourceIds:[note.id]}],actionIds:[note.id],decisionIds:[],blockerIds:[],questionIds:[],suggestions:[]}));
  note=element('sticky',{text:'TODO: review release checklist'});await host.edit([createEdit(note)]);const job=await queued(host,input(1,{operation:'summarize',selectedIds:[note.id]}));await h.app.locals.whiteboardIntelligence.tick();const complete=(await host.board('/ai/jobs/'+job.id)).body;assert.equal(complete.status,'review_required');assert.equal(complete.result.analysis.actions[0].owner,null);assert.equal(complete.result.analysis.actions[0].deadline,null);
  assert.equal((await host.board('/ai/jobs/'+job.id+'/review',{expectedVersion:complete.version,notes:'Manager checked',approved:true})).status,200);assert.equal((await host.board('/ai/jobs/'+job.id+'/export/txt')).status,200);
});
test('unsupported claims, invented decisions and paraphrased evidence are rejected',async t=>{
  let id;const {host,h}=await setup(t,{},()=>response({schemaVersion:1,title:'Review',executive:[{text:'Invented completion',sourceIds:[id]}],themes:[{title:'Tasks',sourceIds:[id]}],actionIds:[],decisionIds:[id],blockerIds:[],questionIds:[],suggestions:[]}));const note=element('sticky',{text:'A work note'});id=note.id;await host.edit([createEdit(note)]);const job=await queued(host,input(1,{operation:'cluster',selectedIds:[id]}));await h.app.locals.whiteboardIntelligence.tick();assert.equal((await host.board('/ai/jobs/'+job.id)).body.status,'failed');
});
test('per-user, per-meeting, concurrent limits and persistent estimated spend reservations',async t=>{
  const {host,h}=await setup(t,{maxRequestsPerUser:1});const job=await queued(host);assert.equal((await host.board('/ai/cloud/confirm',approval(await preview(host)))).status,429);await h.app.locals.whiteboardIntelligence.tick();await host.board('/ai/jobs/'+job.id+'/delete',{});assert.equal((await host.board('/ai/cloud/confirm',approval(await preview(host)))).status,429);assert.equal(h.database.prepare('SELECT COUNT(*) AS n FROM talk_whiteboard_ai_usage').get().n,1);
});
test('estimated budget fails closed without consuming ticket or creating jobs',async t=>{
  const {host,h}=await setup(t,{inputPricePerMillion:1,outputPricePerMillion:1,currency:'USD',estimatedSpendLimit:0.000001});const ticket=await preview(host);assert.ok(ticket.estimatedCost.microunits>1);assert.equal((await host.board('/ai/cloud/confirm',approval(ticket))).status,429);assert.equal(h.database.prepare('SELECT COUNT(*) AS n FROM talk_whiteboard_ai_jobs').get().n,0);
});
test('input-size rejection is a clear private 413 response before consent or queueing',async t=>{
  const {host,h,calls}=await setup(t,{maxInputTokens:256});const r=await host.board('/ai/cloud/preview',input());assert.equal(r.status,413);assert.equal(r.body.error,'cloud_input_limit');assert.match(r.body.message,/smaller prompt/);assert.equal(h.database.prepare('SELECT COUNT(*) AS n FROM talk_whiteboard_ai_approvals').get().n,0);assert.equal(calls.length,0);
});
test('cancelled and changed-source queued jobs do not dispatch; reservations clean up',async t=>{
  const {host,h,calls}=await setup(t);let job=await queued(host);await host.board('/ai/jobs/'+job.id+'/cancel',{});await h.app.locals.whiteboardIntelligence.tick();assert.equal(calls.length,0);assert.equal(h.database.prepare('SELECT status FROM talk_whiteboard_ai_usage WHERE job_id=?').get(job.id).status,'cancelled');
  job=await queued(host);await host.edit([createEdit(element())]);await h.app.locals.whiteboardIntelligence.tick();assert.equal(calls.length,0);assert.equal((await host.board('/ai/jobs/'+job.id)).body.status,'failed');
});
test('worker restart after uncertain send never resends or silently retries cloud inference',async t=>{
  const {host,h,calls}=await setup(t);const job=await queued(host);h.database.prepare("UPDATE talk_whiteboard_ai_usage SET status='sent',sent_at=? WHERE job_id=?").run(Date.now(),job.id);h.database.prepare("UPDATE talk_whiteboard_ai_jobs SET status='processing',claim_id='dead',claimed_at=?,attempts=1 WHERE id=?").run(Date.now()-150000,job.id);
  await h.app.locals.whiteboardIntelligence.tick();assert.equal(calls.length,0);assert.equal((await host.board('/ai/jobs/'+job.id)).body.status,'failed');assert.equal((await host.board('/ai/jobs/'+job.id+'/retry',{})).status,409);
});
test('SQLite approval/jobs/usage persistence and deletion retain only bounded content-free audit',async t=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'talk-cloud-')),file=path.join(dir,'isolated.sqlite'),f=cloudFixture();let h=await whiteboardHarness({databasePath:file,intelligence:{autoStart:false,cloudProvider:f.provider,cloudExecutionGate:()=>true}});
  t.after(async()=>{await h.close();rmSync(dir,{force:true,recursive:true});});let host=await h.account('persistent-cloud');await host.create();await host.join();await host.board('/open',{});const job=await queued(host);await h.close();h=await whiteboardHarness({databasePath:file,intelligence:{autoStart:false,cloudProvider:f.provider,cloudExecutionGate:()=>true}});host=await h.account('persistent-cloud');await h.app.locals.whiteboardIntelligence.tick();assert.equal((await host.board('/ai/jobs/'+job.id)).body.status,'review_required');
  await host.board('/manage',{action:'delete'});assert.equal(h.database.prepare('SELECT COUNT(*) AS n FROM talk_whiteboard_ai_approvals').get().n,0);assert.equal(h.database.prepare('SELECT COUNT(*) AS n FROM talk_whiteboard_ai_jobs').get().n,0);const ledger=h.database.prepare('SELECT * FROM talk_whiteboard_ai_usage').get();assert.equal('prompt'in ledger,false);assert.equal('wire_json'in ledger,false);
});
test('separate per-meeting and global concurrency limits serialize approvals from different users',async t=>{
  const {host,h}=await setup(t,{maxRequestsPerUser:10,maxRequestsPerMeeting:1,maxConcurrent:4}),editor=await h.account('second-editor');await editor.join();await host.board('/manage',{action:'permission',accountId:editor.id,canEdit:true});await queued(host);assert.equal((await editor.board('/ai/cloud/confirm',approval(await preview(editor)))).status,429);
});
test('global concurrency limit spans isolated meetings',async t=>{
  const {host}=await setup(t,{maxRequestsPerUser:10});await queued(host);const room=(await host.request('meetings',{title:'Second meeting',approvalRequired:false})).body.meeting.id;await host.join(room);await host.board('/open',{},room);const ticket=(await host.board('/ai/cloud/preview',input(),room)).body;assert.equal((await host.board('/ai/cloud/confirm',approval(ticket),room)).status,429);
});
test('permission revocation immediately before sending and during processing prevents publication',async t=>{
  let release;const wait=new Promise(resolve=>{release=resolve;});const {host,h,calls}=await setup(t,{},async()=>{await wait;return response();});
  const editor=await h.account('revoked-editor');await editor.join();await host.board('/manage',{action:'permission',accountId:editor.id,canEdit:true});const job=await queued(editor);const working=h.app.locals.whiteboardIntelligence.tick();
  while(!calls.length)await new Promise(r=>setTimeout(r,5));await host.board('/manage',{action:'permission',accountId:editor.id,canEdit:false});release();await working;assert.equal((await host.board('/ai/jobs/'+job.id)).body.status,'failed');assert.equal((await host.board()).body.elements.length,0);
});
test('provider timeout and cancellation leave a reviewable failure and never modify the canvas',async t=>{
  const {host,h}=await setup(t,{timeoutMs:100},async()=>new Promise(()=>{}));const job=await queued(host);await h.app.locals.whiteboardIntelligence.tick();assert.equal((await host.board('/ai/jobs/'+job.id)).body.status,'failed');assert.equal((await host.board()).body.elements.length,0);
});
test('cancelling an in-flight mock aborts transport and prevents applying late output',async t=>{
  const {host,h,calls}=await setup(t,{},request=>new Promise(resolve=>request.signal.addEventListener('abort',()=>resolve(response()),{once:true})));const job=await queued(host),working=h.app.locals.whiteboardIntelligence.tick();
  while(!calls.length)await new Promise(r=>setTimeout(r,5));const cancelled=await host.board('/ai/jobs/'+job.id+'/cancel',{});assert.equal(cancelled.body.status,'cancelled');await working;assert.equal((await host.board('/ai/jobs/'+job.id)).body.status,'cancelled');assert.equal((await host.board('/ai/jobs/'+job.id+'/apply',{expectedVersion:cancelled.body.version,currentRevision:0,placement:'new-area'})).status,409);assert.equal((await host.board()).body.elements.length,0);assert.equal(calls.length,1);
});
test('locked editor, revoked session and altered persisted payload cannot dispatch',async t=>{
  const {host,h,calls}=await setup(t),editor=await h.account('locked-editor');await editor.join();await host.board('/manage',{action:'permission',accountId:editor.id,canEdit:true});let job=await queued(editor);await host.board('/manage',{action:'lock'});await h.app.locals.whiteboardIntelligence.tick();assert.equal((await host.board('/ai/jobs/'+job.id)).body.status,'failed');await host.board('/manage',{action:'unlock'});
  job=await queued(host);h.database.prepare('UPDATE talk_whiteboard_ai_jobs SET prompt=? WHERE id=?').run('Tampered request',job.id);await h.app.locals.whiteboardIntelligence.tick();assert.equal((await host.board('/ai/jobs/'+job.id)).body.status,'failed');assert.equal(calls.length,0);
  job=await queued(editor);h.database.prepare('DELETE FROM sessions WHERE account_id=?').run(editor.id);await h.app.locals.whiteboardIntelligence.tick();assert.equal((await host.board('/ai/jobs/'+job.id)).body.status,'failed');assert.equal(calls.length,0);
});
