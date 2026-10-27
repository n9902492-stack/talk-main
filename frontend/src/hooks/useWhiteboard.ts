import {useEffect,useRef,useState} from 'react';
import {RoomEvent,type Room} from 'livekit-client';
import {applyBoardChanges,BoardError,boardBase,boardRequest,objectId,type BoardEdit,type BoardElement,type BoardState} from '../lib/whiteboard';

// Unsaved edits live only in this component, never browser storage. A failed
// request retains its exact ID/body so retry cannot create a duplicate edit.
export function useWhiteboard(meetingId:string,room?:Room|null) {
  const base=boardBase(meetingId),[data,setData]=useState<BoardState|null>(null),[elements,setElements]=useState<BoardElement[]>([]);
  const [error,setError]=useState(''),[missing,setMissing]=useState(false),[busy,setBusy]=useState(false),[offline,setOffline]=useState(false),[unsaved,setUnsaved]=useState(false);
  const current=useRef<BoardState|null>(null),canvas=useRef<BoardElement[]>([]),alive=useRef(true),reading=useRef(false),writing=useRef(false);
  const pending=useRef<unknown>(null),undo=useRef<number[]>([]),redo=useRef<number[]>([]),csrf=useRef(''),lastRefresh=useRef(0),nextCursor=useRef(0);
  const pendingKind=useRef<'normal'|'undo'|'redo'>('normal');
  const pendingPath=useRef('/operations');
  const lastPosition=useRef<{x:number;y:number}|null>(null);
  const sync=(value:BoardState)=>{
    if(!alive.current)return;
    if(current.current&&value.board.revision<current.current.board.revision)return;
    const changed=!!value.elements||!!value.operations?.length;
    if(value.elements){canvas.current=value.elements;}
    else if(value.operations){for(const op of value.operations)canvas.current=applyBoardChanges(canvas.current,op.changes);}
    current.current=value;csrf.current=value.csrfToken;setData(value);if(changed)setElements([...canvas.current]);setMissing(false);setOffline(false);
  };
  async function refresh(full=false) {
    if(reading.current||writing.current||!alive.current)return;
    reading.current=true;lastRefresh.current=Date.now();
    try{sync(await boardRequest(base+(!full&&current.current?`?since=${current.current.board.revision}`:'')));}
    catch(failure){if(!alive.current)return;if(failure instanceof BoardError&&[401,403,404,410].includes(failure.status)){
      if(failure.status===404&&!current.current)setMissing(true);else {setError(failure.message);setData(null);current.current=null;canvas.current=[];setElements([]);pending.current=null;setUnsaved(false);}
    }else setOffline(true);}
    finally{reading.current=false;}
  }
  useEffect(()=>{
    alive.current=true;void refresh(true);
    const timer=window.setInterval(()=>void refresh(),1000);
    const heartbeat=window.setInterval(()=>{const point=lastPosition.current;if(point&&document.visibilityState==='visible')void cursor(point.x,point.y);},3000);
    const wake=(_bytes:Uint8Array,_participant:unknown,_kind:unknown,topic?:string)=>{if(topic==='talk.whiteboard.v1'&&Date.now()-lastRefresh.current>600)void refresh();};
    room?.on(RoomEvent.DataReceived,wake);
    const preventLoss=(event:BeforeUnloadEvent)=>{if(pending.current){event.preventDefault();event.returnValue='';}};
    window.addEventListener('beforeunload',preventLoss);
    return()=>{alive.current=false;window.clearInterval(timer);window.clearInterval(heartbeat);room?.off(RoomEvent.DataReceived,wake);window.removeEventListener('beforeunload',preventLoss);
      if(csrf.current)void boardRequest(base+'/cursor',{x:null},csrf.current).catch(()=>{});
      canvas.current=[];current.current=null;
    };
  },[meetingId,room]);
  async function send(body:unknown,kind:'normal'|'undo'|'redo'='normal',path='/operations') {
    if(writing.current||!current.current?.canEdit||pending.current&&pending.current!==body)return false;
    writing.current=true;setBusy(true);setError('');pending.current=body;pendingKind.current=kind;pendingPath.current=path;setUnsaved(true);
    // Let an already-running pull finish before a write; the next full pull
    // reconciles any ordering differences without overwriting other objects.
    try{
      const result=await boardRequest(base+path,body,csrf.current);
      if(current.current&&result.revision===current.current.board.revision+1){
        canvas.current=applyBoardChanges(canvas.current,result.changes);setElements([...canvas.current]);
        current.current={...current.current,board:{...current.current.board,revision:result.revision}};setData(current.current);
      }
      if(kind==='normal'){if(undo.current.at(-1)!==result.revision)undo.current.push(result.revision);redo.current=[];}
      else if(kind==='undo'){undo.current.pop();redo.current.push(result.revision);}
      else{redo.current.pop();undo.current.push(result.revision);}
      pending.current=null;setUnsaved(false);return true;
    }catch(failure){
      if(failure instanceof BoardError){pending.current=null;setUnsaved(false);if([401,403,404,410].includes(failure.status)){setData(null);canvas.current=[];setElements([]);} }
      if(alive.current)setError(failure instanceof BoardError?failure.message:'Your change was not saved. Check your connection and retry before closing.');return false;
    }finally{writing.current=false;if(alive.current){setBusy(false);void refresh(true);}}
  }
  const edit=(edits:BoardEdit[])=>send({requestId:objectId(),edits});
  async function open(){setBusy(true);try{
    const session=await boardRequest(`/api/auth/meetings/${encodeURIComponent(meetingId)}`);csrf.current=session.csrfToken;
    await boardRequest(base+'/open',{},csrf.current);setError('');await refresh(true);
  }catch(failure){setError(failure instanceof Error?failure.message:'Could not open whiteboard.');}finally{setBusy(false);}}
  async function manage(action:string,extra:Record<string,unknown>={}){if(busy)return;setBusy(true);setError('');
    // Immediate checkbox feedback; the server remains the permission authority.
    if(action==='default_edit')setData(value=>value?{...value,board:{...value.board,defaultEdit:!!extra.canEdit}}:value);
    if(action==='permission')setData(value=>value?{...value,members:value.members.map(m=>m.id===extra.accountId?{...m,override:extra.canEdit?1:0}:m)}:value);
    try{await boardRequest(base+'/manage',{action,expectedRevision:current.current?.board.revision,...extra},csrf.current);await refresh(true);}catch(failure){setError(failure instanceof Error?failure.message:'Could not update whiteboard.');void refresh(true);}finally{setBusy(false);}}
  async function cursor(x:number|null,y?:number){lastPosition.current=x===null?null:{x,y:y||0};if(!current.current||Date.now()<nextCursor.current)return;nextCursor.current=Date.now()+250;try{await boardRequest(base+'/cursor',{x,y},csrf.current);}catch{/* Presence is ephemeral; durable saves report errors separately. */}}
  return {data,elements,error,missing,busy,offline,unsaved,base,edit,open,manage,cursor,refresh,
    canUndo:undo.current.length>0,canRedo:redo.current.length>0,
    undo:()=>{const revision=undo.current.at(-1);if(revision)return send({requestId:objectId(),undoRevision:revision},'undo');},
    redo:()=>{const revision=redo.current.at(-1);if(revision)return send({requestId:objectId(),undoRevision:revision},'redo');},
    applyProposal:(jobId:string,body:unknown)=>send(body,'normal',`/ai/jobs/${encodeURIComponent(jobId)}/apply`),
    retry:()=>pending.current?send(pending.current,pendingKind.current,pendingPath.current):refresh(true),
    discard:()=>{pending.current=null;setUnsaved(false);setError('');void refresh(true);},
    csrf:()=>csrf.current};
}
