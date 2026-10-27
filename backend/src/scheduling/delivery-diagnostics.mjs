import {createHash} from 'node:crypto';
export const deliveryOutcomes=Object.freeze(['CONFIRMED_ACCEPTED','CONFIRMED_REJECTED','CONFIRMED_NOT_SUBMITTED','UNKNOWN_AMBIGUOUS']);
const phases=new Set(['CLAIMED','CONNECTION_INITIATED','CONNECTED','TLS_STARTED','TLS_COMPLETED','AUTH_STARTED','AUTH_SUCCEEDED','AUTH_FAILED','SUBMISSION_STARTED','DATA_STARTED','DATA_STREAM_COMPLETED','ACCEPTED','REJECTED','CLOSED','TIMED_OUT','ERROR','AMBIGUOUS']);
const categories=new Set(['authentication','timeout','connection','dns','tls','rejected','message','diagnostic_storage','interrupted','unknown']);
const cmd=value=>typeof value==='string'?/^(EHLO|HELO|STARTTLS|AUTH|MAIL|RCPT|DATA|RSET|QUIT|CONN)\b/.exec(value)?.[1]||null:null;
const code=value=>Number.isInteger(value)&&value>=200&&value<=599?value:null;
const number=value=>Number.isFinite(value)&&value>=0?Math.floor(value):null;
export const deliveryMessageId=job=>`<${/^[a-zA-Z0-9_-]{1,100}$/.test(job)?job:createHash('sha256').update(String(job)).digest('hex')}@talk.local>`;
// Rebuild every externally supplied diagnostic; never persist raw error fields.
export function safeDelivery(value={}){
 return {outcome:deliveryOutcomes.includes(value.outcome)?value.outcome:'UNKNOWN_AMBIGUOUS',phase:phases.has(value.phase)?value.phase:'AMBIGUOUS',smtpCode:code(value.smtpCode),errorCategory:categories.has(value.errorCategory)?value.errorCategory:null,retryable:value.outcome==='CONFIRMED_NOT_SUBMITTED'&&value.retryable===true,
  events:(Array.isArray(value.events)?value.events:[]).slice(-64).map(e=>({at:number(e.at),phase:phases.has(e.phase)?e.phase:'ERROR',...(code(e.code)?{code:code(e.code)}:{}),...(categories.has(e.category)?{category:e.category}:{})}))};
}
export class SchedulingDeliveryError extends Error{constructor(delivery){super('Scheduling email delivery failed.');this.delivery=safeDelivery(delivery);}}
export function createDeliveryObservation({now=Date.now,onDiagnostic=()=>{}}={}){
 let current='CONNECTION_INITIATED',dataStarted=false,tlsStarted=false,finalCode=null,rejection=null,category=null,terminal=false,coverage=false,pending=Promise.resolve(),persistenceFailure=false;
 const connections=new Map();
 const events=[];let emitted=0;
 const snapshot=()=>safeDelivery({outcome:finalCode>=200&&finalCode<300?'CONFIRMED_ACCEPTED':rejection?'CONFIRMED_REJECTED':terminal&&coverage&&!dataStarted?'CONFIRMED_NOT_SUBMITTED':'UNKNOWN_AMBIGUOUS',phase:current,smtpCode:finalCode||rejection,errorCategory:category,retryable:terminal&&!dataStarted&&coverage&&['connection','dns','timeout'].includes(category),events});
 function emit(phase,extra={}){current=phase;const terminalPhase=['ACCEPTED','REJECTED','ERROR','AMBIGUOUS','AUTH_FAILED','TIMED_OUT','CLOSED'].includes(phase);if(emitted>=112||emitted>=96&&!terminalPhase)return;emitted++;events.push({at:now(),phase,...extra});if(events.length>64)events.shift();const state=snapshot();pending=pending.then(()=>onDiagnostic(state)).catch(()=>{persistenceFailure=true;});}
 function error(error){
  terminal=true;const key=error?.code;category=key==='EAUTH'?'authentication':['ETIMEDOUT','ESOCKETTIMEDOUT'].includes(key)?'timeout':['EDNS','ENOTFOUND','EAI_AGAIN'].includes(key)?'dns':['ETLS','CERT_HAS_EXPIRED','DEPTH_ZERO_SELF_SIGNED_CERT','ERR_TLS_CERT_ALTNAME_INVALID'].includes(key)?'tls':['ECONNECTION','ECONNREFUSED','ECONNRESET','ECONNABORTED','ESOCKET'].includes(key)?'connection':['EENVELOPE','EMESSAGE'].includes(key)?'rejected':key==='ECOMPILE'?'message':'unknown';
  const reply=code(error?.responseCode);if(reply>=400&&['MAIL','RCPT','DATA'].includes(cmd(error?.command)))rejection=reply;
  emit(category==='authentication'?'AUTH_FAILED':category==='timeout'?'TIMED_OUT':'ERROR',{category,...(reply?{code:reply}:{})});
  emit(snapshot().outcome==='CONFIRMED_ACCEPTED'?'ACCEPTED':rejection?'REJECTED':dataStarted||!coverage?'AMBIGUOUS':current);
 }
 function log(meta,message){
  if(meta?.component!=='smtp-connection')return;coverage=true;
  const connectionId=meta.sid||'current';if(!connections.has(connectionId)){if(connections.size>=8)return;connections.set(connectionId,[]);}const queue=connections.get(connectionId);
  if(meta.tnx==='client'){
   const command=cmd(message);if(!command)return;coverage=true;if(queue.length<32)queue.push(command);
   if(command==='EHLO'||command==='HELO'){emit('CONNECTED');if(tlsStarted)emit('TLS_COMPLETED');}
   else if(command==='STARTTLS'){tlsStarted=true;emit('TLS_STARTED');}
   else if(command==='AUTH')emit('AUTH_STARTED');
   else if(command==='MAIL')emit('SUBMISSION_STARTED');
   else if(command==='DATA'){dataStarted=true;emit('DATA_STARTED');}
  }else if(meta.tnx==='server'){
   const reply=typeof message==='string'?code(Number(/^([2-5]\d{2})(?:[ -]|$)/.exec(message)?.[1])):null;if(!reply)return;
   // Match replies FIFO, including SMTP PIPELINING. Envelope 250 replies must
   // never be confused with the acknowledgment after the DATA terminator.
   const command=queue[0];if(!(command==='AUTH'&&reply===334))queue.shift();
   if(reply===220)emit('CONNECTED',{code:reply});
   if(command==='AUTH'&&reply===235)emit('AUTH_SUCCEEDED',{code:reply});
   if(command==='DATA'&&reply>=200&&reply<400){queue.unshift('DATA_FINAL');emit('DATA_STARTED',{code:reply});}
   // DATA command is a conservative boundary: never retry a lost reply after it.
   if(command==='DATA_FINAL'&&reply>=200&&reply<300){finalCode=reply;terminal=true;emit('ACCEPTED',{code:reply});}
   else if(reply>=400&&['MAIL','RCPT','DATA','DATA_FINAL'].includes(command)){rejection=reply;emit('REJECTED',{code:reply});}
  }else if(meta.tnx==='message'&&Number.isFinite(meta.outByteCount))emit('DATA_STREAM_COMPLETED');
  else if(meta.tnx==='network'&&message==='Connection closed')emit('CLOSED');
 }
 const logger=Object.fromEntries(['trace','debug','info','warn','error','fatal'].map(level=>[level,log]));
 return {logger,snapshot,error,
  async start(){emit('CONNECTION_INITIATED');await pending;if(persistenceFailure){coverage=true;category='diagnostic_storage';terminal=true;emit('ERROR',{category});throw new SchedulingDeliveryError(snapshot());}},
  async finish(result,to){
   const reply=typeof result?.response==='string'?code(Number(/^([2-5]\d{2})\b/.exec(result.response)?.[1])):null;
   const accepted=Array.isArray(result?.accepted)&&result.accepted.length===1&&typeof result.accepted[0]==='string'&&result.accepted[0].toLowerCase()===to.toLowerCase()&&!result.rejected?.length&&!result.pending?.length;
   if(accepted&&reply>=200&&reply<300){finalCode=reply;terminal=true;emit('ACCEPTED',{code:reply});}
   else if(reply>=400){rejection=reply;terminal=true;emit('REJECTED',{code:reply});}
   else if(!finalCode){terminal=true;emit('AMBIGUOUS');}
   await pending;return snapshot();
  },async flush(){await pending;return snapshot();}
 };
}
