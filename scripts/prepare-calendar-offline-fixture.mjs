import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {calendarFixture} from '../tests/helpers/google-calendar.mjs';
import {openAuthDatabase} from '../backend/src/database.mjs';
import {createEmailLinks} from '../backend/src/scheduling/email-links.mjs';
import {createScheduling} from '../backend/src/scheduling/service.mjs';
import {calendarInvitation} from '../backend/src/scheduling/calendar.mjs';

// Offline only. No listening socket, tunnel, SMTP adapter or real Google provider.
const parent=path.resolve('data/calendar-offline-test');mkdirSync(parent,{recursive:true});
execFileSync('git',['check-ignore','--quiet','data/calendar-offline-test/private.json'],{stdio:'pipe',windowsHide:true});
const dir=mkdtempSync(path.join(parent,'fixture-')),filename=path.join(dir,'talk.sqlite'),started=Date.now(),h=await calendarFixture({database:openAuthDatabase(filename),instant:started});
try{
 const slots=await h.call(()=>h.s.slots(h.event.id,{from:Math.ceil((started+3*3600000)/900000)*900000,to:started+2*86400000,timezone:'Asia/Kolkata'})),slot=slots.slots[0];assert.ok(slot&&slot.start>=started+2*3600000);
 await h.connect();await h.call(()=>h.g.connection.preferences(h.host,{autoCreate:true,remind15:true,remindDay:false,inviteGuests:false}));
 const {booking:b}=await h.book(slot.start),linkSecret=randomBytes(32).toString('base64url'),links=createEmailLinks({baseUrl:'http://localhost:3001',secret:linkSecret}),url=links.inviteeUrl({id:b.id,version:b.version}),credential=new URL(url).hash.slice(1),raw=h.raw.prepare('SELECT b.*,o.starts_at,o.ends_at,o.meeting_id FROM scheduling_bookings b JOIN scheduling_occurrences o ON b.occurrence_id=o.id WHERE b.id=?').get(b.id);
 assert.equal(links.verify(raw,credential,b.end+3599999),true);assert.equal(links.verify(raw,credential,b.end+3600001),false);assert.equal(links.verify(raw,'A'.repeat(43),started),false);
 const s=createScheduling({db:h.db,now:()=>started,links});assert.equal((await h.call(()=>s.detail(b.id,credential))).booking.id,b.id);
 await h.call(()=>h.g.worker.tick());const remote=[...h.provider.events.values()][0],ics=calendarInvitation({...b,title:b.event.title});assert.equal(Date.parse(remote.start.dateTime),raw.starts_at);assert.equal(Date.parse(remote.end.dateTime),raw.ends_at);assert.equal(raw.ends_at-raw.starts_at,1800000);assert.equal(remote.start.timeZone,'Asia/Kolkata');
 const stamp=t=>new Date(t).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');assert.ok(ics.includes('DTSTART:'+stamp(raw.starts_at)));assert.ok(ics.includes('DTEND:'+stamp(raw.ends_at)));assert.equal(h.raw.prepare('SELECT COUNT(*) n FROM scheduling_bookings').get().n,1);
 // No real fixture credentials are printed or included in the public report.
 writeFileSync(path.join(dir,'private-invitation.json'),JSON.stringify({url,hostId:h.host,bookingId:b.id,linkSecret,calendarTokenKey:h.config.key}),{mode:0o600});
 writeFileSync(path.join(dir,'booking.ics'),ics,{mode:0o600});
 writeFileSync(path.join(dir,'mock-calendar-event.json'),JSON.stringify(remote,null,2),{mode:0o600});
 const report={passed:true,database:path.relative(process.cwd(),filename),bookingId:b.id,createdAt:new Date(started).toISOString(),timezone:'Asia/Kolkata',start:new Date(b.start).toISOString(),end:new Date(b.end).toISOString(),localStart:new Date(b.start).toLocaleString('en-GB',{timeZone:'Asia/Kolkata',dateStyle:'full',timeStyle:'short'}),localEnd:new Date(b.end).toLocaleTimeString('en-GB',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit'}),joiningOpens:new Date(b.start-900000).toISOString(),invitationExpires:new Date(b.end+3600000).toISOString(),futureByAtLeastTwoHours:true,bookingCount:1,icsMatches:true,mockEventMatches:true,externalEmails:0,externalCalendarCalls:0,publicExposure:false,validation:'PASS'};
 writeFileSync('artifacts/qa/calendar-fresh-fixture-results.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{h.close();}
