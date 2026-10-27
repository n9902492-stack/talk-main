import test from 'node:test';
import assert from 'node:assert/strict';
import {openPostgresDatabase} from '../backend/src/postgres-database.mjs';
import {calendarFixture} from './helpers/google-calendar.mjs';
import {secret} from '../backend/src/scheduling/service.mjs';
const enabled=process.env.TALK_POSTGRES_TEST==='1'&&process.env.PGHOST==='127.0.0.1'&&process.env.PGDATABASE==='talk_auth_test';
test('PostgreSQL Calendar migration, encrypted connection, job locking, reschedule/cancel and conflict cursor',{skip:!enabled},async t=>{
 const raw=await openPostgresDatabase(process.env,{migrate:true});t.after(()=>raw.close());
 const h=await calendarFixture({database:raw});await h.connect();await h.call(()=>h.g.connection.preferences(h.host,{autoCreate:true,remind15:true,remindDay:true,inviteGuests:false}));
 const {booking:b,input}=await h.book();await h.call(()=>h.g.worker.tick());
 const first=await h.call(()=>h.s.get('SELECT * FROM talk_calendar_events WHERE booking_id=?',b.id));assert.equal(first.status,'synced');
 const row=await h.call(()=>h.g.connection.row(h.host));assert.ok(!row.token_cipher.includes('fake'));
 await h.call(()=>h.g.incoming.check(h.host));assert.ok((await h.call(()=>h.g.connection.row(h.host))).sync_cipher);
 const next=secret();await h.call(()=>h.s.change(b.id,{action:'reschedule',version:1,credential:input.credential,newCredential:next,start:b.start+3600000}));await h.call(()=>h.g.worker.tick());
 assert.equal((await h.call(()=>h.s.get('SELECT event_id FROM talk_calendar_events WHERE booking_id=?',b.id))).event_id,first.event_id);
 assert.equal(Date.parse(h.provider.events.get(first.event_id).start.dateTime),b.start+3600000);
 await h.call(()=>h.s.change(b.id,{action:'cancel',version:2,credential:next}));await h.call(()=>h.g.worker.tick());assert.equal((await h.call(()=>h.s.get('SELECT status FROM talk_calendar_events WHERE booking_id=?',b.id))).status,'cancelled');
 await h.call(()=>h.g.connection.disconnect(h.host));assert.equal((await h.call(()=>h.g.connection.row(h.host))).token_cipher,null);
});
