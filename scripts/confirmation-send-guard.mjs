import {DatabaseSync} from 'node:sqlite';

// Reservation commits before any SMTP operation. A crash, authentication failure
// or ambiguous DATA response never releases/retries this one authorization.
export function reserveConfirmationAttempt(filename,scope,fingerprint){
 const db=new DatabaseSync(filename);
 try{db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
  const changed=db.prepare("UPDATE confirmation_attempt SET consumed=1,status='reserved' WHERE scope=? AND fingerprint=? AND consumed=0 AND status='awaiting_approval'").run(scope,fingerprint);
  if(changed.changes!==1)throw new Error('SINGLE_ATTEMPT_UNAVAILABLE');db.exec('COMMIT');
 }catch(e){if(db.isTransaction)db.exec('ROLLBACK');throw e;}finally{db.close();}
}
export function completeConfirmationAttempt(filename,scope,status){
 if(!['smtp_accepted','preflight_failed_no_send','failed_or_acceptance_unknown'].includes(status))throw new Error('INVALID_ATTEMPT_STATUS');
 const db=new DatabaseSync(filename);try{db.prepare("UPDATE confirmation_attempt SET status=? WHERE scope=? AND consumed=1 AND status='reserved'").run(status,scope);}finally{db.close();}
}
