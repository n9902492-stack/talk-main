import {createHash,randomUUID} from 'node:crypto';
export const digest=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
export const calendarBookingSql=`SELECT b.*,o.starts_at,o.ends_at,o.meeting_id,e.title,e.settings AS event_settings,a.name AS host_name,p.timezone AS host_timezone
 FROM scheduling_bookings b JOIN scheduling_occurrences o ON o.id=b.occurrence_id JOIN scheduling_events e ON e.id=o.event_id
 JOIN accounts a ON a.id=b.host_id JOIN scheduling_profiles p ON p.host_id=b.host_id WHERE b.id=?`;
export async function enqueueCalendarBooking(s,id,{manual=false,force=false}={}){
 const b=await s.get(calendarBookingSql,id);if(!b)return;
 const c=await s.get('SELECT * FROM talk_calendar_connections WHERE host_id=?',b.host_id);
 if(!c||c.status!=='connected')return;
 const mapped=await s.get('SELECT booking_id FROM talk_calendar_events WHERE booking_id=?',id);
 if(!mapped&&!manual&&!JSON.parse(c.settings).autoCreate)return;
 const signature=digest({version:b.version,revision:c.revision,...force||manual?{intent:randomUUID()}: {}});
 await s.run("INSERT INTO talk_calendar_jobs(id,host_id,booking_id,connection_id,signature,status,due_at,force_sync) VALUES (?,?,?,?,?,'pending',?,?) ON CONFLICT(booking_id,connection_id,signature) DO NOTHING",randomUUID(),b.host_id,id,c.id,signature,s.now(),force?1:0);
}
export async function enqueueHostBookings(s,host){for(const b of await s.all("SELECT b.id FROM scheduling_bookings b JOIN scheduling_occurrences o ON o.id=b.occurrence_id WHERE b.host_id=? AND b.status='confirmed' AND o.ends_at>?",host,s.now()))await enqueueCalendarBooking(s,b.id);}
