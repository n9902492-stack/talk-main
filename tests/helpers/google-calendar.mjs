import {randomUUID,randomBytes} from 'node:crypto';
import {openAuthDatabase} from '../../backend/src/database.mjs';
import {asyncDatabase} from '../../backend/src/async-database.mjs';
import {createScheduling,secret} from '../../backend/src/scheduling/service.mjs';
import {createGoogleCalendar} from '../../backend/src/scheduling/google-calendar/service.mjs';
import {calendarConfiguration,calendarScope} from '../../backend/src/scheduling/google-calendar/config.mjs';
import {googleCalendarProvider,CalendarError} from '../../backend/src/scheduling/google-calendar/provider.mjs';
export function mockGoogle(config){
 const events=new Map(),calls=[];let n=0;
 const fail=code=>{throw new CalendarError(code);};
 const provider={events,calls,subject:'synthetic-google',email:'calendar@example.test',
  authorizationUrl:googleCalendarProvider(config).authorizationUrl,
  exchange:async()=>({access_token:'fake-access',refresh_token:'fake-refresh',expires_in:3600,scope:calendarScope}),
  identity:async()=>({sub:provider.subject,email:provider.email,email_verified:true}),
  refresh:async()=>{calls.push({kind:'refresh'});return {access_token:'fake-refreshed',expires_in:3600};},
  revoke:async()=>{calls.push({kind:'revoke'});},
  get:async(_t,calendar,id)=>{calls.push({kind:'get',calendar,id});if(!events.has(id))fail('not_found');return structuredClone(events.get(id));},
  insert:async(_t,calendar,payload,updates)=>{calls.push({kind:'insert',calendar,payload:structuredClone(payload),updates});if(events.has(payload.id))fail('duplicate');const value={...structuredClone(payload),etag:'v'+(++n),htmlLink:'https://calendar.google.com/calendar/event?eid=synthetic'};events.set(payload.id,value);return structuredClone(value);},
  update:async(_t,calendar,id,payload,etag,updates)=>{calls.push({kind:'update',calendar,id,updates});const old=events.get(id);if(!old)fail('not_found');if(old.etag!==etag)fail('precondition');const value={...old,...structuredClone(payload),etag:'v'+(++n)};events.set(id,value);return structuredClone(value);},
  remove:async(_t,calendar,id,etag,updates)=>{calls.push({kind:'remove',calendar,id,updates});if(!events.has(id))fail('not_found');events.delete(id);return {};},
  list:async(_t,calendar,params)=>{calls.push({kind:'list',calendar,params});return {items:[...events.values()].map(value=>structuredClone(value)),nextSyncToken:'mock-cursor'};}
 };return provider;
}
export async function calendarFixture({database,config:provided,instant=Date.parse('2026-10-26T00:00Z')}={}){
 const raw=database||openAuthDatabase(),db=asyncDatabase(raw),host=randomUUID();let now=instant;
 const config=provided||calendarConfiguration({GOOGLE_CALENDAR_PUBLIC_URL:'http://localhost:3001',GOOGLE_CALENDAR_CLIENT_ID:'calendar-fixture',GOOGLE_CALENDAR_CLIENT_SECRET:'offline-fixture',GOOGLE_CALENDAR_TOKEN_KEY:randomBytes(32).toString('base64url'),GOOGLE_CALENDAR_OAUTH_ENABLED:'true',GOOGLE_CALENDAR_SYNC_ENABLED:'true',GOOGLE_CALENDAR_READ_ENABLED:'true'});
 const provider=mockGoogle(config),s=createScheduling({db,now:()=>now,calendarEnabled:true}),g=createGoogleCalendar(s,{config,provider}),call=fn=>db.withContext(fn);
 await call(()=>s.run('INSERT INTO accounts(id,name,email,email_verified,created_at) VALUES (?,?,?,1,?)',host,'Synthetic Host','host-'+host+'@example.test',now));
 await call(()=>s.saveProfile(host,{slug:'calendar-'+host,timezone:'Asia/Kolkata',settings:{notice:0,bufferAfter:0,longBreak:0},windows:[0,1,2,3,4,5,6].map(weekday=>({weekday,start:0,end:1440}))}));
 const event=(await call(()=>s.createEvent(host,{slug:'synthetic',title:'Synthetic OrbitMeet Calendar Test',duration:30}))).event;
 const body=(start=Date.parse('2026-10-26T09:00Z'))=>({start,name:'Synthetic Guest',email:'guest@example.test',timezone:'Asia/Kolkata',credential:secret(),answers:{}});
 async function connect(){const {authorizationUrl}=await call(()=>g.connection.begin(host,'fixture-session'));return call(()=>g.connection.callback(host,'fixture-session',{state:new URL(authorizationUrl).searchParams.get('state'),code:'synthetic-code'}));}
 async function book(start){const input=body(start);return {...await call(()=>s.book(event.id,input)),input};}
 return {raw,db,s,g,host,event,config,provider,call,body,connect,book,advance:ms=>{now+=ms;},now:()=>now,close:()=>raw.close()};
}
