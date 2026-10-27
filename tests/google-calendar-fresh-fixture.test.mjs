import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {openAuthDatabase} from '../backend/src/database.mjs';
import {createEmailLinks} from '../backend/src/scheduling/email-links.mjs';
test('the single fresh offline booking survives reopening and its signed link, ICS and Calendar times agree',()=>{
 const report=JSON.parse(fs.readFileSync('artifacts/qa/calendar-fresh-fixture-results.json','utf8')),filename=path.resolve(report.database),dir=path.dirname(filename);
 assert.ok(filename.startsWith(path.resolve('data/calendar-offline-test')+path.sep));
 const privateFixture=JSON.parse(fs.readFileSync(path.join(dir,'private-invitation.json'),'utf8')),raw=openAuthDatabase(filename);
 try{const b=raw.prepare('SELECT b.*,o.starts_at,o.ends_at FROM scheduling_bookings b JOIN scheduling_occurrences o ON b.occurrence_id=o.id WHERE b.id=?').get(report.bookingId),remote=JSON.parse(fs.readFileSync(path.join(dir,'mock-calendar-event.json'),'utf8')),ics=fs.readFileSync(path.join(dir,'booking.ics'),'utf8'),url=new URL(privateFixture.url),links=createEmailLinks({baseUrl:url.origin,secret:privateFixture.linkSecret});
  assert.equal(raw.prepare('SELECT COUNT(*) n FROM scheduling_bookings').get().n,1);assert.equal(b.timezone,'Asia/Kolkata');assert.ok(b.starts_at-Date.parse(report.createdAt)>=2*3600000);assert.equal(b.ends_at-b.starts_at,1800000);
  assert.equal(links.verify(b,url.hash.slice(1),Date.now()),true);assert.equal(links.verify(b,url.hash.slice(1),b.ends_at+3599999),true);assert.equal(links.verify(b,url.hash.slice(1),b.ends_at+3600001),false);assert.equal(links.verify({...b,version:b.version+1},url.hash.slice(1),b.starts_at),false);
  assert.equal(raw.prepare('SELECT expires_at FROM scheduling_invitations WHERE booking_id=?').get(b.id).expires_at,b.ends_at+3600000);assert.equal(Date.parse(remote.start.dateTime),b.starts_at);assert.equal(Date.parse(remote.end.dateTime),b.ends_at);
  const stamp=t=>new Date(t).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');assert.ok(ics.includes('DTSTART:'+stamp(b.starts_at)));assert.ok(ics.includes('DTEND:'+stamp(b.ends_at)));assert.ok(!JSON.stringify(remote).includes(url.hash.slice(1)));assert.equal(remote.attendees,undefined);
  assert.equal(raw.prepare('SELECT status FROM talk_calendar_events WHERE booking_id=?').get(b.id).status,'synced');
 }finally{raw.close();}
});
