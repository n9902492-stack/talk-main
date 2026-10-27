// Phase-only diagnostics for a separately approved future one-shot test.
// Nothing opens a connection here. Never persist log messages, arguments,
// envelopes, AUTH payloads, provider text, bodies, URLs or raw errors.
const errorCodes=new Set(['EAUTH','ETIMEDOUT','ECONNECTION','ECONNRESET','ECONNREFUSED','ECONNABORTED','ESOCKET','EDNS','ENOTFOUND','EAI_AGAIN','ETLS','EPROTOCOL','EENVELOPE','EMESSAGE','ECOMPILE']);
const commandOf=value=>typeof value==='string'?/^(EHLO|HELO|STARTTLS|AUTH|MAIL|RCPT|DATA|RSET|QUIT|CONN)\b/.exec(value)?.[1]||null:null;
const numericCode=value=>Number.isInteger(value)&&value>=200&&value<=599?value:null;
export function createConfirmationSmtpDiagnostics({now=Date.now}={}){
 let phase='verify';const events=[],connections=new Map();
 const phases={verify:{},send:{}};
 const emit=event=>events.push({at:now(),...event});
 const stateFor=meta=>{if(meta?.component!=='smtp-connection')return null;const key=meta.sid||'unspecified';if(!connections.has(key))connections.set(key,{phase,lastCommand:null});return connections.get(key);};
 function log(meta,message){
  const connection=stateFor(meta);if(!connection)return;const p=phases[connection.phase];
  if(meta.tnx==='client'){
   const command=commandOf(message);if(!command)return;connection.lastCommand=command;if(command==='DATA')p.dataCommand=true;
   emit({phase:connection.phase,event:'command',command});
  }else if(meta.tnx==='server'){
   const code=typeof message==='string'?numericCode(Number(/^([2-5]\d{2})(?:[ -]|$)/.exec(message)?.[1])):null;if(!code)return;
   emit({phase:connection.phase,event:'reply',command:connection.lastCommand,code});
   if(connection.lastCommand==='AUTH'&&code===235)p.authenticated=true;
   if(connection.lastCommand==='DATA'){
    if(!p.dataPermission&&(code>=200&&code<400))p.dataPermission=true;
    else if(p.dataPermission&&code>=200)p.finalCode=code;
   }
  }else if(meta.tnx==='message'&&Number.isFinite(meta.outByteCount)){
   p.localDataStreamEnded=true;emit({phase:connection.phase,event:'local_data_stream_ended'});
  }
 }
 const logger=Object.fromEntries(['trace','debug','info','warn','error','fatal'].map(level=>[level,log]));
 return {
  logger,begin(value){if(!['verify','send'].includes(value))throw new Error('INVALID_DIAGNOSTIC_PHASE');phase=value;phases[phase].began=true;emit({phase,event:'phase_started'});},
  error(error){const code=errorCodes.has(error?.code)?error.code:'UNKNOWN',command=commandOf(error?.command),responseCode=numericCode(error?.responseCode);phases[phase].error={code,command,responseCode};emit({phase,event:'transport_error',code,command,responseCode});},
  snapshot(){const send=phases.send;const classification=send.finalCode>=200&&send.finalCode<300?'confirmed_smtp_accepted':send.error&&!send.dataPermission||!send.began&&phases.verify.error?'confirmed_not_submitted':'unknown_ambiguous';
   return structuredClone({classification,verifyAuthenticationObserved:phases.verify.authenticated===true,sendAuthenticationObserved:send.authenticated===true,dataCommandObserved:send.dataCommand===true,dataPermissionObserved:send.dataPermission===true,localDataStreamEnded:send.localDataStreamEnded===true,finalSmtpCode:send.finalCode??null,error:send.error??phases.verify.error??null,events});}
 };
}
