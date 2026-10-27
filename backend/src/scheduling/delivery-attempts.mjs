import {safeDelivery,deliveryMessageId} from './delivery-diagnostics.mjs';
export async function updateDeliveryAttempt(service,id,diagnostic,{complete=false}={}){
 const d=safeDelivery(diagnostic);
 await service.run("UPDATE scheduling_email_attempts SET outcome=?,phase=?,smtp_code=?,error_category=?,retryable=?,events_json=?,completed_at=? WHERE id=? AND outcome='IN_PROGRESS'",complete?d.outcome:'IN_PROGRESS',d.phase,d.smtpCode,d.errorCategory,d.retryable?1:0,JSON.stringify(d.events),complete?service.now():null,id);
 return d;
}
export async function deliveryHistory(service,host){
 const rows=await service.all(`SELECT j.id,j.kind,j.status,j.attempts,j.delivery_outcome,j.error_code,a.id AS attempt_id,a.message_id,a.started_at,a.completed_at,a.phase,a.smtp_code,a.error_category,a.outcome,a.events_json FROM scheduling_jobs j JOIN scheduling_bookings b ON b.id=j.booking_id LEFT JOIN scheduling_email_attempts a ON a.job_id=j.id AND a.attempt_number=j.attempts WHERE b.host_id=? ORDER BY COALESCE(a.started_at,j.due_at) DESC LIMIT 50`,host);
 return {enabled:Boolean(service.transport),deliveries:rows.map(row=>({...row,events_json:undefined,events:safeDelivery({events:JSON.parse(row.events_json||'[]')}).events,message_id:row.message_id||deliveryMessageId(row.id)}))};
}
