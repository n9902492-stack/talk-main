import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {whiteboardHarness,element,createEdit} from './helpers/whiteboard.mjs';
import {mkdtempSync,rmSync} from 'node:fs';import os from 'node:os';import path from 'node:path';
async function ready(h,person,options={}){const response=await person.board('/ai/'+(options.operation||'generate'),{requestId:randomUUID(),mode:'template',prompt:'Synthetic team plan',template:'swot',selectedIds:[],sourceRevision:(await person.board()).body.board.revision,consent:true,...options});assert.equal(response.status,202);await h.app.locals.whiteboardIntelligence.tick();const job=await person.board('/ai/jobs/'+response.body.id);assert.equal(job.body.status,'review_required');return job.body;}
async function setup(t,options){const h=await whiteboardHarness(options);t.after(h.close);const host=await h.account('intelligence-host');await host.create();await host.join();await host.board('/open',{});return {h,host};}
test('unconfigured AI is truthful; templates preview without mutation, apply once and undo atomically',async t=>{
  const {h,host}=await setup(t);const cap=await host.board('/ai/capabilities');assert.equal(cap.body.provider.configured,false);assert.equal(cap.body.handwriting.configured,false);
  assert.equal((await host.board('/ai/generate',{requestId:randomUUID(),mode:'ollama',prompt:'Plan',selectedIds:[],sourceRevision:0,consent:true})).status,503);
  const job=await ready(h,host);assert.equal((await host.board()).body.elements.length,0);
  const body={expectedVersion:job.version,currentRevision:0,placement:'new-area'},a=await host.board('/ai/jobs/'+job.id+'/apply',body);assert.equal(a.status,200);assert.ok(a.body.changes.length>10);
  assert.equal((await host.board('/ai/jobs/'+job.id+'/apply',body)).body.revision,a.body.revision);assert.equal((await host.board()).body.elements.length,a.body.changes.length);
  assert.equal((await host.board('/operations',{requestId:randomUUID(),undoRevision:a.body.revision})).status,200);assert.equal((await host.board()).body.elements.length,0);
});
test('waiting, view-only, removed and other-room users cannot generate, inspect or apply private proposals',async t=>{
  const {h,host}=await setup(t),view=await h.account('viewer'),outsider=await h.account('outsider');await view.join();const job=await ready(h,host);
  assert.equal((await outsider.board('/ai/jobs/'+job.id)).status,404);assert.equal((await view.board('/ai/jobs/'+job.id)).status,200);
  const second=await outsider.request('meetings',{title:'Another private board',approvalRequired:false}),room=second.body.meeting.id;await outsider.join(room);await outsider.board('/open',{},room);assert.equal((await outsider.board('/ai/jobs/'+job.id,undefined,room)).status,404);
  assert.equal((await view.board('/ai/jobs/'+job.id+'/apply',{expectedVersion:job.version,currentRevision:0,placement:'new-area'})).status,403);
  await host.action('remove',view.id);assert.equal((await view.board('/ai/jobs/'+job.id)).status,404);
});
test('source analysis, note organization and stale-note conflict preserve note IDs, text and collaborators work',async t=>{
  const {h,host}=await setup(t);const notes=[element('sticky',{text:'Rahul will complete payment API integration by Friday.'}),element('sticky',{text:'Decision: keep the UI design.'}),element('sticky',{text:'Login is blocked.'})];await host.edit(notes.map(createEdit));
  const job=await ready(h,host,{operation:'cluster',mode:'rules'});assert.equal(job.result.analysis.actions[0].owner,'Rahul');const before=(await host.board()).body;
  const applied=await host.board('/ai/jobs/'+job.id+'/apply',{expectedVersion:job.version,currentRevision:before.board.revision,placement:'organize'});assert.equal(applied.status,200);
  const after=(await host.board()).body;for(const n of notes)assert.equal(after.elements.find(e=>e.id===n.id).text,n.text);
  const stale=await ready(h,host,{operation:'summarize',mode:'rules'}),source=after.elements.find(e=>e.id===notes[0].id);await host.edit([{kind:'patch',id:source.id,expectedVersion:source.version,patch:{text:'Changed by collaborator'}}]);
  assert.equal((await host.board('/ai/jobs/'+stale.id+'/apply',{expectedVersion:stale.version,currentRevision:(await host.board()).body.board.revision,acknowledgeStale:true,placement:'organize'})).status,409);
});
test('explicit replacement confirmation, CSRF, cancellation, retry, review and private TXT export',async t=>{
  const {h,host}=await setup(t),note=element('sticky',{text:'TODO: review payment errors'});await host.edit([createEdit(note)]);const job=await ready(h,host,{selectedIds:[note.id]});
  assert.equal((await host.board('/ai/jobs/'+job.id+'/apply',{expectedVersion:job.version,currentRevision:1,placement:'replace'})).status,400);
  assert.equal((await host.request('meetings/talk-workshop/whiteboard/ai/jobs/'+job.id+'/cancel',{}, {headers:{'X-CSRF-Token':'forged'}})).status,403);
  assert.equal((await host.board('/ai/jobs/'+job.id+'/cancel',{})).body.status,'cancelled');
  const summary=await ready(h,host,{operation:'summarize',mode:'rules'});const reviewed=await host.board('/ai/jobs/'+summary.id+'/review',{expectedVersion:summary.version,notes:'Manager reviewed the source.',approved:true});assert.equal(reviewed.status,200);
  const txt=await host.board('/ai/jobs/'+summary.id+'/export/txt');assert.equal(txt.status,200);assert.match(txt.body.toString(),/Not specified/);assert.match(txt.body.toString(),/Manager reviewed/);
});
test('fixture provider schema is validated and permission revocation during inference discards output',async t=>{
  let release;const wait=new Promise(resolve=>{release=resolve;});
  const provider={configured:true,provider:'fixture',model:'fixture',generate:async()=>{await wait;return {schemaVersion:1,title:'Fixture',layout:'grid',nodes:[{id:'n',type:'sticky',text:'Test'}],edges:[]};}};
  const {h,host}=await setup(t,{intelligence:{autoStart:false,provider}}),editor=await h.account('editor');await editor.join();await host.board('/manage',{action:'permission',accountId:editor.id,canEdit:true});
  const queued=await editor.board('/ai/generate',{requestId:randomUUID(),mode:'ollama',prompt:'Synthetic fixture',selectedIds:[],sourceRevision:0,consent:true});assert.equal(queued.status,202);const working=h.app.locals.whiteboardIntelligence.tick();await new Promise(resolve=>setTimeout(resolve,40));await host.board('/manage',{action:'permission',accountId:editor.id,canEdit:false});release();await working;
  assert.equal((await host.board('/ai/jobs/'+queued.body.id)).body.status,'failed');assert.equal((await host.board()).body.elements.length,0);
});

