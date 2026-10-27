import {randomUUID} from 'node:crypto';
import {calendarBookingSql,enqueueCalendarBooking} from './repository.mjs';
import {eventPayload,eventHash,googleEventId,safeEventUrl} from './event.mjs';

export async function recordConflict(s,b,event,kind){
 await s.run("INSERT INTO talk_calendar_conflicts(id,host_id,booking_id,event_id,kind,remote_etag,remote_start,remote_end,created_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(host_id,booking_id,event_id,kind,remote_etag) DO NOTHING",randomUUID(),b.host_id,b.id,event.id,kind,event.etag||'missing',Number.isFinite(Date.parse(event.start?.dateTime||event.start?.date))?Date.parse(event.start.dateTime||event.start.date):null,Number.isFinite(Date.parse(event.end?.dateTime||event.end?.date))?Date.parse(event.end.dateTime||event.end.date):null,s.now());
 if(kind!=='external_busy')await s.run("UPDATE talk_calendar_events SET status='conflict',error_code=? WHERE booking_id=?",kind,b.id);
}
export function calendarWorker(s,config,provider,connection){
 const worker=randomUUID();let running=false;
 const mapping=id=>s.get('SELECT * FROM talk_calendar_events WHERE booking_id=?',id);
 async function sync(job){
  const b=await s.get(calendarBookingSql,job.booking_id),c=await connection.row(job.host_id);
  if(!b||!c||c.status!=='connected'||c.id!==job.connection_id)return 'cancelled';
  let m=await mapping(b.id);
  if(m&&m.connection_id!==c.id){await s.run("UPDATE talk_calendar_events SET payload_hash=NULL,etag=NULL,event_url=NULL,attendee_status='[]',error_code=NULL WHERE booking_id=?",b.id);m=null;}
  const id=m?.connection_id===c.id?m.event_id:googleEventId(c.id,b.id);
  await s.run("INSERT INTO talk_calendar_events(booking_id,host_id,connection_id,calendar_id,event_id,status) VALUES (?,?,?,?,?,'pending') ON CONFLICT(booking_id) DO UPDATE SET connection_id=excluded.connection_id,calendar_id=excluded.calendar_id,event_id=excluded.event_id,status=CASE WHEN talk_calendar_events.connection_id=excluded.connection_id THEN talk_calendar_events.status ELSE 'pending' END",b.id,b.host_id,c.id,c.calendar_id,id);
  m=await mapping(b.id);
  const desired={...eventPayload(b,c,config.origin,config.invitations),id};
  let remote;try{remote=await connection.api(c,t=>provider.get(t,c.calendar_id,id));}catch(e){if(e.code!=='not_found'&&e.code!=='sync_expired')throw e;}
  // Never adopt or overwrite an event belonging to another booking.
  if(remote&&remote.extendedProperties?.private?.talkBookingId!==b.id&&remote.status!=='cancelled'){await recordConflict(s,b,remote,'external_edit');return 'done';}
  if(remote?.attendees?.length&&!(config.invitations&&JSON.parse(c.settings).inviteGuests)){await recordConflict(s,b,remote,'attendee_review');return 'done';}
  if(!job.force_sync&&remote&&m.payload_hash&&!(remote.status==='cancelled'&&b.status==='cancelled')&&(remote.status==='cancelled'||eventHash(remote)!==m.payload_hash&&eventHash(remote)!==eventHash(desired))){
   await recordConflict(s,b,remote,remote.status==='cancelled'?'external_cancel':'external_edit');return 'done';
  }
  const settings=JSON.parse(c.settings),updates=config.invitations&&settings.inviteGuests?'all':'none';
  if(b.status==='cancelled'){
   if(remote&&remote.status!=='cancelled')try{await connection.api(c,t=>provider.remove(t,c.calendar_id,id,remote.etag,updates));}catch(e){if(e.code!=='not_found'&&e.code!=='sync_expired')throw e;}
   await s.run("UPDATE talk_calendar_events SET status='cancelled',booking_version=?,last_sync_at=?,error_code=NULL WHERE booking_id=?",b.version,s.now(),b.id);return 'done';
  }
  // A deleted remote event is not recreated automatically. The host must resolve it.
  if(remote?.status==='cancelled'){await recordConflict(s,b,remote,'external_cancel');return 'done';}
  if(!remote&&m.payload_hash&&!job.force_sync){await recordConflict(s,b,{id},'external_cancel');return 'done';}
  // Check local revocation again immediately before mutation.
  const live=await connection.row(b.host_id);if(live?.status!=='connected'||live.id!==c.id||live.revision!==c.revision)return 'cancelled';
  if(!remote){try{remote=await connection.api(c,t=>provider.insert(t,c.calendar_id,desired,updates));}catch(e){if(e.code!=='duplicate')throw e;remote=await connection.api(c,t=>provider.get(t,c.calendar_id,id));if(remote.extendedProperties?.private?.talkBookingId!==b.id)throw Object.assign(new Error('Calendar event conflict.'),{code:'precondition'});}}
  if(eventHash(remote)!==eventHash(desired))remote=await connection.api(c,t=>provider.update(t,c.calendar_id,id,desired,remote.etag,updates));
  await s.run("UPDATE talk_calendar_events SET event_url=?,status='synced',etag=?,payload_hash=?,booking_version=?,last_sync_at=?,error_code=NULL,attendee_status=? WHERE booking_id=?",safeEventUrl(remote.htmlLink),remote.etag||null,eventHash(desired),b.version,s.now(),JSON.stringify((remote.attendees||[]).map(a=>({email:a.email,responseStatus:a.responseStatus||'needsAction'}))),b.id);
  await s.run('UPDATE talk_calendar_connections SET last_sync_at=?,error_code=NULL WHERE host_id=? AND id=?',s.now(),c.host_id,c.id);
  const latest=await s.get(calendarBookingSql,b.id);if(latest.version!==b.version)await enqueueCalendarBooking(s,b.id);
  return 'done';
 }
 async function tick(){
  if(running||!config.writes)return {processed:0};running=true;let processed=0;
  try{
   for(const candidate of await s.all("SELECT * FROM talk_calendar_jobs WHERE (status='pending' AND due_at<=?) OR (status='processing' AND lease_until<=?) ORDER BY due_at LIMIT 20",s.now(),s.now())){
    const job=await s.transaction(candidate.host_id,async()=>{
     if(await s.get("SELECT 1 AS busy FROM talk_calendar_jobs WHERE booking_id=? AND status='processing' AND lease_until>?",candidate.booking_id,s.now()))return null;
     const changed=await s.run("UPDATE talk_calendar_jobs SET status='processing',worker_id=?,lease_until=?,attempts=attempts+1 WHERE id=? AND ((status='pending' AND due_at<=?) OR (status='processing' AND lease_until<=?))",worker,s.now()+120000,candidate.id,s.now(),s.now());return changed.changes?s.get('SELECT * FROM talk_calendar_jobs WHERE id=?',candidate.id):null;
    });if(!job)continue;
    const heartbeat=setInterval(()=>{void s.db.withContext(()=>s.run("UPDATE talk_calendar_jobs SET lease_until=? WHERE id=? AND status='processing' AND worker_id=?",s.now()+120000,job.id,worker)).catch(()=>{});},30000);heartbeat.unref();
    try{const status=await sync(job);await s.run("UPDATE talk_calendar_jobs SET status=?,lease_until=NULL,error_code=NULL WHERE id=? AND status='processing' AND worker_id=?",status,job.id,worker);}
    catch(e){const code=['temporary','unauthorized','authorization_required','permission','precondition','not_found','sync_expired'].includes(e.code)?e.code:'sync_failed',retry=code==='temporary'&&job.attempts<5;
     await s.run("UPDATE talk_calendar_jobs SET status=?,error_code=?,lease_until=NULL,due_at=? WHERE id=? AND status='processing' AND worker_id=?",retry?'pending':'failed',code,s.now()+Math.min(3600000,30000*2**job.attempts),job.id,worker);
     await s.run("UPDATE talk_calendar_events SET status=?,error_code=? WHERE booking_id=?",code==='precondition'?'conflict':retry?'pending':'failed',code,job.booking_id);
    }finally{clearInterval(heartbeat);}processed++;
   }return {processed};
  }finally{running=false;}
 }
 return {tick,sync};
}
