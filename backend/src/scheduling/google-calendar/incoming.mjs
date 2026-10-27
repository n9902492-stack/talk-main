import {randomUUID} from 'node:crypto';
import {reject} from '../validation.mjs';
import {calendarBookingSql} from './repository.mjs';
import {eventHash} from './event.mjs';
import {recordConflict} from './worker.mjs';
import {localParts} from '../availability.mjs';
export function calendarInstant(value,zone){
 if(value?.dateTime)return Date.parse(value.dateTime);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value?.date||''))return NaN;
 const center=Date.parse(value.date+'T00:00:00Z');
 // Google all-day dates are local to the calendar, not UTC midnight.
 for(let at=center-15*3600000;at<=center+15*3600000;at+=15*60000){const p=localParts(at,zone);if(p.date===value.date&&p.minute===0)return at;}
 return NaN;
}
export function incomingCalendar(s,config,provider,connection){
 async function check(host){
  if(!config.reads)reject(503,'calendar_reads_disabled','Calendar change checks are not enabled.');
  const c=await connection.row(host);if(c?.status!=='connected')reject(409,'calendar_reconnect','Connect your Google Calendar first.');
  const owner=randomUUID(),claimed=await s.run("UPDATE talk_calendar_connections SET sync_owner=?,sync_until=? WHERE host_id=? AND (sync_until IS NULL OR sync_until<=?)",owner,s.now()+120000,host,s.now());
  if(!claimed.changes)reject(409,'calendar_check_busy','A Calendar check is already running.');
  const purpose=`talk:calendar:${host}:${c.id}:cursor`;
  let cursor=c.sync_cipher?connection.vault.open(c.sync_cipher,purpose):null;
  try{
   let nextToken,pageToken,pages=0,full=!cursor;const seen=new Set();
   do{
    if(++pages>100)throw Object.assign(new Error('Calendar is too large for one check.'),{code:'sync_limit'});
    let result;try{result=await connection.api(c,t=>provider.list(t,c.calendar_id,{showDeleted:'true',...cursor?{syncToken:cursor}:{},...pageToken?{pageToken}:{}}));}
    catch(e){if(e.code!=='sync_expired'||!cursor)throw e;cursor=null;pageToken=null;pages=0;full=true;seen.clear();await s.run('UPDATE talk_calendar_connections SET sync_cipher=NULL WHERE host_id=? AND sync_owner=?',host,owner);continue;}
    for(const event of result.items||[]){seen.add(event.id);const m=await s.get('SELECT * FROM talk_calendar_events WHERE host_id=? AND connection_id=? AND event_id=?',host,c.id,event.id);if(!m)continue;
     const b=await s.get(calendarBookingSql,m.booking_id);if(!b)continue;
     if(b.status==='confirmed'&&(event.status==='cancelled'||m.payload_hash&&eventHash(event)!==m.payload_hash))await recordConflict(s,b,event,event.status==='cancelled'?'external_cancel':'external_edit');
     await s.run('UPDATE talk_calendar_events SET attendee_status=? WHERE booking_id=?',JSON.stringify((event.attendees||[]).map(a=>({email:a.email,responseStatus:a.responseStatus||'needsAction'}))),b.id);
    }
    pageToken=result.nextPageToken;nextToken=result.nextSyncToken||nextToken;
    await s.run('UPDATE talk_calendar_connections SET sync_until=? WHERE host_id=? AND sync_owner=?',s.now()+120000,host,owner);
   }while(pageToken||pages===0);
   if(!nextToken)throw Object.assign(new Error('Calendar cursor unavailable.'),{code:'sync_failed'});
   // Old tombstones may disappear from a full listing after a cursor expires.
   if(full)for(const m of await s.all("SELECT m.* FROM talk_calendar_events m JOIN scheduling_bookings b ON b.id=m.booking_id JOIN scheduling_occurrences o ON o.id=b.occurrence_id WHERE m.host_id=? AND m.connection_id=? AND b.status='confirmed' AND o.ends_at>?",host,c.id,s.now())){
    if(seen.has(m.event_id))continue;const b=await s.get(calendarBookingSql,m.booking_id);
    try{const remote=await connection.api(c,t=>provider.get(t,c.calendar_id,m.event_id));if(remote.status==='cancelled')await recordConflict(s,b,remote,'external_cancel');else if(m.payload_hash&&eventHash(remote)!==m.payload_hash)await recordConflict(s,b,remote,'external_edit');}
    catch(e){if(e.code!=='not_found'&&e.code!=='sync_expired')throw e;await recordConflict(s,b,{id:m.event_id},'external_cancel');}
    await s.run('UPDATE talk_calendar_connections SET sync_until=? WHERE host_id=? AND sync_owner=?',s.now()+120000,host,owner);
   }
   // Expand recurring busy events separately; syncToken queries cannot include timeMin/timeMax.
   let busyPage;pages=0;
   do{if(++pages>100)throw Object.assign(new Error('Calendar is too large.'),{code:'sync_limit'});
    const result=await connection.api(c,t=>provider.list(t,c.calendar_id,{singleEvents:'true',timeMin:new Date(s.now()).toISOString(),timeMax:new Date(s.now()+90*86400000).toISOString(),...busyPage?{pageToken:busyPage}:{}}));
    for(const event of result.items||[]){if(event.status==='cancelled'||event.transparency==='transparent'||await s.get('SELECT 1 AS managed FROM talk_calendar_events WHERE host_id=? AND connection_id=? AND event_id=?',host,c.id,event.id))continue;
     const zone=(await s.get('SELECT timezone FROM scheduling_profiles WHERE host_id=?',host))?.timezone||'UTC',start=calendarInstant(event.start,event.start?.timeZone||zone),end=calendarInstant(event.end,event.end?.timeZone||zone);if(!Number.isFinite(start)||!Number.isFinite(end))continue;
     const rows=await s.all("SELECT b.id,b.host_id FROM scheduling_bookings b JOIN scheduling_occurrences o ON o.id=b.occurrence_id WHERE b.host_id=? AND b.status='confirmed' AND o.starts_at<? AND o.ends_at>?",host,end,start);
     for(const b of rows)await recordConflict(s,b,event,'external_busy');
    }busyPage=result.nextPageToken;await s.run('UPDATE talk_calendar_connections SET sync_until=? WHERE host_id=? AND sync_owner=?',s.now()+120000,host,owner);
   }while(busyPage);
   await s.run("UPDATE talk_calendar_connections SET sync_cipher=?,last_sync_at=?,error_code=NULL WHERE host_id=? AND id=? AND status='connected' AND sync_owner=?",connection.vault.seal(nextToken,purpose),s.now(),host,c.id,owner);
   return {ok:true};
  }catch(e){await s.run("UPDATE talk_calendar_connections SET error_code=? WHERE host_id=? AND id=?",['authorization_required','temporary','sync_limit'].includes(e.code)?e.code:'sync_failed',host,c.id);throw e;}
  finally{await s.run('UPDATE talk_calendar_connections SET sync_owner=NULL,sync_until=NULL WHERE host_id=? AND sync_owner=?',host,owner);}
 }
 return {check};
}