test('queued and stale-claimed proposals recover from SQLite restart with private sources intact',async t=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'talk-board-ai-')),file=path.join(dir,'test.sqlite');let h=await whiteboardHarness({databasePath:file}),host=await h.account('restart-host');
  t.after(async()=>{await h.close();rmSync(dir,{recursive:true,force:true});});await host.create();await host.join();await host.board('/open',{});
  const requested=await host.board('/ai/generate',{requestId:randomUUID(),mode:'template',prompt:'Restart test',template:'architecture',selectedIds:[],sourceRevision:0,consent:true});
  h.database.prepare("UPDATE talk_whiteboard_ai_jobs SET status='processing',attempts=1,claim_id='dead-worker',claimed_at=? WHERE id=?").run(Date.now()-150000,requested.body.id);
  await h.close();h=await whiteboardHarness({databasePath:file});host=await h.account('restart-host');await h.app.locals.whiteboardIntelligence.tick();const restored=(await host.board('/ai/jobs/'+requested.body.id)).body;assert.equal(restored.status,'review_required');
  assert.equal((await host.board('/ai/jobs/'+restored.id+'/apply',{expectedVersion:restored.version,currentRevision:0,placement:'new-area'})).status,200);
  await host.board('/manage',{action:'delete'});assert.equal(h.database.prepare('SELECT COUNT(*) AS n FROM talk_whiteboard_ai_jobs').get().n,0);
});
test('cancelled jobs never apply, invalid model output fails safely and retries are bounded',async t=>{
  const provider={configured:true,provider:'fixture',model:'fixture',generate:async()=>({schemaVersion:1,title:'unsafe',layout:'grid',nodes:[{id:'n',type:'image',text:'Bad',imageId:'private'}],edges:[]})};
  const {h,host}=await setup(t,{intelligence:{provider,autoStart:false}});
  const input={requestId:randomUUID(),mode:'ollama',prompt:'Synthetic',selectedIds:[],sourceRevision:0,consent:true};const created=await host.board('/ai/generate',input);assert.equal((await host.board('/ai/generate',input)).body.id,created.body.id);
  assert.equal((await host.board('/ai/generate',{...input,prompt:'Changed'})).status,409);await h.app.locals.whiteboardIntelligence.tick();assert.equal((await host.board('/ai/jobs/'+created.body.id)).body.status,'failed');
  for(let i=0;i<2;i++){assert.equal((await host.board('/ai/jobs/'+created.body.id+'/retry',{})).status,200);await h.app.locals.whiteboardIntelligence.tick();}assert.equal((await host.board('/ai/jobs/'+created.body.id+'/retry',{})).status,409);
  const next=await host.board('/ai/generate',{...input,requestId:randomUUID()});await host.board('/ai/jobs/'+next.body.id+'/cancel',{});await h.app.locals.whiteboardIntelligence.tick();assert.equal((await host.board('/ai/jobs/'+next.body.id)).body.status,'cancelled');assert.equal((await host.board()).body.elements.length,0);
});
test('waiting-room isolation, host lock, explicit consent and bounded source selection',async t=>{
  const {h,host}=await setup(t);await host.action('approval_on');const waiting=await h.account('waiting');await waiting.join();assert.equal((await waiting.board('/ai/capabilities')).status,404);
  const payload={requestId:randomUUID(),mode:'template',prompt:'Synthetic',template:'swot',selectedIds:[],sourceRevision:0,consent:false};assert.equal((await host.board('/ai/generate',payload)).status,400);
  const member=await h.account('locked-member');await member.join();await host.action('admit',member.id);await host.board('/manage',{action:'default_edit',canEdit:true});await host.board('/manage',{action:'lock'});assert.equal((await member.board('/ai/generate',{...payload,consent:true})).status,403);
});
