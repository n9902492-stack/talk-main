import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {prepareBookingTest,refreshBookingTest} from '../backend/src/scheduling/booking-link-test.mjs';
import {createEmailLinks} from '../backend/src/scheduling/email-links.mjs';
import {prepareServedSchedulingEmailSmokeTest,restoreServedSchedulingEmailSmokeTest,dispatchPreparedSchedulingEmailSmokeTest} from '../backend/src/scheduling/email-smoke-test.mjs';

test('served restart restoration preserves the exact approved message and refuses tampering, past meetings and duplicate attempts',async()=>{
 const secret=randomBytes(32).toString('base64url'),baseUrl='https://synthetic.trycloudflare.com',recipient='guest@example.test',sender='sender@example.test';
 const fixture=await prepareBookingTest({root:process.cwd(),emails:['host@example.test',recipient],links:createEmailLinks({baseUrl,secret})});
 const parent=fs.mkdtempSync(path.resolve('artifacts/qa/served-restore-safety-'));
 const args={...fixture,recipient,sender,baseUrl,linkSecret:secret,configurationIdentity:'c'.repeat(64),outputRoot:parent,ledgerFilename:path.join(parent,'mock-attempt.sqlite'),managementEnabled:false};
 const prepared=prepareServedSchedulingEmailSmokeTest(args),options={...args,directory:prepared.directory};
 const restored=restoreServedSchedulingEmailSmokeTest({...options,now:Date.now()+5000});assert.equal(restored.review.requestFingerprint,prepared.review.requestFingerprint);
 assert.throws(()=>restoreServedSchedulingEmailSmokeTest({...options,configurationIdentity:'d'.repeat(64)}));
 assert.throws(()=>restoreServedSchedulingEmailSmokeTest({...options,now:prepared.review.startsAt}));
 const file=path.join(prepared.directory,'talk-booking.ics'),calendar=fs.readFileSync(file,'utf8');fs.appendFileSync(file,'tampered');assert.throws(()=>restoreServedSchedulingEmailSmokeTest(options));fs.writeFileSync(file,calendar);
 let calls=0;await dispatchPreparedSchedulingEmailSmokeTest(restored,{approval:{approved:true,fingerprint:prepared.review.requestFingerprint,recipient,joiningLinkVerified:true},configurationIdentity:args.configurationIdentity,send:async()=>{calls++;return {accepted:true};}});
 assert.equal(calls,1);assert.throws(()=>restoreServedSchedulingEmailSmokeTest(options));
});

test('served preview preserves DB, masks links, binds ICS and durably forbids duplicate mock sends',async()=>{
 const secret=randomBytes(32).toString('base64url'),baseUrl='https://synthetic.trycloudflare.com',recipient='guest@example.test',sender='sender@example.test';
 const fixture=await prepareBookingTest({root:process.cwd(),emails:['host@example.test',recipient],links:createEmailLinks({baseUrl,secret})});
 const parent=fs.mkdtempSync(path.resolve('artifacts/qa/served-preview-safety-'));
 const configurationIdentity='a'.repeat(64),args={...fixture,recipient,sender,baseUrl,linkSecret:secret,configurationIdentity,outputRoot:parent,ledgerFilename:path.join(parent,'mock-attempt.sqlite')};
 const digest=()=>createHash('sha256').update(fs.readFileSync(fixture.databasePath)).digest('hex'),before=digest();
 const prepared=prepareServedSchedulingEmailSmokeTest(args);
 assert.equal(digest(),before);assert.equal(prepared.review.attemptsConsumed,0);assert.equal(prepared.review.realEmailSent,false);
 assert.ok(prepared.review.text.includes('#[PRIVATE_BOOKING_CREDENTIAL]'));assert.match(fs.readFileSync(path.join(prepared.directory,'talk-booking.ics'),'utf8'),/BEGIN:VEVENT/);
 const privateMail=JSON.parse(fs.readFileSync(path.join(prepared.directory,'message.private.json')));
 assert.equal(privateMail.to,recipient);assert.equal(privateMail.sender,sender);assert.ok(!privateMail.text.includes('[PRIVATE_BOOKING_CREDENTIAL]'));
 assert.throws(()=>prepareServedSchedulingEmailSmokeTest({...args,recipient:'another@example.test'}));
 let calls=0;const send=async()=>{calls++;throw new Error('mock transport failure');};
 const approval={approved:true,fingerprint:prepared.review.requestFingerprint,recipient,joiningLinkVerified:true};
 await assert.rejects(dispatchPreparedSchedulingEmailSmokeTest(prepared,{approval:{...approval,approved:false},configurationIdentity,send}));assert.equal(calls,0);
 const result=await dispatchPreparedSchedulingEmailSmokeTest(prepared,{approval,configurationIdentity,send});assert.equal(result.attemptsConsumed,1);assert.equal(calls,1);
 await assert.rejects(dispatchPreparedSchedulingEmailSmokeTest(prepared,{approval,configurationIdentity,send}));assert.equal(calls,1);
 assert.throws(()=>prepareServedSchedulingEmailSmokeTest(args));
 const ledger=new DatabaseSync(args.ledgerFilename,{readOnly:true});try{assert.equal(ledger.prepare('SELECT consumed FROM email_smoke_attempts').get().consumed,1);}finally{ledger.close();}
});

