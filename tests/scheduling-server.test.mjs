import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {schedulingHarness} from './helpers/scheduling.mjs';import {secret,hash} from '../backend/src/scheduling/service.mjs';
async function setup(t,options){const h=await schedulingHarness(options);t.after(h.close);const host=await h.account('host-'+randomUUID()),guest=h.client(),slug='host-'+randomUUID();assert.equal((await host.request('scheduling/profile',{slug,timezone:'UTC',settings:{notice:0},windows:Array.from({length:7},(_,weekday)=>({weekday,start:0,end:1440}))})).status,200);const event=(await host.request('scheduling/events',{title:'Synthetic appointment',slug:'consult',duration:30,capacity:1,questions:[]})).body.event,form=(await guest.request('scheduling/form')).body.formToken;
 const req=(route,body)=>guest.request('scheduling/'+route,body,{'X-Scheduling-Token':form});const start=Math.ceil((h.now()+30*60000)/900000)*900000,credential=secret(),body={start,name:'Fictional Guest',email:'guest@example.test',timezone:'Asia/Kolkata',credential,answers:{}};return {h,host,guest,event,req,body,slug};}
test('real HTTP booking persistence, CSRF, owner isolation and ICS are enforced',async t=>{const f=await setup(t),{host,guest,event,req,body,h}=f;
 assert.equal((await guest.request('scheduling/profile',{})).status,401);assert.equal((await guest.request('scheduling/events/'+event.id+'/book',body)).status,403);
 const result=await req('events/'+event.id+'/book',body);assert.equal(result.status,201,JSON.stringify(result.body));const id=result.body.booking.id;
 assert.equal((await req('booking/'+id+'/detail',{credential:secret()})).status,404);const stranger=await h.account('stranger-'+randomUUID());assert.equal((await stranger.request('scheduling/host-booking/'+id)).status,404);
 const ics=await req('booking/'+id+'/calendar',{credential:body.credential});assert.equal(ics.status,200);assert.match(ics.body,/BEGIN:VEVENT/);assert.ok(!ics.body.includes(body.credential));assert.equal((await host.request('scheduling/dashboard')).body.bookings.length,1);
 assert.equal(h.raw.prepare('SELECT COUNT(*) AS n FROM scheduling_bookings').get().n,1);
 assert.equal((await guest.request('scheduling/events/'+event.id+'/book',body,{Origin:'https://untrusted.example','X-Scheduling-Token':(await guest.request('scheduling/form')).body.formToken})).status,403);
});
test('guest email proof, one-time redemption, waiting admission, tickets and private-resource denial',async t=>{const {h,host,guest,event,req,body}=await setup(t);const result=await req('events/'+event.id+'/book',body),id=result.body.booking.id,meeting=result.body.booking.meetingId;
 assert.equal((await req('booking/'+id+'/code',{credential:body.credential})).status,403);h.advance(body.start-h.now()-14*60000);
 assert.equal((await req('booking/'+id+'/code',{credential:body.credential})).status,200);assert.equal(h.codes.length,1);
 assert.equal((await req('booking/'+id+'/redeem',{credential:body.credential,code:'invalid'})).status,403);assert.equal(h.raw.prepare('SELECT attempts FROM scheduling_invitations').get().attempts,1);
 const redeemed=await req('booking/'+id+'/redeem',{credential:body.credential,code:h.codes[0].code});assert.equal(redeemed.status,200);guest.setCsrf(redeemed.body.csrfToken);
 assert.equal((await req('booking/'+id+'/redeem',{credential:body.credential,code:h.codes[0].code})).status,403);
 let join=await guest.request('scheduling/guest/meetings/'+meeting+'/token',{displayName:'Fictional Guest'});assert.equal(join.status,202);assert.equal(join.body.token,undefined);
 const waiting=(await host.request('meetings/'+meeting+'/state')).body.pending;assert.equal(waiting.length,1);assert.equal(waiting[0].name,body.name);
 assert.equal((await host.request('meetings/'+meeting+'/actions',{action:'admit',target:waiting[0].accountId})).status,200);
 assert.equal((await host.request('meetings/'+meeting+'/recordings/fixture/start',{})).status,409);
 join=await guest.request('scheduling/guest/meetings/'+meeting+'/token',{displayName:'Fictional Guest'});assert.equal(join.status,200,JSON.stringify(join.body));assert.equal(join.body.token.length,43);
 const service=h.app.locals.scheduling;assert.ok(await service.db.withContext(()=>h.app.locals.schedulingGuests.authorizeTicket(join.body.token)));
 assert.equal((await guest.request('scheduling/guest/meetings/m-'+randomUUID()+'/state')).status,401);
 for(const route of ['scheduling/dashboard','meetings/'+meeting+'/recordings','meetings/'+meeting+'/whiteboard','meetings/'+meeting+'/ai-reports','meeting-history'])assert.notEqual((await guest.request(route)).status,200,route);
 assert.equal((await guest.request('scheduling/guest/meetings/'+meeting+'/actions',{action:'cohost_add',target:waiting[0].accountId})).status,403);
 assert.equal((await host.request('meetings/'+meeting+'/actions',{action:'remove',target:waiting[0].accountId})).status,200);assert.equal(await service.db.withContext(()=>h.app.locals.schedulingGuests.authorizeTicket(join.body.token)),null);
});
test('cancellation revokes redeemed guest sessions and normal host tokens respect booking join window',async t=>{const {h,host,guest,event,req,body}=await setup(t);const b=(await req('events/'+event.id+'/book',body)).body.booking;
 assert.equal((await host.request('meetings/'+b.meetingId+'/token',{displayName:'Host'})).status,403);h.advance(body.start-h.now()-14*60000);
 await req('booking/'+b.id+'/code',{credential:body.credential});await req('booking/'+b.id+'/redeem',{credential:body.credential,code:h.codes[0].code});assert.equal((await guest.request('scheduling/guest/meetings/'+b.meetingId+'/state')).status,200);
 await req('booking/'+b.id+'/change',{credential:body.credential,action:'cancel',version:1});assert.equal((await guest.request('scheduling/guest/meetings/'+b.meetingId+'/state')).status,401);assert.equal((await host.request('meetings/'+b.meetingId+'/token',{displayName:'Host'})).status,403);
});
test('durable reminders recover leases, deduplicate mock delivery and never send cancelled versions',async t=>{const {h,event,req,body,host}=await setup(t);const b=(await req('events/'+event.id+'/book',body)).body.booking;
 await h.app.locals.schedulingJobs.tick();assert.equal(h.outbox.filter(m=>m.subject.includes('Booking confirmed')).length,2);const delivered=h.outbox.length;assert.match(h.outbox[0].text,/Asia\/Kolkata/);assert.match(h.outbox[0].text,/UTC/);
 h.raw.prepare("UPDATE scheduling_jobs SET status='sending',lease_until=0 WHERE booking_id=? AND status='sent'").run(b.id);await h.app.locals.schedulingJobs.tick();assert.equal(h.outbox.length,delivered);
 const b2=(await req('events/'+event.id+'/book',{...body,credential:secret(),start:body.start+3600000})).body.booking;await host.request('scheduling/host-booking/'+b2.id+'/change',{action:'cancel',version:1});await h.app.locals.schedulingJobs.tick();assert.equal(h.outbox.length,delivered+2);assert.equal(h.outbox.filter(m=>m.subject.includes('Booking cancelled')).length,2);
});
test('embedding requires an exact host-approved HTTPS origin and analytics respect consent',async t=>{const {h,event,req,host,slug}=await setup(t);assert.equal((await h.client().request('scheduling/embed/'+event.id+'?parent=https%3A%2F%2Fbusiness.example')).status,403);
 await host.request('scheduling/profile',{slug,timezone:'UTC',settings:{notice:0,embedOrigins:['https://business.example']},windows:[{weekday:1,start:540,end:1020}]});const embed=await h.client().request('scheduling/embed/'+event.id+'?parent=https%3A%2F%2Fbusiness.example');assert.equal(embed.status,200);assert.equal(embed.body.parent,'https://business.example');
 const response=await fetch(h.origin+'/booking/'+slug+'/consult?embed=1&parent=https%3A%2F%2Fother.example');assert.equal(response.status,403);
 assert.equal((await req('events/'+event.id+'/metric',{consent:false,kind:'visit'})).body.tracked,false);assert.equal((await req('events/'+event.id+'/metric',{consent:true,kind:'visit'})).body.tracked,true);const metrics=(await host.request('scheduling/analytics')).body;assert.equal(metrics.pageEvents[0].count,1);assert.equal(metrics.conversionRate,0);
});
test('disabled email fails closed without creating permanent guest accounts',async t=>{const {h,event,req,body}=await setup(t,{transportEnabled:false});const b=(await req('events/'+event.id+'/book',body)).body.booking;h.advance(body.start-h.now()-14*60000);assert.equal((await req('booking/'+b.id+'/code',{credential:body.credential})).status,503);assert.equal(h.raw.prepare('SELECT COUNT(*) AS n FROM accounts').get().n,1);assert.equal(h.outbox.length,0);});

