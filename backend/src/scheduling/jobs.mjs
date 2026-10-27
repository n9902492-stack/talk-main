import { randomUUID } from "node:crypto";
import { emailBookingSql, enqueueEmails } from "./email-outbox.mjs";
import { renderSchedulingEmail } from "./email-templates.mjs";
import { calendarInvitation } from "./calendar.mjs";
import {deliveryMessageId,safeDelivery} from './delivery-diagnostics.mjs';
import {updateDeliveryAttempt} from './delivery-attempts.mjs';
function createSchedulingJobs(service) {
  const { db, get, run, all, now, transport, transaction } = service, worker = randomUUID();
  let busy = false;
  const eligible=(b,j)=>b&&b.version===j.booking_version&&(j.kind==='cancellation:'+j.recipient?b.status==='cancelled':b.status==='confirmed');
  async function upgradeLegacy(){
    const rows=await all("SELECT DISTINCT j.booking_id,b.host_id FROM scheduling_jobs j JOIN scheduling_bookings b ON b.id=j.booking_id JOIN scheduling_occurrences o ON o.id=b.occurrence_id WHERE j.kind IN ('confirmation','reminder') AND (j.status='queued' OR j.status='sent' AND b.status='confirmed' AND o.starts_at>? AND NOT EXISTS (SELECT 1 FROM scheduling_jobs n WHERE n.booking_id=b.id AND n.booking_version=b.version AND n.kind LIKE '%:%')) LIMIT 20",now());
    for(const row of rows)await transaction(row.host_id,async()=>{
      const b=await get(emailBookingSql,row.booking_id);
      // A legacy sending row may already have reached SMTP. Leave it for the
      // conservative lease recovery below; never recreate that confirmation.
      await run("UPDATE scheduling_jobs SET status='cancelled',error_code='legacy_replaced',lease_until=NULL WHERE booking_id=? AND kind IN ('confirmation','reminder') AND status='queued'",row.booking_id);
      if(b?.status!=='confirmed'||b.starts_at<=now())return;
      if(await get("SELECT 1 AS uncertain FROM scheduling_jobs WHERE booking_id=? AND booking_version=? AND kind='confirmation' AND (status='sending' OR delivery_outcome='UNKNOWN_AMBIGUOUS')",b.id,b.version))return;
      const sent=await get("SELECT 1 AS sent FROM scheduling_jobs WHERE booking_id=? AND booking_version=? AND kind='confirmation' AND status='sent'",b.id,b.version);
      await enqueueEmails(service,b.id,b.version,'confirmation',{inviteeConfirmationSent:Boolean(sent)});
    });
  }
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      return await db.withContext(async () => {
        await run("DELETE FROM scheduling_metric_visits WHERE expires_at<=?", now());
        await run("DELETE FROM scheduling_answers WHERE booking_id IN (SELECT id FROM scheduling_bookings WHERE answers_expire_at<=?)", now());
        if (!transport) return { enabled: false };
        await upgradeLegacy();
        const candidates = await all("SELECT j.id,b.host_id FROM scheduling_jobs j JOIN scheduling_bookings b ON b.id=j.booking_id WHERE j.due_at<=? AND (j.status='queued' OR j.status='sending' AND j.lease_until<=?) ORDER BY j.due_at LIMIT 20", now(), now());
        let sent = 0;
        for (const candidate of candidates) {
          let mail,attemptId;
          await transaction(candidate.host_id, async () => {
            const j = await get("SELECT * FROM scheduling_jobs WHERE id=?", candidate.id);
            if (!j || j.due_at>now() || !(j.status === "queued" || j.status === "sending" && j.lease_until <= now())) return;
            if(j.status==='sending'){
              const prior=await get('SELECT * FROM scheduling_email_attempts WHERE job_id=? AND attempt_number=?',j.id,j.attempts);
              const events=safeDelivery({events:JSON.parse(prior?.events_json||'[]')}).events;
              const acknowledged=prior?.outcome==='CONFIRMED_ACCEPTED'||events.some(e=>e.phase==='ACCEPTED'&&e.code>=200&&e.code<300);
              const rejected=prior?.outcome==='CONFIRMED_REJECTED'||events.some(e=>e.phase==='REJECTED'&&e.code>=400);
              const outcome=acknowledged?'CONFIRMED_ACCEPTED':rejected?'CONFIRMED_REJECTED':prior?.outcome==='CONFIRMED_NOT_SUBMITTED'?'CONFIRMED_NOT_SUBMITTED':'UNKNOWN_AMBIGUOUS';
              if(prior?.outcome==='IN_PROGRESS')await updateDeliveryAttempt(service,prior.id,{outcome,phase:acknowledged?'ACCEPTED':rejected?'REJECTED':'AMBIGUOUS',smtpCode:prior.smtp_code,errorCategory:acknowledged?null:'interrupted',events},{complete:true});
              await run("UPDATE scheduling_jobs SET status=?,delivery_outcome=?,error_code=?,lease_until=NULL WHERE id=?",acknowledged?'sent':'failed',outcome,acknowledged?null:outcome==='UNKNOWN_AMBIGUOUS'?'smtp_unknown_ambiguous':'smtp_recovered_failure',j.id);
              if(acknowledged)sent++;
              return; // A stale in-flight job is never blindly re-sent.
            }
            const b = await get(emailBookingSql,j.booking_id),[kind,recipient]=j.kind.split(':');
            if (!eligible(b,j)||j.expires_at===null||j.expires_at<=now()) {
              await run("UPDATE scheduling_jobs SET status='cancelled',error_code='obsolete_or_expired',lease_until=NULL WHERE id=?", j.id);
              return;
            }
            if(!['confirmation','rescheduled','cancellation','reminder_day','reminder_15'].includes(kind)||recipient!==j.recipient){await run("UPDATE scheduling_jobs SET status='failed',error_code='invalid_job' WHERE id=?",j.id);return;}
            if (j.attempts >= 3) {
              await run("UPDATE scheduling_jobs SET status='failed',error_code='retry_limit' WHERE id=?", j.id);
              return;
            }
            const to=recipient==='host'?b.host_email:b.email;
            if(typeof to!=='string'||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)||recipient==='host'&&!b.host_verified){await run("UPDATE scheduling_jobs SET status='failed',error_code='recipient_unavailable' WHERE id=?",j.id);return;}
            if(!transport.links){await run("UPDATE scheduling_jobs SET status='failed',error_code='email_links_unconfigured' WHERE id=?",j.id);return;}
            const rendered=renderSchedulingEmail({kind,recipient,b,host:{name:b.host_name,email:b.host_email,timezone:b.host_timezone},hostUrl:transport.links.hostUrl(b),inviteeUrl:kind==='cancellation'?undefined:transport.links.inviteeUrl(b)});
            mail={jobId:j.id,to,...rendered,calendar:calendarInvitation({id:b.id,title:b.title,start:b.starts_at,end:b.ends_at,version:b.version,cancelled:kind==='cancellation'})};
            attemptId=randomUUID();
            await run("INSERT INTO scheduling_email_attempts(id,job_id,attempt_number,message_id,started_at,outcome,phase,events_json) VALUES (?,?,?,?,?,'IN_PROGRESS','CLAIMED',?)",attemptId,j.id,j.attempts+1,deliveryMessageId(j.id),now(),JSON.stringify([{at:now(),phase:'CLAIMED'}]));
            await run("UPDATE scheduling_jobs SET status='sending',attempts=attempts+1,delivery_outcome=NULL,lease_until=?,worker_id=? WHERE id=?",now()+60000,worker,j.id);
          });
          if (!mail) continue;
          const current=await get('SELECT * FROM scheduling_jobs WHERE id=?',mail.jobId),booking=current&&await get(emailBookingSql,current.booking_id);
          if(!current||current.status!=='sending'||current.worker_id!==worker||current.expires_at<=now()||!eligible(booking,current))continue;
          // Keep a live SMTP dispatch leased; a slow but healthy transport must
          // not be claimed by a second worker. Process death still expires it.
          const heartbeat=setInterval(()=>{void db.withContext(()=>run("UPDATE scheduling_jobs SET lease_until=? WHERE id=? AND worker_id=? AND status='sending'",now()+60000,mail.jobId,worker)).catch(()=>{});},15000);
          heartbeat.unref();
          try {
            const response=await transport.send(mail,{now,onDiagnostic:d=>db.withContext(()=>updateDeliveryAttempt(service,attemptId,d))});
            const delivery=safeDelivery(response?.delivery||{outcome:response?.accepted===true&&response?.smtpCode>=200&&response?.smtpCode<300?'CONFIRMED_ACCEPTED':'UNKNOWN_AMBIGUOUS',phase:response?.accepted===true?'ACCEPTED':'AMBIGUOUS',smtpCode:response?.smtpCode});
            if(delivery.outcome!=='CONFIRMED_ACCEPTED')throw {delivery};
            await transaction(candidate.host_id,async()=>{
              await updateDeliveryAttempt(service,attemptId,delivery,{complete:true});
              const saved=await run("UPDATE scheduling_jobs SET status='sent',delivery_outcome='CONFIRMED_ACCEPTED',lease_until=NULL,error_code=NULL WHERE id=? AND worker_id=? AND status='sending'", mail.jobId, worker);sent+=saved.changes;
            });
          } catch (error) {
            const delivery=safeDelivery(error?.delivery);
            await transaction(candidate.host_id,async()=>{
              await updateDeliveryAttempt(service,attemptId,delivery,{complete:true});
              const currentJob=await get('SELECT attempts FROM scheduling_jobs WHERE id=?',mail.jobId);
              const retry=delivery.outcome==='CONFIRMED_NOT_SUBMITTED'&&delivery.retryable&&currentJob.attempts<3;
              await run("UPDATE scheduling_jobs SET status=?,delivery_outcome=?,error_code=?,due_at=?,lease_until=NULL WHERE id=? AND worker_id=? AND status='sending'",retry?'queued':'failed',delivery.outcome,delivery.outcome==='UNKNOWN_AMBIGUOUS'?'smtp_unknown_ambiguous':retry?'delivery_failed':delivery.retryable&&currentJob.attempts>=3?'retry_limit':delivery.outcome.toLowerCase(),now()+60000,mail.jobId,worker);
            });
          }finally{
            clearInterval(heartbeat);
          }
        }
        return { enabled: true, sent };
      });
    } finally {
      busy = false;
    }
  }
  return { tick };
}
export {
  createSchedulingJobs
};
