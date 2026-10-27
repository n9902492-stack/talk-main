import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {openPostgresDatabase} from '../backend/src/postgres-database.mjs';import {whiteboardHarness,element,createEdit} from './helpers/whiteboard.mjs';
const enabled=process.env.TALK_POSTGRES_TEST==='1'&&process.env.PGHOST==='127.0.0.1'&&process.env.PGDATABASE==='talk_auth_test';
test('real PostgreSQL AI-proposal migration, source persistence, atomic apply/idempotency and undo',{skip:!enabled},async t=>{
  const database=await openPostgresDatabase(process.env,{migrate:true}),h=await whiteboardHarness({database});t.after(async()=>{await h.close();await database.close();});const host=await h.account('pg-intelligent-'+randomUUID());
  const created=await host.request('meetings',{title:'Private intelligent board',approvalRequired:false}),room=created.body.meeting.id;await host.join(room);await host.board('/open',{},room);
  assert.ok(await database.withContext(()=>database.prepare("SELECT version FROM schema_migrations WHERE version='009_whiteboard_ai.sql'").get()));
  const note=element('sticky',{text:'TODO: review the authentication tests'});await host.edit([createEdit(note)],room);
  const requested=await host.board('/ai/summarize',{requestId:randomUUID(),mode:'rules',prompt:'Team review',selectedIds:[note.id],sourceRevision:1,consent:true},room);assert.equal(requested.status,202);await h.app.locals.whiteboardIntelligence.tick();const job=(await host.board('/ai/jobs/'+requested.body.id,undefined,room)).body;assert.equal(job.status,'review_required');
  const body={expectedVersion:job.version,currentRevision:1,placement:'summary'};
  const results=await Promise.all([host.board('/ai/jobs/'+job.id+'/apply',body,room),host.board('/ai/jobs/'+job.id+'/apply',body,room)]);assert.ok(results.every(r=>r.status===200));assert.equal(results[0].body.revision,results[1].body.revision);
  assert.equal((await host.board('/operations',{requestId:randomUUID(),undoRevision:results[0].body.revision},room)).status,200);assert.equal((await host.board('',undefined,room)).body.elements.length,1);
});
