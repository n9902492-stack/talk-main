import {randomUUID} from 'node:crypto';
import {plannedReminders} from './email-schedule.mjs';

export const emailBookingSql=`SELECT b.*,o.starts_at,o.ends_at,o.meeting_id,e.title,
 p.timezone AS host_timezone,a.name AS host_name,a.email AS host_email,a.email_verified AS host_verified
 FROM scheduling_bookings b JOIN scheduling_occurrences o ON o.id=b.occurrence_id
 JOIN scheduling_events e ON e.id=o.event_id JOIN scheduling_profiles p ON p.host_id=b.host_id
 JOIN accounts a ON a.id=b.host_id WHERE b.id=?`;

// Call within the existing host booking transaction. Uniqueness makes recovery
// idempotent without relying on a process-local lock.
export async function enqueueEmails({get,run,now},id,version,kind='confirmation',{inviteeConfirmationSent=false}={}){
  const b=await get(emailBookingSql,id);
  if(!b||b.version!==version)return;
  for(const recipient of ['host','invitee']){
   const plans=[{kind,dueAt:now(),expiresAt:kind==='cancellation'?now()+86400000:b.starts_at}];
   if(kind!=='cancellation')plans.push(...plannedReminders(b.starts_at,recipient==='host'?b.host_timezone:b.timezone,now()));
   for(const plan of plans){
    if(plan.expiresAt<=now()||recipient==='invitee'&&inviteeConfirmationSent&&plan.kind==='confirmation')continue;
    await run(`INSERT INTO scheduling_jobs(id,booking_id,booking_version,kind,recipient,due_at,expires_at,status)
      VALUES (?,?,?,?,?,?,?,'queued') ON CONFLICT(booking_id,booking_version,kind) DO NOTHING`,
      randomUUID(),id,version,`${plan.kind}:${recipient}`,recipient,plan.dueAt,plan.expiresAt);
   }
  }
}
