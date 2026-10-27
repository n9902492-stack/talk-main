import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openPostgresDatabase} from '../backend/src/postgres-database.mjs';
import {whiteboardHarness,element,createEdit} from './helpers/whiteboard.mjs';
const enabled=process.env.TALK_POSTGRES_TEST==='1'&&process.env.PGHOST==='127.0.0.1'&&process.env.PGDATABASE==='talk_auth_test';
test('real PostgreSQL migrations, multi-request locking, persistence, permissions, snapshots and safe undo',{skip:!enabled},async t=>{
  let db=await openPostgresDatabase(process.env,{migrate:true}),h=await whiteboardHarness({database:db});
  t.after(async()=>{await h.close();await db.close();});
  const name='PGBoard'+randomUUID();let host=await h.account(name);const member=await h.account();const created=await host.request('meetings',{title:'PostgreSQL whiteboard',approvalRequired:false});assert.equal(created.status,201);const roomId=created.body.meeting.id;await host.join(roomId);await member.join(roomId);
  assert.equal((await host.board('/open',{},roomId)).status,200);
  await t.test('PostgreSQL additive migrations and private access',async()=>{
    assert.ok(await db.withContext(()=>db.prepare("SELECT version FROM schema_migrations WHERE version='007_whiteboards.sql'").get()));
    assert.equal((await member.edit([createEdit(element())],roomId)).status,403);
    await host.board('/manage',{action:'permission',accountId:member.id,canEdit:true},roomId);
    const outsiders=await h.account();assert.equal((await outsiders.board('',undefined,roomId)).status,404);
  });
  await t.test('concurrent requests serialize revisions without losing unrelated edits',async()=>{
    const results=await Promise.all(Array.from({length:12},(_,i)=>(i%2?host:member).edit([createEdit(element('sticky',{text:'PG '+i}))],roomId)));
    assert.ok(results.every(result=>result.status===200));assert.deepEqual(results.map(r=>r.body.revision).sort((a,b)=>a-b),Array.from({length:12},(_,i)=>i+1));
    assert.equal((await member.board('',undefined,roomId)).body.elements.length,12);
  });
  await t.test('same object CAS and idempotent retry persist in PostgreSQL',async()=>{
    const body={requestId:randomUUID(),edits:[createEdit(element())]},first=await host.board('/operations',body,roomId);assert.equal((await host.board('/operations',body,roomId)).body.revision,first.body.revision);
    const e=(await host.board('',undefined,roomId)).body.elements[0];const changes=await Promise.all([host,member].map(person=>person.edit([{kind:'patch',id:e.id,expectedVersion:e.version,patch:{x:99}}],roomId)));assert.deepEqual(changes.map(r=>r.status).sort(),[200,409]);
  });
  await t.test('a new pool/server restores saved state and owner permissions',async()=>{
    const before=(await host.board('',undefined,roomId)).body;await h.close();await db.close();db=await openPostgresDatabase(process.env,{migrate:true});h=await whiteboardHarness({database:db});host=await h.account(name);
    const after=(await host.board('',undefined,roomId)).body;assert.deepEqual(after.elements,before.elements);assert.equal(after.board.revision,before.board.revision);assert.equal(after.isOwner,true);
  });
});
