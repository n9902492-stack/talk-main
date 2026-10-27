import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {schedulingHarness} from './helpers/scheduling.mjs';
import {calendarConfiguration} from '../backend/src/scheduling/google-calendar/config.mjs';
import {mockGoogle} from './helpers/google-calendar.mjs';
import {secret} from '../backend/src/scheduling/service.mjs';
test('Calendar HTTP routes enforce session, CSRF, origin, ownership and safe OAuth callback',async t=>{
 const config=calendarConfiguration({GOOGLE_CALENDAR_PUBLIC_URL:'http://localhost:3001',GOOGLE_CALENDAR_CLIENT_ID:'offline-calendar',GOOGLE_CALENDAR_CLIENT_SECRET:'offline-only',GOOGLE_CALENDAR_TOKEN_KEY:randomBytes(32).toString('base64url'),GOOGLE_CALENDAR_OAUTH_ENABLED:'true',GOOGLE_CALENDAR_SYNC_ENABLED:'true',GOOGLE_CALENDAR_READ_ENABLED:'true'}),provider=mockGoogle(config),h=await schedulingHarness({calendar:{config,provider},transportEnabled:false});t.after(h.close);
 const host=await h.account('calendar-host-'+randomUUID()),other=await h.account('other-'+randomUUID()),guest=h.client(),base='scheduling/google-calendar';
 assert.equal((await guest.request(base)).status,401);
 assert.equal((await host.request(base+'/connect',{}, {'X-CSRF-Token':'invalid'})).status,403);
 assert.equal((await host.request(base+'/connect',{}, {Origin:'https://evil.example'})).status,403);
 const auth=await host.request(base+'/connect',{});assert.equal(auth.status,200);const state=new URL(auth.body.authorizationUrl).searchParams.get('state');
 // Follow redirects only to local frontend; callback must not leak the code or state.
 const callback=await host.request(base+'/callback?state='+state+'&code=synthetic');assert.equal(callback.status,404);
 const status=await host.request(base);assert.equal(status.body.status,'connected');assert.ok(!JSON.stringify(status.body).includes('fake-'));assert.equal((await other.request(base)).body.status,'disconnected');
 const profile=await host.request('scheduling/profile',{slug:'host-'+randomUUID(),timezone:'Asia/Kolkata',settings:{notice:0},windows:[0,1,2,3,4,5,6].map(weekday=>({weekday,start:0,end:1440}))});assert.equal(profile.status,200);
 const event=(await host.request('scheduling/events',{title:'Calendar HTTP fixture',slug:'fixture',duration:30})).body.event,form=(await guest.request('scheduling/form')).body.formToken;
 const result=await guest.request('scheduling/events/'+event.id+'/book',{start:Math.ceil((h.now()+3*3600000)/900000)*900000,name:'Synthetic Guest',email:'guest@example.test',timezone:'Asia/Kolkata',credential:secret(),answers:{}},{'X-Scheduling-Token':form});assert.equal(result.status,201);const id=result.body.booking.id;
 assert.equal((await other.request(base+'/bookings/'+id)).status,404);assert.equal((await other.request(base+'/bookings/'+id+'/add',{})).status,404);
 assert.equal((await guest.request(base+'/bookings/'+id)).status,401);assert.equal((await host.request(base+'/bookings/'+id+'/add',{})).status,200);
 const ics=await host.request(base+'/bookings/'+id+'/ics');assert.equal(ics.status,200);assert.ok(ics.body.includes('SUMMARY:Calendar HTTP fixture'));assert.ok(!ics.body.includes('undefined'));assert.equal(ics.headers.get('cache-control'),'no-store');
 assert.equal((await other.request(base+'/bookings/'+id+'/ics')).status,404);
 assert.equal((await host.request(base+'/preferences',{autoCreate:true,remind15:true,remindDay:true,inviteGuests:true})).status,403);
 provider.list=async()=>{throw Error('Mock unavailable provider details must not be exposed.');};const outage=await host.request(base+'/check',{});assert.equal(outage.status,503);assert.equal(outage.body.error,'calendar_unavailable');assert.ok(outage.body.message.includes('Your Talk booking is preserved'));assert.ok(!JSON.stringify(outage.body).includes('Mock unavailable'));
 assert.equal((await host.request(base+'/disconnect',{})).body.status,'disconnected');assert.equal(h.outbox.length,0);assert.equal(h.codes.length,0);
});
test('disabled integration never invokes a Google provider or disables normal booking',async t=>{const provider=new Proxy({}, {get(){return ()=>{throw Error('Unexpected Google invocation');};}}),h=await schedulingHarness({transportEnabled:false,calendar:{provider}});t.after(h.close);const host=await h.account('disabled-'+randomUUID()),base='scheduling/google-calendar';assert.equal((await host.request(base)).body.configured,false);assert.equal((await host.request(base+'/connect',{})).status,503);assert.equal((await host.request(base+'/check',{})).status,503);assert.equal((await host.request('scheduling/dashboard')).status,200);});
