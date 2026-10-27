import {randomUUID,createHash} from 'node:crypto';
import {MeetingError} from './meeting-management.mjs';
import {createWhiteboardProvider} from './whiteboard-ai-provider.mjs';
import {createWhiteboardCloud} from './whiteboard-cloud.mjs';
import {validateElement,validObjectId} from '../../frontend/src/lib/whiteboardModel.js';
import {templateDiagram,layoutDiagram,sourceAnalysis,validateAnalysis,clusterEdits,offsetProposal,analysisText,diagramTemplates} from '../../frontend/src/lib/whiteboardIntelligence.js';
const fail=(status,code,message)=>{throw new MeetingError(status,code,message);};
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const boundedText=(value,n)=>typeof value==='string'&&value.length<=n&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
export function createWhiteboardAI({db,whiteboards,provider=createWhiteboardProvider(),cloudProvider,cloudExecutionGate,now=Date.now,autoStart=true}){
  const get=(sql,...args)=>db.prepare(sql).get(...args),all=(sql,...args)=>db.prepare(sql).all(...args),run=(sql,...args)=>db.prepare(sql).run(...args);
  let stopped=false,working=false;const active=new Map();
  const transaction=(id,fn)=>whiteboards.transaction(id,fn);
  const cloud=createWhiteboardCloud({db,whiteboards,provider:cloudProvider,executionGate:cloudExecutionGate,now});
  const audit=(board,actor,action,detail={})=>run('INSERT INTO talk_whiteboard_events(id,board_id,actor_account_id,action,detail_json,created_at) VALUES(?,?,?,?,?,?)',randomUUID(),board.id,actor,action,JSON.stringify(detail),now());
  const session=row=>({account_id:row.requested_by,token_hash:row.session_hash});
  async function rowFor(meetingId,person,id,edit=false){const access=await whiteboards.authorize(meetingId,person,edit),row=await get('SELECT * FROM talk_whiteboard_ai_jobs WHERE id=? AND board_id=? AND expires_at>?',id,access.board.id,now());if(!row)fail(404,'whiteboard_ai_missing','This private proposal is unavailable.');return {access,row};}
  const manageable=(access,row,person)=>{if(row.requested_by!==person.account_id&&!access.manages)fail(403,'whiteboard_ai_owner','Only the requester or a host can manage this proposal.');};
  const publicJob=(row,access,person)=>({id:row.id,operation:row.operation,mode:row.execution_kind==='cloud'?'cloud':row.mode,provider:row.provider,model:row.model,usage:row.usage_json?JSON.parse(row.usage_json):null,status:row.status,sourceRevision:row.source_revision,
    stale:Number(access.board.revision)!==Number(row.source_revision),version:row.version,createdAt:row.created_at,errorCode:row.error_code,
    result:row.result_json?JSON.parse(row.result_json):null,review:row.review_json?JSON.parse(row.review_json):null,
    sources:JSON.parse(row.source_json),selectionCount:JSON.parse(row.selection_json).length,canManage:access.canEdit&&(access.manages||row.requested_by===person.account_id),appliedRevision:row.applied_revision});
  async function capabilities(meetingId,person){await whiteboards.authorize(meetingId,person);return {cloud:cloud.status(),provider:{configured:!!provider.configured,name:provider.provider||'ollama-local',model:provider.model||null,reason:provider.reason||'Local provider unavailable.'},templates:diagramTemplates,handwriting:{configured:false,reason:'No reliable handwriting text recognizer is configured. Shape recognition does not read words.'},limits:{notes:32,sourceBytes:12000,objects:80}};}
  async function list(meetingId,person){const access=await whiteboards.authorize(meetingId,person);return {jobs:(await all('SELECT * FROM talk_whiteboard_ai_jobs WHERE board_id=? AND expires_at>? ORDER BY created_at DESC LIMIT 20',access.board.id,now())).map(row=>({id:row.id,status:row.status,operation:row.operation,mode:row.execution_kind==='cloud'?'cloud':row.mode,createdAt:row.created_at}))};}
  async function read(meetingId,person,id){const {row,access}=await rowFor(meetingId,person,id);return publicJob(row,access,person);}
  async function enqueue(meetingId,person,operation,body){
    if(!['generate','summarize','cluster'].includes(operation)||!validObjectId(body?.requestId)||!['template','rules','ollama'].includes(body?.mode)||!boundedText(body?.prompt||'',2000))fail(400,'whiteboard_ai_input','Choose a valid mode and a prompt under 2,000 characters.');
    if(operation==='generate'&&body.mode==='rules'||operation!=='generate'&&body.mode==='template'||operation==='generate'&&body.mode==='template'&&!diagramTemplates.includes(body.template))fail(400,'whiteboard_ai_input','Choose a compatible template or analysis mode.');
    if(!Array.isArray(body.selectedIds)||body.selectedIds.length>32||new Set(body.selectedIds).size!==body.selectedIds.length||!body.selectedIds.every(validObjectId))fail(400,'whiteboard_ai_selection','Choose up to 32 notes or objects.');
    if(body.consent!==true)fail(400,'whiteboard_ai_consent','Confirm the displayed prompt or note selection before processing.');
    if(body.mode==='ollama'&&!provider.configured)fail(503,'whiteboard_provider_disabled','AI model not configured. Templates and source-based rules work without a model.');
    return transaction(meetingId,async()=>{
      const access=await whiteboards.authorize(meetingId,person,true),{board}=access;
      const hash=digest({operation,mode:body.mode,prompt:body.prompt||'',template:body.template||null,selectedIds:body.selectedIds,sourceRevision:body.sourceRevision});
      const old=await get('SELECT * FROM talk_whiteboard_ai_jobs WHERE board_id=? AND requested_by=? AND request_id=?',board.id,person.account_id,body.requestId);
      if(old){if(old.request_hash!==hash)fail(409,'whiteboard_ai_idempotency','This request identifier was already used for different input.');return publicJob(old,access,person);}
      if(body.sourceRevision!==Number(board.revision))fail(409,'whiteboard_ai_stale','The board changed. Review your selection and try again.');
      const quota=await get('SELECT COUNT(*) AS n FROM talk_whiteboard_ai_jobs WHERE board_id=?',board.id);if(Number(quota.n)>=20)fail(429,'whiteboard_ai_quota','This board has twenty proposals. Delete an old proposal before continuing.');
      const elements=Object.values(JSON.parse(board.state_json)),selected=body.selectedIds.map(id=>elements.find(e=>e.id===id));if(selected.some(e=>!e))fail(409,'whiteboard_ai_stale','A selected object no longer exists.');
      const notes=(operation==='generate'?[]:body.selectedIds.length?selected:elements).filter(e=>['sticky','text'].includes(e.type)&&e.text.trim()).map(e=>({id:e.id,type:e.type,version:e.version,text:e.text,x:e.x,y:e.y,width:e.width,height:e.height,rotation:e.rotation}));
      if(operation!=='generate'&&(!notes.length||notes.length>32||Buffer.byteLength(JSON.stringify(notes))>12000))fail(413,'whiteboard_ai_source_limit','Select 1–32 text notes with at most 12 KB of source data. No notes were silently omitted.');
      const id=randomUUID(),stamp=now(),mode=body.mode;
      await run("INSERT INTO talk_whiteboard_ai_jobs(id,board_id,meeting_id,requested_by,session_hash,request_id,request_hash,operation,mode,template,prompt,provider,model,source_revision,source_json,selection_json,status,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'queued',?,?,?)",id,board.id,meetingId,person.account_id,person.token_hash,body.requestId,hash,operation,mode,body.template||null,body.prompt||'',mode==='ollama'?provider.provider:'local-'+mode,mode==='ollama'?provider.model:null,Number(board.revision),JSON.stringify(notes),JSON.stringify(selected.map(e=>({id:e.id,version:e.version}))),stamp,stamp,board.expires_at);
      await audit(board,person.account_id,'intelligence_requested',{jobId:id,operation,mode,sourceRevision:Number(board.revision),sourceCount:notes.length});
      return publicJob(await get('SELECT * FROM talk_whiteboard_ai_jobs WHERE id=?',id),access,person);
    });
  }
  async function processOne(){
    const claim=randomUUID(),row=await get("UPDATE talk_whiteboard_ai_jobs SET status='processing',claim_id=?,claimed_at=?,attempts=attempts+1,updated_at=?,version=version+1 WHERE id=(SELECT id FROM talk_whiteboard_ai_jobs WHERE expires_at>? AND attempts<2 AND (status='queued' OR status='processing' AND claimed_at<?) ORDER BY created_at LIMIT 1) AND (status='queued' OR status='processing' AND claimed_at<?) RETURNING *",claim,now(),now(),now(),now()-120000,now()-120000);
    if(!row)return false;
    const controller=new AbortController();active.set(row.id,controller);
    const heartbeat=setInterval(()=>void db.withContext(async()=>{
      const updated=await run("UPDATE talk_whiteboard_ai_jobs SET claimed_at=? WHERE id=? AND status='processing' AND claim_id=?",now(),row.id,claim);
      if(!updated.changes)controller.abort();
    }).catch(()=>controller.abort()),10000);heartbeat.unref();
    try{
      await whiteboards.authorize(row.meeting_id,session(row),true);const sources=JSON.parse(row.source_json);let result;
      if(row.execution_kind==='cloud'){
        const {output,usage}=await cloud.generate(row,controller.signal);controller.signal.throwIfAborted();
        result=row.operation==='generate'?{kind:'diagram',title:output.title,elements:layoutDiagram(output)}:{kind:'analysis',analysis:validateAnalysis(output,sources)};
        await cloud.finish(row,true,usage);
      }else if(row.mode==='template')result={kind:'diagram',title:row.prompt||'Planning board',elements:layoutDiagram(templateDiagram(row.template,row.prompt))};
      else if(row.mode==='rules')result={kind:'analysis',analysis:sourceAnalysis(sources,row.prompt.slice(0,160)||'Brainstorm review')};
      else {
        const output=await provider.generate({operation:row.operation,prompt:row.prompt,sources,signal:controller.signal});controller.signal.throwIfAborted();
        result=row.operation==='generate'?{kind:'diagram',title:output.title,elements:layoutDiagram(output)}:{kind:'analysis',analysis:validateAnalysis(output,sources)};
      }
      if(Buffer.byteLength(JSON.stringify(result))>180000)throw new Error('Oversized result');
      await transaction(row.meeting_id,async()=>{const access=await whiteboards.authorize(row.meeting_id,session(row),true);controller.signal.throwIfAborted();
        const saved=await run("UPDATE talk_whiteboard_ai_jobs SET status='review_required',result_json=?,error_code=NULL,updated_at=?,version=version+1 WHERE id=? AND status='processing' AND claim_id=?",JSON.stringify(result),now(),row.id,claim);
        if(saved.changes)await audit(access.board,row.requested_by,'intelligence_ready',{jobId:row.id});});
    }catch(error){
      if(row.execution_kind==='cloud')await cloud.finish(row,false);
      const cloudCodes=new Set(['cloud_release_blocked','cloud_disabled','cloud_stale','cloud_consent','cloud_payload_changed','cloud_already_sent','cloud_timeout','cloud_cancelled','cloud_rate_limited','cloud_incomplete','cloud_invalid_json','cloud_response_limit','cloud_provider_error','cloud_destination','cloud_connection']);
      const reason=error?.code==='whiteboard_provider_resources'?'low_memory':row.execution_kind==='cloud'&&cloudCodes.has(error?.code)?error.code:'generation_failed';
      await run("UPDATE talk_whiteboard_ai_jobs SET status='failed',error_code=?,updated_at=?,version=version+1 WHERE id=? AND status='processing' AND claim_id=?",reason,now(),row.id,claim);
    }finally{clearInterval(heartbeat);active.delete(row.id);}
    return true;
  }
  async function tick(){if(stopped||working)return;working=true;try{await db.withContext(async()=>{
    await run("UPDATE talk_whiteboard_ai_jobs SET status='failed',error_code='interrupted',version=version+1,updated_at=? WHERE status='processing' AND attempts>=2 AND claimed_at<?",now(),now()-120000);
    await run('DELETE FROM talk_whiteboard_ai_jobs WHERE expires_at<=?',now());
    await cloud.cleanup();
    await processOne();});}catch{/* Content and provider errors never enter logs. */}finally{working=false;}}
  const timer=autoStart?setInterval(()=>void tick(),500):null;timer?.unref();
  async function change(meetingId,person,id,action,body){
    return transaction(meetingId,async()=>{const {access,row}=await rowFor(meetingId,person,id,true);manageable(access,row,person);
      if(action==='cancel'){
        if(row.status==='applied')fail(409,'whiteboard_ai_applied','Use your whiteboard undo history to reverse an applied proposal.');
        await run("UPDATE talk_whiteboard_ai_jobs SET status='cancelled',result_json=NULL,review_json=NULL,updated_at=?,version=version+1 WHERE id=?",now(),id);active.get(id)?.abort();
      }else if(action==='delete'){active.get(id)?.abort();await run('DELETE FROM talk_whiteboard_ai_jobs WHERE id=?',id);await audit(access.board,person.account_id,'intelligence_deleted',{jobId:id});return {deleted:true};}
      else if(action==='retry'){
        if(row.execution_kind==='cloud')fail(409,'cloud_fresh_consent','Cloud retries require a new request and fresh data-sharing approval. An uncertain request is never resent automatically.');
        if(row.status!=='failed'||row.retries>=2)fail(409,'whiteboard_ai_retry','This proposal cannot be retried. Create a new request.');
        if(row.mode==='ollama'&&!provider.configured)fail(503,'whiteboard_provider_disabled','The approved local model is unavailable.');
        await run("UPDATE talk_whiteboard_ai_jobs SET status='queued',session_hash=?,attempts=0,retries=retries+1,error_code=NULL,claimed_at=NULL,claim_id=NULL,updated_at=?,version=version+1 WHERE id=?",person.token_hash,now(),id);
        // Preserve requester identity for restart authorization; a host cannot
        // silently substitute its session for another requester's inference.
        if(person.account_id!==row.requested_by)fail(403,'whiteboard_ai_owner','The original requester must retry with a fresh session.');
      }else if(action==='review'){
        if(row.status!=='review_required'||row.version!==body?.expectedVersion||!boundedText(body?.notes,4000)||!boundedText(body?.editedSummary||'',4000)||typeof body?.approved!=='boolean')fail(409,'whiteboard_ai_review','Review the latest completed proposal before saving.');
        const actions=body.actions||[],result=JSON.parse(row.result_json);
        if(!Array.isArray(actions)||actions.length>32||new Set(actions.map(a=>a?.sourceId)).size!==actions.length||actions.some(a=>!a||Object.keys(a).some(k=>!['sourceId','title','owner','deadline','status'].includes(k))||!result.analysis?.actions.some(original=>original.sourceIds[0]===a.sourceId)||!boundedText(a.title,500)||!boundedText(a.owner,100)||!boundedText(a.deadline,100)||!['proposed','approved','dismissed'].includes(a.status)))fail(400,'whiteboard_ai_review','Action review fields must reference the original evidence.');
        const review={notes:body.notes,editedSummary:body.editedSummary||'',actions,approved:body.approved,reviewerId:person.account_id,reviewedAt:now()};
        await run('UPDATE talk_whiteboard_ai_jobs SET review_json=?,updated_at=?,version=version+1 WHERE id=?',JSON.stringify(review),now(),id);
      }else fail(400,'whiteboard_ai_action','Unknown proposal action.');
      await audit(access.board,person.account_id,'intelligence_'+action,{jobId:id});return publicJob(await get('SELECT * FROM talk_whiteboard_ai_jobs WHERE id=?',id),access,person);
    });
  }
  async function apply(meetingId,person,id,body){
    return whiteboards.applyPrepared(meetingId,person,async access=>{
      const {row}=await rowFor(meetingId,person,id,true);manageable(access,row,person);
      if(row.status==='applied'){const previous=await get('SELECT * FROM talk_whiteboard_operations WHERE board_id=? AND request_id=?',row.board_id,id);return {replay:{revision:previous.revision,changes:JSON.parse(previous.changes_json),idempotent:true}};}
      if(row.status!=='review_required'||row.version!==body?.expectedVersion||!['current','new-area','replace','organize','summary'].includes(body?.placement))fail(409,'whiteboard_ai_not_ready','Review the latest completed proposal first.');
      if(body.currentRevision!==Number(access.board.revision)||Number(row.source_revision)!==Number(access.board.revision)&&body.acknowledgeStale!==true)fail(409,'whiteboard_ai_stale','The board changed. Refresh, review the warning and confirm the current revision.');
      const result=JSON.parse(row.result_json),current=Object.values(JSON.parse(access.board.state_json)),sources=JSON.parse(row.source_json),selection=JSON.parse(row.selection_json);let edits=[],elements=[];
      if(body.placement==='organize'){
        if(result.kind!=='analysis')fail(400,'whiteboard_ai_apply','Only note analysis can organize notes.');
        for(const source of sources)if(current.find(e=>e.id===source.id)?.version!==source.version)fail(409,'whiteboard_ai_stale','A source note changed. Generate a new organization proposal.');
        const clustered=clusterEdits(result.analysis,sources);edits=clustered.edits;elements=clustered.headings;
        // New headings are offset together with existing notes into a free area.
        const x=current.length?Math.max(...current.map(e=>e.x+e.width))+120:100;
        edits=edits.map(e=>({...e,patch:{...e.patch,x:e.patch.x+x,y:e.patch.y+100}}));elements=elements.map(e=>({...e,x:e.x+x,y:e.y+100}));
      }else{
        if(result.kind==='diagram')elements=result.elements.map(e=>validateElement(e));
        else {const content=analysisText(result.analysis,row.review_json?JSON.parse(row.review_json):null,row.source_revision);elements=[];for(let start=0;start<content.length;start+=3000)elements.push(validateElement({id:'summary-'+start,type:'text',x:0,y:elements.length*1700,width:900,height:1650,fontSize:18,text:content.slice(start,start+3000),stroke:'#204563'}));}
        if(body.placement==='replace'){
          if(body.confirmReplace!==true||!selection.length||selection.length>20)fail(400,'whiteboard_ai_confirmation','Explicitly confirm replacement of 1–20 captured selected objects.');
          for(const item of selection){if(current.find(e=>e.id===item.id)?.version!==item.version)fail(409,'whiteboard_ai_stale','A selected object changed. It was not replaced.');edits.push({kind:'delete',id:item.id,expectedVersion:item.version});}
        }
        const point=body.point||{x:100,y:100};if(!Number.isFinite(point.x)||!Number.isFinite(point.y)||Math.abs(point.x)>90000||Math.abs(point.y)>90000)fail(400,'whiteboard_ai_position','Choose a position inside the canvas.');
        try{elements=offsetProposal(elements,current,body.placement==='current'||body.placement==='replace'?'current':'new-area',point);}catch{fail(400,'whiteboard_ai_position','This proposal will not fit inside the canvas limits. Choose a smaller diagram or another area.');}
      }
      for(const element of elements){let native;try{native=validateElement({...element,id:randomUUID()});}catch{fail(400,'whiteboard_ai_position','The proposed arrangement exceeds the canvas limits. No objects were changed.');}edits.push({kind:'create',id:native.id,element:native});}
      return {body:{requestId:id,edits}};
    },async(committed,access)=>{await run("UPDATE talk_whiteboard_ai_jobs SET status='applied',applied_revision=?,updated_at=?,version=version+1 WHERE id=?",committed.revision,now(),id);await audit(access.board,person.account_id,'intelligence_applied',{jobId:id,revision:committed.revision});});
  }
  return {capabilities,list,read,enqueue,change,apply,tick,cloud,shutdown:async()=>{stopped=true;if(timer)clearInterval(timer);for(const controller of active.values())controller.abort();while(working)await new Promise(resolve=>setTimeout(resolve,20));}};
}