test('future refresh retains prior booking, selects valid slot, is idempotent and gives full meeting-window link validity',async()=>{
 const baseUrl='https://synthetic.trycloudflare.com',secret=randomBytes(32).toString('base64url');
 const config={root:process.cwd(),emails:['host@example.test','guest@example.test'],links:createEmailLinks({baseUrl,secret})};
 const now=Date.now(),fixture=await prepareBookingTest(config,{now});
 const next=await refreshBookingTest(config,fixture,{now});assert.notEqual(next.bookingId,fixture.bookingId);
 const again=await refreshBookingTest(config,next,{now});assert.equal(again.bookingId,next.bookingId);
 const raw=new DatabaseSync(next.databasePath,{readOnly:true});let b;
 try{
  assert.equal(raw.prepare('SELECT COUNT(*) n FROM scheduling_bookings').get().n,2);
  assert.ok(raw.prepare('SELECT 1 ok FROM scheduling_bookings WHERE id=?').get(fixture.bookingId));
  b=raw.prepare('SELECT b.*,o.starts_at,o.ends_at FROM scheduling_bookings b JOIN scheduling_occurrences o ON o.id=b.occurrence_id WHERE b.id=?').get(next.bookingId);
  assert.ok(b.starts_at>=now+120*60000);assert.equal(b.ends_at-b.starts_at,30*60000);assert.equal(b.timezone,'Asia/Kolkata');
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM scheduling_jobs WHERE status!='cancelled'").get().n,0);
 }finally{raw.close();}
 const token=new URL(config.links.inviteeUrl(b)).hash.slice(1);
 for(const time of [now,b.starts_at,b.ends_at,b.ends_at+3600000])assert.equal(config.links.verify(b,token,time),true);
 assert.equal(config.links.verify(b,token,b.ends_at+3600001),false);
 const parent=fs.mkdtempSync(path.resolve('artifacts/qa/future-served-preview-safety-'));
 const prepared=prepareServedSchedulingEmailSmokeTest({...next,recipient:'guest@example.test',sender:'sender@example.test',baseUrl,linkSecret:secret,configurationIdentity:'b'.repeat(64),outputRoot:parent,ledgerFilename:path.join(parent,'mock-attempt.sqlite'),managementEnabled:false,now});
 assert.match(prepared.review.text,/Rescheduling and cancellation are unavailable/);assert.ok(!prepared.review.html.includes('action=reschedule'));assert.ok(!prepared.review.html.includes('action=cancel'));
 const stamp=t=>new Date(t).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
 const ics=fs.readFileSync(path.join(prepared.directory,'talk-booking.ics'),'utf8');
 assert.ok(ics.includes('DTSTART:'+stamp(b.starts_at)));assert.ok(ics.includes('DTEND:'+stamp(b.ends_at)));
 assert.equal(prepared.review.attemptsConsumed,0);
});
