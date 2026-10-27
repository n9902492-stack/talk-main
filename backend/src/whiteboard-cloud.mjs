import {randomUUID,randomBytes,timingSafeEqual} from 'node:crypto';
import {MeetingError} from './meeting-management.mjs';
import {validObjectId} from '../../frontend/src/lib/whiteboardModel.js';
import {CLOUD_EXTERNAL_RELEASE_APPROVED,createCloudWhiteboardProvider,cloudHash} from './whiteboard-cloud-provider.mjs';
const fail=(status,code)=>{throw new MeetingError(status,code,'Cloud AI is disabled, access changed or fresh approval is required. Review the current selection and provider settings.');};
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export function createWhiteboardCloud({db,whiteboards,provider=createCloudWhiteboardProvider(),now=Date.now,executionGate=()=>CLOUD_EXTERNAL_RELEASE_APPROVED}){
  const get=(sql,...args)=>db.prepare(sql).get(...args),run=(sql,...args)=>db.prepare(sql).run(...args);
  const executable=()=>provider.configured&&provider.enabled&&executionGate()===true;
  const status=()=>({configured:!!provider.configured,status:provider.configured&&!executable()?'disabled':provider.status||'disabled',enabled:!!executable(),provider:provider.provider||null,model:provider.model||null,destination:provider.endpoint||null,reason:provider.reason,limits:provider.limits||null});
  const authorize=(row)=>whiteboards.authorize(row.meeting_id,{account_id:row.requested_by,token_hash:row.session_hash},true);
  const prepare=input=>{try{return provider.prepare(input);}catch(error){if(error?.code==='cloud_input_limit')throw new MeetingError(413,'cloud_input_limit','This request exceeds the configured cloud input limit. Use a smaller prompt or select fewer notes.');fail(503,'cloud_configuration');}};
  const data=(board,operation,body)=>{
    if(!['generate','summarize','cluster'].includes(operation)||typeof body?.prompt!=='string'||body.prompt.length>2000||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(body.prompt))fail(400,'cloud_input');
    const scope=operation==='generate'?'prompt':body.scope||'selected';
    if(!['prompt','selected','all'].includes(scope)||operation!=='generate'&&scope==='prompt'||operation==='generate'&&!body.prompt.trim()||scope==='all'&&body.includeAll!==true)fail(400,'cloud_scope');
    if(!Array.isArray(body.selectedIds)||body.selectedIds.length>32||new Set(body.selectedIds).size!==body.selectedIds.length||!body.selectedIds.every(validObjectId)||scope==='prompt'&&body.selectedIds.length||scope==='all'&&body.selectedIds.length)fail(400,'cloud_selection');
    if(Number(board.revision)!==body.sourceRevision)fail(409,'cloud_stale');
    const elements=Object.values(JSON.parse(board.state_json)),selected=scope==='selected'?body.selectedIds.map(id=>elements.find(e=>e.id===id)):[];
    if(selected.some(e=>!e||!['text','sticky'].includes(e.type)))fail(400,'cloud_selection');
    const sources=(scope==='all'?elements:scope==='selected'?selected:[]).filter(e=>['text','sticky'].includes(e.type)&&e.text.trim()).map(e=>({id:e.id,type:e.type,version:e.version,text:e.text,x:e.x,y:e.y,width:e.width,height:e.height,rotation:e.rotation}));
    if(operation!=='generate'&&(!sources.length||sources.length>32||Buffer.byteLength(JSON.stringify(sources))>12000))fail(413,'cloud_source_limit');
    return {scope,sources,selection:sources.map(e=>({id:e.id,version:e.version}))};
  };
  async function preview(meetingId,person,body){
    return whiteboards.transaction(meetingId,async()=>{
      const {board}=await whiteboards.authorize(meetingId,person,true);
      if(!provider.configured)fail(503,'cloud_not_configured');
      const captured=data(board,body.operation,body),prepared=prepare({operation:body.operation,prompt:body.prompt,sources:captured.sources});
      await cleanup();
      const count=await get("SELECT COUNT(*) AS n FROM talk_whiteboard_ai_approvals WHERE board_id=? AND state='awaiting'",board.id);if(Number(count.n)>=20)fail(429,'cloud_approval_limit');
      const id=randomUUID(),proof=randomBytes(32).toString('hex'),stamp=now();
      await run("INSERT INTO talk_whiteboard_ai_approvals(id,board_id,meeting_id,requested_by,session_hash,operation,scope,source_revision,source_json,selection_json,prompt,wire_json,payload_hash,config_hash,proof_hash,executable,state,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'awaiting',?,?)",id,board.id,meetingId,person.account_id,person.token_hash,body.operation,captured.scope,Number(board.revision),JSON.stringify(captured.sources),JSON.stringify(captured.selection),body.prompt,prepared.body,prepared.hash,provider.fingerprint,cloudHash(proof),executable()?1:0,stamp,Math.min(stamp+300000,Number(board.expires_at)));
      return {id,proof,payloadHash:prepared.hash,state:'awaiting_user_consent',canConfirm:!!executable(),expiresAt:stamp+300000,provider:provider.provider,destination:provider.endpoint,model:provider.model,operation:body.operation,scope:captured.scope,sourceRevision:Number(board.revision),sourceCount:captured.sources.length,request:body.prompt,
        categories:['Typed request',...(captured.sources.length?['Text of explicitly approved notes','Opaque source object IDs']:[]),'Fixed instructions and JSON schema'],imagesIncluded:false,recordingsIncluded:false,transcriptsIncluded:false,exactPayload:JSON.parse(prepared.body),inputEstimate:prepared.inputEstimate,outputLimit:provider.limits.output,estimatedCost:prepared.cost,
        warning:'An external provider would process this content. API usage may incur charges. Estimates are not a guaranteed billing cap. External inference remains blocked in this development release.'};
    });
  }
  async function ticket(meetingId,person,body){
    if(!validObjectId(body?.id)||typeof body?.proof!=='string'||!/^[a-f0-9]{64}$/.test(body.proof))fail(403,'cloud_consent');
    const {board}=await whiteboards.authorize(meetingId,person,true),row=await get('SELECT * FROM talk_whiteboard_ai_approvals WHERE id=? AND board_id=?',body?.id||'',board.id);
    if(!row||row.requested_by!==person.account_id||row.session_hash!==person.token_hash||!same(row.proof_hash,cloudHash(body?.proof||'')))fail(403,'cloud_consent');
    return row;
  }
  async function confirm(meetingId,person,body){
    return whiteboards.transaction(meetingId,async()=>{
      const row=await ticket(meetingId,person,body);
      if(!executable()||row.executable!==1)fail(503,'cloud_release_blocked');
      if(body?.confirm!==true||!same(body?.payloadHash,row.payload_hash)||row.expires_at<=now()||row.state==='cancelled'||row.config_hash!==provider.fingerprint)fail(409,'cloud_fresh_consent');
      if(row.state==='consumed'){const old=await get('SELECT id FROM talk_whiteboard_ai_jobs WHERE id=?',row.job_id);if(!old)fail(409,'cloud_consent_consumed');return {jobId:old.id,idempotent:true};}
      const access=await authorize(row);
      const sources=JSON.parse(row.source_json);verifySources(row,access.board,sources);
      const prepared=prepare({operation:row.operation,prompt:row.prompt,sources});if(prepared.hash!==row.payload_hash||prepared.body!==row.wire_json)fail(409,'cloud_fresh_consent');
      await db.lockIdentity?.('whiteboard-cloud-usage');
      await checkLimits(row,prepared);
      const quota=await get('SELECT COUNT(*) AS n FROM talk_whiteboard_ai_jobs WHERE board_id=?',row.board_id);if(Number(quota.n)>=20)fail(429,'cloud_job_limit');
      const id=randomUUID(),stamp=now();
      // Keep the legacy mode CHECK intact; execution_kind determines dispatch.
      await run("INSERT INTO talk_whiteboard_ai_jobs(id,board_id,meeting_id,requested_by,session_hash,request_id,request_hash,operation,mode,prompt,provider,model,source_revision,source_json,selection_json,status,created_at,updated_at,expires_at,execution_kind,cloud_approval_id) VALUES(?,?,?,?,?,?,?,?,'ollama',?,?,?,?,?,?,'queued',?,?,?,'cloud',?)",id,row.board_id,meetingId,person.account_id,person.token_hash,row.id,row.payload_hash,row.operation,row.prompt,provider.provider,provider.model,row.source_revision,row.source_json,row.selection_json,stamp,stamp,access.board.expires_at,row.id);
      await run("INSERT INTO talk_whiteboard_ai_usage(id,job_id,approval_id,board_id,meeting_id,account_id,provider,model,status,input_estimate,output_limit,currency,reserved_microunits,created_at) VALUES(?,?,?,?,?,?,?,?,'reserved',?,?,?,?,?)",randomUUID(),id,row.id,row.board_id,meetingId,person.account_id,provider.provider,provider.model,prepared.inputEstimate,provider.limits.output,prepared.cost?.currency||null,prepared.cost?.microunits??null,stamp);
      await run("UPDATE talk_whiteboard_ai_approvals SET state='consumed',job_id=?,source_json='[]',selection_json='[]',prompt='',wire_json='' WHERE id=?",id,row.id);
      await run('INSERT INTO talk_whiteboard_events(id,board_id,actor_account_id,action,detail_json,created_at) VALUES(?,?,?,?,?,?)',randomUUID(),row.board_id,person.account_id,'cloud_ai_confirmed',JSON.stringify({jobId:id,payloadHash:row.payload_hash}),stamp);
      return {jobId:id};
    });
  }
  async function checkLimits(row,prepared){
    const since=now()-3600000,month=new Date(now());month.setUTCDate(1);month.setUTCHours(0,0,0,0);
    const user=await get('SELECT COUNT(*) AS n FROM talk_whiteboard_ai_usage WHERE account_id=? AND created_at>?',row.requested_by,since),meeting=await get('SELECT COUNT(*) AS n FROM talk_whiteboard_ai_usage WHERE meeting_id=? AND created_at>?',row.meeting_id,since),busy=await get("SELECT COUNT(*) AS n FROM talk_whiteboard_ai_usage WHERE status IN('reserved','sent')");
    if(Number(user.n)>=provider.limits.user||Number(meeting.n)>=provider.limits.meeting||Number(busy.n)>=provider.limits.concurrent)fail(429,'cloud_usage_limit');
    if(provider.pricing.limit!==null){const used=await get('SELECT COALESCE(SUM(reserved_microunits),0) AS n FROM talk_whiteboard_ai_usage WHERE currency=? AND created_at>=?',provider.pricing.currency,month.getTime());if(Number(used.n)+prepared.cost.microunits>Math.floor(provider.pricing.limit*1000000))fail(429,'cloud_estimated_budget');}
  }
  function verifySources(row,board,sources){
    if(Number(board.revision)!==Number(row.source_revision))fail(409,'cloud_stale');
    const elements=JSON.parse(board.state_json);
    for(const source of sources)if(elements[source.id]?.version!==source.version||elements[source.id]?.text!==source.text)fail(409,'cloud_stale');
  }
  async function validateJob(job){
    if(!executable())fail(503,'cloud_release_blocked');
    const access=await authorize(job),approval=await get('SELECT * FROM talk_whiteboard_ai_approvals WHERE id=? AND job_id=?',job.cloud_approval_id,job.id);
    if(!approval||approval.state!=='consumed'||approval.executable!==1||approval.expires_at<=now()||approval.config_hash!==provider.fingerprint||approval.requested_by!==job.requested_by||approval.session_hash!==job.session_hash||approval.operation!==job.operation||Number(approval.source_revision)!==Number(job.source_revision))fail(409,'cloud_consent');
    const sources=JSON.parse(job.source_json);verifySources(job,access.board,sources);
    const prepared=prepare({operation:job.operation,prompt:job.prompt,sources});
    if(prepared.hash!==approval.payload_hash||job.request_hash!==prepared.hash)fail(409,'cloud_payload_changed');
    const current=await get('SELECT * FROM talk_whiteboard_ai_jobs WHERE id=?',job.id);
    if(current?.status!=='processing'||current.claim_id!==job.claim_id)fail(409,'cloud_cancelled');
    const usage=await get('SELECT status FROM talk_whiteboard_ai_usage WHERE job_id=?',job.id);
    if(usage?.status!=='reserved')fail(409,'cloud_already_sent');
    return prepared;
  }
  async function generate(job,signal){
    const prepared=await validateJob(job);
    return provider.generate({prepared,signal,beforeSend:async()=>whiteboards.transaction(job.meeting_id,async()=>{
      await validateJob(job);signal.throwIfAborted();
      const changed=await run("UPDATE talk_whiteboard_ai_usage SET status='sent',sent_at=? WHERE job_id=? AND status='reserved'",now(),job.id);
      if(!changed.changes)fail(409,'cloud_already_sent');
    })});
  }
  async function finish(job,success,usage={}){
    const safe={};for(const key of ['prompt_tokens','completion_tokens','total_tokens'])if(Number.isSafeInteger(usage[key])&&usage[key]>=0)safe[key]=usage[key];
    await run("UPDATE talk_whiteboard_ai_usage SET status=?,usage_json=?,finished_at=? WHERE job_id=? AND status IN('reserved','sent')",success?'completed':'failed',JSON.stringify(safe),now(),job.id);
    await run('UPDATE talk_whiteboard_ai_jobs SET usage_json=? WHERE id=?',JSON.stringify(safe),job.id);
  }
  async function cancel(meetingId,person,body){return whiteboards.transaction(meetingId,async()=>{const row=await ticket(meetingId,person,body);if(row.state==='consumed')fail(409,'cloud_consent_consumed');await run("UPDATE talk_whiteboard_ai_approvals SET state='cancelled',source_json='[]',selection_json='[]',prompt='',wire_json='' WHERE id=?",row.id);return {cancelled:true};});}
  async function cleanup(){
    await run("DELETE FROM talk_whiteboard_ai_approvals WHERE state!='consumed' AND expires_at<=?",now());
    await run('DELETE FROM talk_whiteboard_ai_approvals WHERE state=\'consumed\' AND NOT EXISTS(SELECT 1 FROM talk_whiteboard_ai_jobs j WHERE j.id=talk_whiteboard_ai_approvals.job_id)');
    await run('DELETE FROM talk_whiteboard_ai_usage WHERE created_at<?',now()-62*86400000);
    await run("UPDATE talk_whiteboard_ai_usage SET status=CASE WHEN sent_at IS NULL THEN 'cancelled' ELSE 'unknown' END,finished_at=? WHERE status IN('reserved','sent') AND NOT EXISTS(SELECT 1 FROM talk_whiteboard_ai_jobs j WHERE j.id=talk_whiteboard_ai_usage.job_id AND j.status IN('queued','processing'))",now());
  }
  return {status,preview,confirm,cancel,generate,finish,cleanup};
}
