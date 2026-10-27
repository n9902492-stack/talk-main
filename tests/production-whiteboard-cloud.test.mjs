import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {openPostgresDatabase} from '../backend/src/postgres-database.mjs';
import {whiteboardHarness,element,createEdit} from './helpers/whiteboard.mjs';import {cloudFixture} from './helpers/cloud-fixture.mjs';
const enabled=process.env.TALK_POSTGRES_TEST==='1'&&process.env.PGHOST==='127.0.0.1'&&process.env.PGDATABASE==='talk_auth_test';
test('real PostgreSQL cloud consent, concurrent idempotency, usage persistence, native apply/undo and private deletion',{skip:!enabled},async t=>{
  const f=cloudFixture(),database=await openPostgresDatabase(process.env,{migrate:true}),h=await whiteboardHarness({database,intelligence:{autoStart:false,cloudProvider:f.provider,cloudExecutionGate:()=>true}});t.after(async()=>{await h.close();await database.close();});
  const host=await h.account('pg-cloud-'+randomUUID()),room=(await host.request('meetings',{title:'Cloud mock PG',approvalRequired:false})).body.meeting.id;await host.join(room);await host.board('/open',{},room);
  assert.ok(await database.withContext(()=>database.prepare("SELECT version FROM schema_migrations WHERE version='010_whiteboard_cloud.sql'").get()));
  const preview=await host.board('/ai/cloud/preview',{operation:'generate',prompt:'Synthetic diagram',sourceRevision:0,selectedIds:[]},room);assert.equal(preview.status,200);const p=preview.body,payload={id:p.id,proof:p.proof,payloadHash:p.payloadHash,confirm:true};
  const confirmations=await Promise.all([host.board('/ai/cloud/confirm',payload,room),host.board('/ai/cloud/confirm',payload,room)]);assert.ok(confirmations.every(r=>r.status===202),JSON.stringify(confirmations));assert.equal(confirmations[0].body.id,confirmations[1].body.id);
  const id=confirmations[0].body.id;await h.app.locals.whiteboardIntelligence.tick();const job=(await host.board('/ai/jobs/'+id,undefined,room)).body;assert.equal(job.status,'review_required');assert.equal(f.calls.length,1);
  const applied=await host.board('/ai/jobs/'+id+'/apply',{expectedVersion:job.version,currentRevision:0,placement:'new-area'},room);assert.equal(applied.status,200);assert.equal((await host.board('/operations',{requestId:randomUUID(),undoRevision:applied.body.revision},room)).status,200);
  await host.board('/ai/jobs/'+id+'/delete',{},room);const ledger=await database.withContext(()=>database.prepare('SELECT * FROM talk_whiteboard_ai_usage WHERE job_id=?').get(id));assert.equal(ledger.status,'completed');assert.equal(JSON.parse(ledger.usage_json).total_tokens,150);
  await host.board('/manage',{action:'delete'},room);assert.equal(Number((await database.withContext(()=>database.prepare('SELECT COUNT(*) AS n FROM talk_whiteboard_ai_approvals WHERE meeting_id=?').get(room))).n),0);
});