test('anonymous conversion counts only explicit consent, deduplicates forms and honors DNT',async t=>{
 const {host,event,req,body,guest}=await setup(t);
 for(let i=0;i<2;i++)await req('events/'+event.id+'/metric',{kind:'visit',consent:true});
 await req('events/'+event.id+'/metric',{kind:'selection',consent:true});
 const booked=await req('events/'+event.id+'/book',{...body,analyticsConsent:true});assert.equal(booked.status,201);
 await req('events/'+event.id+'/book',{...body,analyticsConsent:true});
 const metrics=(await host.request('scheduling/analytics')).body;assert.equal(metrics.conversionRate,100);assert.equal(metrics.pageEvents.find(m=>m.kind==='completion').count,1);assert.equal(metrics.pageEvents.find(m=>m.kind==='visit').count,1);
 const form=(await guest.request('scheduling/form')).body.formToken;
 assert.equal((await guest.request('scheduling/events/'+event.id+'/metric',{kind:'visit',consent:true},{'X-Scheduling-Token':form,DNT:'1'})).body.tracked,false);
 assert.equal((await guest.request('scheduling/events/'+event.id+'/book',{...body,start:body.start+3600000,credential:secret(),analyticsConsent:true},{'X-Scheduling-Token':form,DNT:'1'})).status,201);
 assert.equal((await host.request('scheduling/analytics')).body.pageEvents.find(m=>m.kind==='completion').count,1);
});

test('malformed nested scheduling settings fail validation without writing a profile',async t=>{
 const {host,slug}=await setup(t);
 for(const bad of [{overrides:[null]},{windows:[null]},{settings:null},{overrides:[{date:'2026-02-30',windows:[]}]}]){
  assert.equal((await host.request('scheduling/profile',{slug,timezone:'UTC',settings:{notice:0},windows:[],...bad})).status,400);
 }
});

test('proven pre-DATA transient failures retry with a durable limit and sanitized errors',async t=>{
 const {h,event,req,body}=await setup(t);await req('events/'+event.id+'/book',body);
 h.transport.send=async()=>{throw {delivery:{outcome:'CONFIRMED_NOT_SUBMITTED',phase:'TIMED_OUT',errorCategory:'timeout',retryable:true}};};
 for(let i=0;i<4;i++){await h.app.locals.schedulingJobs.tick();h.advance(61000);}
 const jobs=h.raw.prepare("SELECT status,attempts,error_code FROM scheduling_jobs WHERE kind LIKE 'confirmation:%'").all();
 assert.equal(jobs.length,2);for(const job of jobs){assert.equal(job.status,'failed');assert.equal(job.attempts,3);assert.equal(job.error_code,'retry_limit');}
});
