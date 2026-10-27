// One durable authorization, one transport invocation; never a worker/retry loop.
import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {DatabaseSync} from 'node:sqlite';
import {safeDelivery,deliveryMessageId} from '../backend/src/scheduling/delivery-diagnostics.mjs';
import {reserveConfirmationAttempt,completeConfirmationAttempt} from './confirmation-send-guard.mjs';
export async function runOneReliabilityAttempt({fixture,mail,createAdapter,now=Date.now}){
 assert.equal(mail.jobId,fixture.jobId);assert.equal(mail.messageId,deliveryMessageId(fixture.jobId));
 const raw=new DatabaseSync(fixture.databasePath),ledger=new DatabaseSync(fixture.guardPath);raw.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON');ledger.exec('PRAGMA busy_timeout=5000');
 const attemptId=randomUUID();let reserved=false,claimed=false,last=safeDelivery({outcome:'CONFIRMED_NOT_SUBMITTED',phase:'CLAIMED',events:[]});
 const sendCalls=()=>ledger.prepare('SELECT send_calls FROM controlled_smtp_dispatch WHERE attempt_id=?').get(attemptId)?.send_calls||0;
 function persist(d,{complete=false}={}){last=safeDelivery(d);raw.prepare("UPDATE scheduling_email_attempts SET outcome=?,phase=?,smtp_code=?,error_category=?,retryable=0,events_json=?,completed_at=? WHERE id=? AND outcome='IN_PROGRESS'").run(complete?last.outcome:'IN_PROGRESS',last.phase,last.smtpCode,last.errorCategory,JSON.stringify(last.events),complete?now():null,attemptId);}
 function recordDispatch(){const changed=ledger.prepare('UPDATE controlled_smtp_dispatch SET send_calls=1 WHERE attempt_id=? AND send_calls=0').run(attemptId);assert.equal(changed.changes,1,'Single dispatch unavailable');}
 let result;
 try{
  const j=raw.prepare('SELECT * FROM scheduling_jobs WHERE id=?').get(fixture.jobId);assert.equal(j.status,'queued');assert.equal(j.attempts,0);assert.equal(j.kind,'confirmation:invitee');assert.equal(j.booking_id,fixture.bookingId);assert.equal(raw.prepare('SELECT COUNT(*) n FROM scheduling_email_attempts WHERE job_id=?').get(j.id).n,0);
  reserveConfirmationAttempt(fixture.guardPath,fixture.scope,fixture.fingerprint);reserved=true;
  ledger.exec('CREATE TABLE IF NOT EXISTS controlled_smtp_dispatch(attempt_id TEXT PRIMARY KEY,scope TEXT NOT NULL UNIQUE,job_id TEXT NOT NULL,message_id TEXT NOT NULL,send_calls INTEGER NOT NULL DEFAULT 0 CHECK(send_calls IN(0,1)),started_at INTEGER NOT NULL,completed_at INTEGER,outcome TEXT)');
  ledger.prepare('INSERT INTO controlled_smtp_dispatch(attempt_id,scope,job_id,message_id,started_at) VALUES (?,?,?,?,?)').run(attemptId,fixture.scope,fixture.jobId,mail.messageId,now());
  raw.exec('BEGIN IMMEDIATE');try{
   const changed=raw.prepare("UPDATE scheduling_jobs SET status='sending',attempts=1,worker_id=?,lease_until=?,delivery_outcome=NULL WHERE id=? AND status='queued' AND attempts=0").run('one-shot:'+attemptId,now()+120000,fixture.jobId);assert.equal(changed.changes,1);
   raw.prepare("INSERT INTO scheduling_email_attempts(id,job_id,attempt_number,message_id,started_at,outcome,phase,events_json) VALUES (?,?,1,?,?,'IN_PROGRESS','CLAIMED',?)").run(attemptId,fixture.jobId,mail.messageId,now(),JSON.stringify([{at:now(),phase:'CLAIMED'}]));raw.exec('COMMIT');claimed=true;
  }catch(e){if(raw.isTransaction)raw.exec('ROLLBACK');throw e;}
  try{const adapter=createAdapter({attemptId,recordDispatch});const response=await adapter.send(mail,{now,onDiagnostic:d=>persist(d)});last=safeDelivery(response?.delivery||last);}catch(e){last=safeDelivery(e?.delivery||last);}
  // A resolved promise or accepted recipient alone is never SMTP acceptance.
  if(last.outcome==='CONFIRMED_ACCEPTED'&&!(last.smtpCode>=200&&last.smtpCode<300&&last.events.some(e=>e.phase==='ACCEPTED'&&e.code>=200&&e.code<300)))last=safeDelivery({...last,outcome:'UNKNOWN_AMBIGUOUS',phase:'AMBIGUOUS'});
  if(sendCalls()===0)last=safeDelivery({...last,outcome:'CONFIRMED_NOT_SUBMITTED',phase:'ERROR',retryable:false});
  else if(last.outcome==='CONFIRMED_NOT_SUBMITTED'&&!last.events.length)last=safeDelivery({outcome:'UNKNOWN_AMBIGUOUS',phase:'AMBIGUOUS'});
  raw.exec('BEGIN IMMEDIATE');try{persist(last,{complete:true});raw.prepare("UPDATE scheduling_jobs SET status=?,delivery_outcome=?,error_code=?,lease_until=NULL WHERE id=? AND worker_id=? AND status='sending'").run(last.outcome==='CONFIRMED_ACCEPTED'?'sent':'failed',last.outcome,last.outcome==='CONFIRMED_ACCEPTED'?null:last.outcome.toLowerCase(),fixture.jobId,'one-shot:'+attemptId);raw.exec('COMMIT');}catch(e){if(raw.isTransaction)raw.exec('ROLLBACK');throw e;}
  const calls=sendCalls();ledger.prepare('UPDATE controlled_smtp_dispatch SET completed_at=?,outcome=? WHERE attempt_id=?').run(now(),last.outcome,attemptId);
  completeConfirmationAttempt(fixture.guardPath,fixture.scope,last.outcome==='CONFIRMED_ACCEPTED'?'smtp_accepted':calls?'failed_or_acceptance_unknown':'preflight_failed_no_send');
  const has=p=>last.events.some(e=>e.phase===p);
  result={attemptId,messageId:mail.messageId,realSendAttempts:calls,outcome:last.outcome,connection:has('CONNECTED')?'ESTABLISHED':has('CONNECTION_INITIATED')?'INITIATED_NOT_ESTABLISHED':'NOT_ATTEMPTED',tls:has('TLS_COMPLETED')?'COMPLETED':has('TLS_STARTED')?'STARTED_NOT_COMPLETED':'NOT_OBSERVED',authentication:has('AUTH_SUCCEEDED')?'PASS':has('AUTH_FAILED')?'FAIL':'NOT_OBSERVED',submission:has('SUBMISSION_STARTED')?'STARTED':'NOT_OBSERVED',dataCompletion:has('DATA_STREAM_COMPLETED')?'LOCAL_STREAM_COMPLETION_OBSERVED':'NOT_OBSERVED',finalSmtpCode:last.smtpCode,errorCategory:last.errorCategory,guardConsumed:true,retries:0,diagnosticsPersisted:true,events:last.events,completedAt:new Date(now()).toISOString()};
 }catch{
  // If completion/storage itself fails, preserve whatever was durably observed.
  // The consumed guard and stale in-flight attempt must never be released.
  if(!reserved)throw Error('Single-attempt preflight or reservation unavailable.');
  let calls=0;try{calls=sendCalls();}catch{}
  completeConfirmationAttempt(fixture.guardPath,fixture.scope,calls?'failed_or_acceptance_unknown':'preflight_failed_no_send');
  result={attemptId,messageId:mail.messageId,realSendAttempts:calls,outcome:calls?'UNKNOWN_AMBIGUOUS':'CONFIRMED_NOT_SUBMITTED',guardConsumed:true,retries:0,diagnosticsPersisted:claimed,errorCategory:'diagnostic_storage',completedAt:new Date(now()).toISOString()};
 }finally{raw.close();ledger.close();}
 return result;
}
