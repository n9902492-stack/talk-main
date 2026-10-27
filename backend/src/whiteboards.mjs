import { createHash, randomUUID } from 'node:crypto';
import { DataPacket_Kind } from 'livekit-server-sdk';
import sharp from 'sharp';
import { MeetingError } from './meeting-management.mjs';
import { normalizeProfileImage, avatarMaxBytes } from './avatars.mjs';
import { boardLimits, validateElement, validObjectId } from '../../frontend/src/lib/whiteboardModel.js';
export const whiteboardTopic = 'talk.whiteboard.v1';
const fail = (status, code, message) => { throw new MeetingError(status, code, message); };
const conflict = () => fail(409,'whiteboard_conflict','This object changed in another editor. Your change was not saved. Review the latest board and try again.');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function createWhiteboards({ db, manager, service, now = Date.now, retentionMs = 30 * 86400000 }) {
  const get = (sql,...args) => db.prepare(sql).get(...args), all = (sql,...args) => db.prepare(sql).all(...args), run = (sql,...args) => db.prepare(sql).run(...args);
  const presence = new Map();
  const audit = (board,actor,action,detail={}) => run('INSERT INTO talk_whiteboard_events(id,board_id,actor_account_id,action,detail_json,created_at) VALUES (?,?,?,?,?,?)',randomUUID(),board.id,actor,action,JSON.stringify(detail),now());
  async function transaction(meetingId, operation) {
    await db.exec('BEGIN IMMEDIATE');
    try { await db.lockIdentity(`meeting:${meetingId}`); const result = await operation(); await db.exec('COMMIT'); return result; }
    catch (error) { await db.exec('ROLLBACK'); throw error; }
  }
  async function authorize(meetingId, session) {
    const liveSession=await get('SELECT account_id FROM sessions WHERE token_hash=? AND account_id=? AND expires_at>? AND requires_confirmation=0',session.token_hash,session.account_id,now());
    if(!liveSession)fail(401,'sign_in_required','Sign in again to use this private whiteboard.');
    const meeting = await manager.meeting(meetingId), member = await manager.member(meetingId,session.account_id);
    const owner = meeting?.owner_account_id === session.account_id;
    const manages = owner || member?.role === 'cohost';
    if (!meeting || member?.admission !== 'admitted' || meeting.status === 'ended' && !manages) fail(404,'whiteboard_unavailable','This private whiteboard is not available.');
    return { meeting, member, owner, manages };
  }
  async function boardFor(meetingId, session, edit = false) {
    const access = await authorize(meetingId,session);
    const board = await get('SELECT * FROM talk_whiteboards WHERE meeting_id=? AND deleted_at IS NULL',meetingId);
    if (!board || Number(board.expires_at) <= now()) fail(404,'whiteboard_unavailable','No saved whiteboard is available. Ask the host to open one.');
    const permission = await get('SELECT can_edit FROM talk_whiteboard_permissions WHERE board_id=? AND account_id=?',board.id,session.account_id);
    const canEdit = access.owner || !board.locked && (access.manages || (permission ? !!permission.can_edit : !!board.default_edit));
    if (edit && !canEdit) fail(403,'whiteboard_view_only','This whiteboard is view-only. Ask the host for editing permission.');
    return { ...access, board, canEdit };
  }
  async function notify(meeting) {
    // Revision wake-up only; data packets are never trusted edits or history.
    if (service.admin?.sendData) void service.admin.sendData(meeting.room_name,new TextEncoder().encode('{}'),DataPacket_Kind.RELIABLE,{ topic:whiteboardTopic }).catch(()=>{});
  }
  async function prune(meetingId) {
    const expired = await all('SELECT id FROM talk_whiteboards WHERE meeting_id=? AND expires_at<=? AND deleted_at IS NULL',meetingId,now());
    for (const row of expired) {
      for (const table of ['talk_whiteboard_ai_jobs','talk_whiteboard_ai_approvals','talk_whiteboard_images','talk_whiteboard_permissions','talk_whiteboard_operations','talk_whiteboard_snapshots','talk_whiteboard_versions']) await run(`DELETE FROM ${table} WHERE board_id=?`,row.id);
      await run("UPDATE talk_whiteboards SET state_json='{}',deleted_at=?,history_bytes=0 WHERE id=?",now(),row.id);
      presence.delete(row.id);
    }
  }
  async function open(meetingId,session) {
    await transaction(meetingId,()=>prune(meetingId));
    return transaction(meetingId,async()=>{
      const access = await authorize(meetingId,session);
      if (!access.manages) fail(403,'whiteboard_host_required','Only the host or co-host can open a new whiteboard.');
      await prune(meetingId);
      const existing = await get('SELECT * FROM talk_whiteboards WHERE meeting_id=?',meetingId);
      if (existing?.deleted_at || existing && Number(existing.expires_at)<=now()) fail(410,'whiteboard_expired','This whiteboard has expired or was deleted.');
      if (!existing) {
        const id = randomUUID();
        await run('INSERT INTO talk_whiteboards(id,meeting_id,created_by,title,created_at,updated_at,expires_at) VALUES (?,?,?,?,?,?,?)',id,meetingId,session.account_id,`${access.meeting.title} — Whiteboard`,now(),now(),now()+Math.max(86400000,Math.min(90*86400000,retentionMs)));
        await run('INSERT INTO talk_whiteboard_snapshots(board_id,revision,state_json,created_at) VALUES (?,0,?,?)',id,'{}',now());
        await audit({id},session.account_id,'created');
      }
      return { opened:true };
    });
  }
  async function read(meetingId,session,since) {
    // Retention cleanup must commit even when the following read returns 404.
    await transaction(meetingId,()=>prune(meetingId));
    return transaction(meetingId,async()=>{
      await prune(meetingId);
      const access = await boardFor(meetingId,session), {board}=access;
      const peers = presence.get(board.id) || new Map();
      const cursors=[];
      for (const [accountId,value] of peers) {
        const member = value.at+8000>now() && await manager.member(meetingId,accountId);
        const liveSession = member && await get('SELECT account_id FROM sessions WHERE token_hash=? AND expires_at>? AND requires_confirmation=0',value.sessionHash,now());
        if (!member || member.admission!=='admitted' || !liveSession) { peers.delete(accountId); continue; }
        cursors.push({accountId,name:member.display_name,x:value.x,y:value.y,color:`#${hash(accountId).slice(0,6)}`});
      }
      const start = Number(since), delta = Number.isSafeInteger(start) && start>=0 && start<=Number(board.revision) && Number(board.revision)-start<=100;
      const events = delta ? await all('SELECT revision,changes_json FROM talk_whiteboard_operations WHERE board_id=? AND revision>? ORDER BY revision',board.id,start) : [];
      const members = access.manages ? await all("SELECT m.account_id AS id,m.display_name AS name,m.role,p.can_edit AS override FROM talk_meeting_members m LEFT JOIN talk_whiteboard_permissions p ON p.board_id=? AND p.account_id=m.account_id WHERE m.meeting_id=? AND m.admission='admitted'",board.id,meetingId) : [];
      return { board:{id:board.id,title:board.title,revision:Number(board.revision),locked:!!board.locked,defaultEdit:!!board.default_edit,updatedAt:Number(board.updated_at),expiresAt:Number(board.expires_at)},
        canEdit:access.canEdit,canManage:access.manages,isOwner:access.owner,ended:access.meeting.status==='ended',members,cursors,
        ...(delta ? {operations:events.map(row=>({revision:Number(row.revision),changes:JSON.parse(row.changes_json)}))} : {elements:Object.values(JSON.parse(board.state_json))}) };
    });
  }
  async function commit(access,session,requestId,requestHash,changes,before,after,state) {
    const {board}=access, revision=Number(board.revision)+1;
    const stateJson=JSON.stringify(state), beforeJson=JSON.stringify(before), afterJson=JSON.stringify(after), changesJson=JSON.stringify(changes);
    const bytes=Buffer.byteLength(beforeJson+afterJson+changesJson);
    if (Object.keys(state).length>boardLimits.elements || Buffer.byteLength(stateJson)>boardLimits.stateBytes || Number(board.history_bytes)+bytes>boardLimits.historyBytes || revision>boardLimits.operations) fail(413,'whiteboard_limit','This board reached its storage limit. Export it before continuing.');
    await run('INSERT INTO talk_whiteboard_operations(board_id,revision,request_id,actor_account_id,request_hash,changes_json,before_json,after_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)',board.id,revision,requestId,session.account_id,requestHash,changesJson,beforeJson,afterJson,now());
    await run('UPDATE talk_whiteboards SET state_json=?,revision=?,history_bytes=history_bytes+?,updated_at=? WHERE id=?',stateJson,revision,bytes,now(),board.id);
    for(const change of changes) await run('INSERT INTO talk_whiteboard_versions(board_id,object_id,revision) VALUES (?,?,?) ON CONFLICT(board_id,object_id) DO UPDATE SET revision=excluded.revision',board.id,change.id,revision);
    if (revision%25===0) {
      await run('INSERT INTO talk_whiteboard_snapshots(board_id,revision,state_json,created_at) VALUES (?,?,?,?)',board.id,revision,stateJson,now());
      await run('DELETE FROM talk_whiteboard_snapshots WHERE board_id=? AND revision<?',board.id,Math.max(0,revision-250));
    }
    await audit(board,session.account_id,'edit',{revision,count:changes.length});
    return { revision,changes,requestId };
  }
  async function operation(meetingId,session,body,internal={}) {
    const result = await transaction(meetingId,async()=>{
      const access=await boardFor(meetingId,session,true),{board}=access;
      // Only server code can provide these callbacks. AI proposals retain the
      // exact same authorization, transaction, quota, history and undo paths.
      if(internal.prepare){const prepared=await internal.prepare(access);if(prepared.replay)return prepared.replay;body=prepared.body;}
      if (!body || !validObjectId(body.requestId)) fail(400,'invalid_whiteboard','A valid operation identifier is required.');
      const digest=hash(body),previous=await get('SELECT * FROM talk_whiteboard_operations WHERE board_id=? AND request_id=?',board.id,body.requestId);
      if(previous) { if(previous.actor_account_id!==session.account_id || previous.request_hash!==digest) conflict(); return {revision:Number(previous.revision),changes:JSON.parse(previous.changes_json),requestId:body.requestId,idempotent:true}; }
      const state=JSON.parse(board.state_json),before={},after={},changes=[],revision=Number(board.revision)+1;
      let edits=body.edits;
      if(body.undoRevision) {
        const original=await get('SELECT * FROM talk_whiteboard_operations WHERE board_id=? AND revision=? AND actor_account_id=?',board.id,body.undoRevision,session.account_id);
        if(!original) conflict();
        const was=JSON.parse(original.before_json),expected=JSON.parse(original.after_json);
        edits=[];
        for(const id of Object.keys(expected)) {
          const touched=await get('SELECT revision FROM talk_whiteboard_versions WHERE board_id=? AND object_id=?',board.id,id);
          if(Number(touched?.revision)!==Number(original.revision)||JSON.stringify(state[id]||null)!==JSON.stringify(expected[id]))conflict();
          edits.push(was[id]?{kind:state[id]?'patch':'create',id,expectedVersion:state[id]?.version,element:was[id],patch:Object.fromEntries(Object.entries(was[id]).filter(([key])=>!['id','type','version'].includes(key)))}:{kind:'delete',id,expectedVersion:state[id]?.version});
        }
      }
      const maximum=internal.prepare||body.undoRevision?100:20;
      if(!Array.isArray(edits)||!edits.length||edits.length>maximum||new Set(edits.map(edit=>edit?.id)).size!==edits.length) fail(400,'invalid_whiteboard',`Send between one and ${maximum} distinct object edits.`);
      for(const edit of edits) {
        if(!edit||!validObjectId(edit.id)||!['create','patch','delete'].includes(edit.kind)) fail(400,'invalid_whiteboard','Invalid whiteboard operation.');
        const current=state[edit.id];
        if(edit.kind==='create' ? !!current : !current || edit.expectedVersion!==current.version) conflict();
        if(edit.kind==='create'&&!body.undoRevision&&await get('SELECT revision FROM talk_whiteboard_versions WHERE board_id=? AND object_id=?',board.id,edit.id)) conflict();
        before[edit.id]=current||null;
        if(edit.kind==='delete'){delete state[edit.id];after[edit.id]=null;changes.push({id:edit.id,element:null});continue;}
        let element; try {element=edit.kind==='create'?validateElement(edit.element):{...current,...validateElement(edit.patch,true)};}catch{fail(400,'invalid_whiteboard','Invalid object content.');}
        if(element.id!==edit.id) fail(400,'invalid_whiteboard','Object identity does not match.');
        if(element.type==='image' && (!element.imageId||!await get('SELECT id FROM talk_whiteboard_images WHERE board_id=? AND id=?',board.id,element.imageId))) fail(400,'invalid_whiteboard_image','Upload a private image to this board first.');
        element.version=revision;state[edit.id]=element;after[edit.id]=element;changes.push({id:edit.id,element});
      }
      const committed=await commit(access,session,body.requestId,digest,changes,before,after,state);
      if(internal.after)await internal.after(committed,access);
      return committed;
    });
    const meeting=await manager.meeting(meetingId);void notify(meeting);return result;
  }
  async function manage(meetingId,session,body) {
    return transaction(meetingId,async()=>{
      const access=await boardFor(meetingId,session),{board}=access;
      if(!access.manages) fail(403,'whiteboard_host_required','Only a host or co-host can manage editing.');
      const action=body?.action;
      if(['clear','restore','delete','lock','unlock','default_edit'].includes(action)&&!access.owner) fail(403,'whiteboard_owner_required','Only the meeting owner can perform this action.');
      if(action==='permission') {
        const member=await manager.member(meetingId,body.accountId);
        if(!member||member.admission!=='admitted'||member.role!=='member'||access.meeting.owner_account_id===body.accountId||typeof body.canEdit!=='boolean') fail(400,'invalid_whiteboard_permission','Select an admitted participant and an editing permission.');
        await run('INSERT INTO talk_whiteboard_permissions(board_id,account_id,can_edit) VALUES (?,?,?) ON CONFLICT(board_id,account_id) DO UPDATE SET can_edit=excluded.can_edit',board.id,body.accountId,body.canEdit?1:0);
      } else if(action==='lock'||action==='unlock') await run('UPDATE talk_whiteboards SET locked=? WHERE id=?',action==='lock'?1:0,board.id);
      else if(action==='default_edit'&&typeof body.canEdit==='boolean') await run('UPDATE talk_whiteboards SET default_edit=? WHERE id=?',body.canEdit?1:0,board.id);
      else if(action==='clear'||action==='restore') {
        if(body.expectedRevision!==Number(board.revision)) conflict();
        let next={};
        if(action==='restore') {const snapshot=await get('SELECT state_json FROM talk_whiteboard_snapshots WHERE board_id=? AND revision=?',board.id,body.snapshotRevision);if(!snapshot)fail(404,'whiteboard_snapshot_unavailable','Saved snapshot not available.');next=JSON.parse(snapshot.state_json);}
        const current=JSON.parse(board.state_json),before={},after={},changes=[];
        for(const id of new Set([...Object.keys(current),...Object.keys(next)])){before[id]=current[id]||null;after[id]=next[id]?{...next[id],version:Number(board.revision)+1}:null;if(after[id])next[id]=after[id];changes.push({id,element:after[id]});}
        await commit(access,session,randomUUID(),hash(body),changes,before,after,next);
      } else if(action==='delete') {
        for(const table of ['talk_whiteboard_ai_jobs','talk_whiteboard_ai_approvals','talk_whiteboard_images','talk_whiteboard_permissions','talk_whiteboard_operations','talk_whiteboard_snapshots','talk_whiteboard_versions']) await run(`DELETE FROM ${table} WHERE board_id=?`,board.id);
        await run("UPDATE talk_whiteboards SET state_json='{}',deleted_at=?,history_bytes=0 WHERE id=?",now(),board.id);presence.delete(board.id);
      } else fail(400,'invalid_whiteboard_action','Unknown whiteboard action.');
      await run('UPDATE talk_whiteboards SET updated_at=? WHERE id=?',now(),board.id);
      await audit(board,session.account_id,action,action==='permission'?{accountId:body.accountId,canEdit:body.canEdit}:action==='default_edit'?{canEdit:body.canEdit}:action==='restore'?{snapshotRevision:body.snapshotRevision}:{});return {ok:true};
    });
  }
  async function cursor(meetingId,session,body) {
    const {board,meeting}=await boardFor(meetingId,session);
    if(meeting.status!=='active') return {ok:true};
    if(body?.x!==null && (!Number.isFinite(body?.x)||!Number.isFinite(body?.y)||Math.abs(body.x)>100000||Math.abs(body.y)>100000)) fail(400,'invalid_whiteboard_cursor','Invalid cursor.');
    if(!presence.has(board.id))presence.set(board.id,new Map());
    const peers=presence.get(board.id);
    if(body.x===null)peers.delete(session.account_id);
    else {const previous=peers.get(session.account_id);if(previous&&now()-previous.at<200)return {ok:true};peers.set(session.account_id,{x:body.x,y:body.y,at:now(),sessionHash:session.token_hash});}
    return {ok:true};
  }
  async function upload(meetingId,session,bytes,mime) {
    await boardFor(meetingId,session,true);
    if(!Buffer.isBuffer(bytes)||bytes.length>avatarMaxBytes)fail(400,'invalid_whiteboard_image','Choose PNG, JPEG or WebP under 2 MB.');
    let image,metadata;try{image=await normalizeProfileImage(bytes,mime,{width:1600,height:1600,fit:'inside',maxOutput:1024*1024});metadata=await sharp(Buffer.from(image,'base64')).metadata();}catch{fail(400,'invalid_whiteboard_image','Choose a still PNG, JPEG or WebP under 2 MB and 10 megapixels.');}
    return transaction(meetingId,async()=>{
      const {board}=await boardFor(meetingId,session,true);
      const count=await get('SELECT COUNT(*) AS n FROM talk_whiteboard_images WHERE board_id=?',board.id);
      if(Number(count.n)>=20)fail(413,'whiteboard_image_limit','This board already has twenty uploaded images.');
      const id=randomUUID();await run('INSERT INTO talk_whiteboard_images(id,board_id,created_by,image_data,width,height,created_at) VALUES (?,?,?,?,?,?,?)',id,board.id,session.account_id,image,metadata.width,metadata.height,now());
      await audit(board,session.account_id,'image_uploaded');return {id,width:metadata.width,height:metadata.height};
    });
  }
  async function image(meetingId,session,id) {
    const {board}=await boardFor(meetingId,session);
    const row=await get('SELECT image_data FROM talk_whiteboard_images WHERE board_id=? AND id=?',board.id,id);
    if(!row)fail(404,'whiteboard_image_unavailable','Image unavailable.');return Buffer.from(row.image_data,'base64');
  }
  async function snapshots(meetingId,session) {const {board,manages}=await boardFor(meetingId,session);if(!manages)fail(403,'whiteboard_host_required','Only hosts can review snapshots.');return {snapshots:await all('SELECT revision,created_at FROM talk_whiteboard_snapshots WHERE board_id=? ORDER BY revision DESC',board.id)};}
  async function exportData(meetingId,session) {const access=await boardFor(meetingId,session);return {...access.board,elements:Object.values(JSON.parse(access.board.state_json)),images:await all('SELECT id,image_data FROM talk_whiteboard_images WHERE board_id=?',access.board.id)};}
  let cleaning=false;
  const housekeeping=setInterval(()=>{if(cleaning)return;cleaning=true;void db.withContext(async()=>{
    const expired=await all('SELECT meeting_id FROM talk_whiteboards WHERE expires_at<=? AND deleted_at IS NULL LIMIT 100',now());
    for(const row of expired)await transaction(row.meeting_id,()=>prune(row.meeting_id));
  }).catch(()=>{}).finally(()=>{cleaning=false;});},3600000);
  housekeeping.unref?.();
  return {open,read,operation,manage,cursor,upload,image,snapshots,exportData,
    authorize:boardFor,transaction,
    applyPrepared:(meetingId,session,prepare,after)=>operation(meetingId,session,null,{prepare,after}),
    shutdown:()=>{clearInterval(housekeeping);presence.clear();}};
}
