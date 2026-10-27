import {reject} from '../validation.mjs';
import {calendarConfiguration} from './config.mjs';
import {calendarConnection} from './connection.mjs';
import {googleCalendarProvider} from './provider.mjs';
import {calendarWorker} from './worker.mjs';
import {incomingCalendar} from './incoming.mjs';
import {enqueueCalendarBooking,calendarBookingSql,digest} from './repository.mjs';
import {publicTalkJoin} from './event.mjs';
export function createGoogleCalendar(s,{config=calendarConfiguration(),provider=googleCalendarProvider(config)}={}){
 const connection=calendarConnection(s,config,provider),worker=calendarWorker(s,config,provider,connection),incoming=incomingCalendar(s,config,provider,connection);
 async function own(host,id){const b=await s.get(calendarBookingSql,id);if(!b||b.host_id!==host)reject(404,'booking_unavailable','This booking is unavailable.');return b;}
 async function booking(host,id){const b=await own(host,id),m=await s.get('SELECT * FROM talk_calendar_events WHERE booking_id=? AND host_id=?',id,host),c=await connection.status(host),queued=await s.get("SELECT 1 AS queued FROM talk_calendar_jobs WHERE booking_id=? AND host_id=? AND status IN ('pending','processing') LIMIT 1",id,host);
  return {connection:c,status:queued?'pending':m?.status||'not_added',eventUrl:m?.event_url||null,lastSyncAt:m?.last_sync_at||null,errorCode:m?.error_code||null,attendees:m?JSON.parse(m.attendee_status):[],talkUrl:config.origin?publicTalkJoin(config.origin,b.meeting_id):'/device-test?room='+encodeURIComponent(b.meeting_id),conflicts:await s.all("SELECT id,kind,remote_start,remote_end,created_at FROM talk_calendar_conflicts WHERE host_id=? AND booking_id=? AND resolution='pending' ORDER BY created_at DESC",host,id)};
 }
 async function add(host,id){await own(host,id);if(!config.writes)reject(503,'calendar_writes_disabled','Live Calendar synchronization is disabled. ICS downloads remain available.');if((await connection.row(host))?.status!=='connected')reject(409,'calendar_reconnect','Connect your Google Calendar first.');await s.transaction(host,async()=>{await enqueueCalendarBooking(s,id,{manual:true});await s.audit(host,id,'calendar_sync_requested');});return booking(host,id);}
 async function resolve(host,id,body){await own(host,id);if(!['dismiss','reassert'].includes(body.action))reject(400,'calendar_resolution','Choose a reconciliation action.');
  await s.transaction(host,async()=>{const conflict=await s.get("SELECT * FROM talk_calendar_conflicts WHERE id=? AND host_id=? AND booking_id=? AND resolution='pending'",body.conflictId,host,id);if(!conflict)reject(404,'calendar_conflict_unavailable','This conflict is unavailable.');
   if(body.action==='reassert'){if(conflict.kind==='external_busy')reject(409,'calendar_busy_review','Review the overlapping event in Calendar. Talk never changes unrelated events.');if(!config.writes)reject(503,'calendar_writes_disabled','Calendar synchronization is disabled.');
    const c=await connection.row(host);if(c?.status!=='connected')reject(409,'calendar_reconnect','Reconnect your Google Calendar first.');
    if(await s.get("SELECT 1 AS busy FROM talk_calendar_jobs WHERE booking_id=? AND status='processing' AND lease_until>?",id,s.now()))reject(409,'calendar_check_busy','Wait for the current sync before resolving this change.');
    if(conflict.kind==='external_cancel')await s.run("UPDATE talk_calendar_events SET event_id=?,event_url=NULL,payload_hash=NULL,etag=NULL,status='pending',error_code=NULL WHERE booking_id=? AND connection_id=?",'talk'+digest(c.id+':'+id+':'+conflict.id),id,c.id);
    await enqueueCalendarBooking(s,id,{manual:true,force:true});}
   await s.run('UPDATE talk_calendar_conflicts SET resolution=? WHERE id=?',body.action==='dismiss'?'dismissed':'reasserted',conflict.id);await s.audit(host,id,'calendar_conflict_'+body.action);
  });return booking(host,id);
 }
 return {config,connection,worker,incoming,booking,add,resolve};
}
