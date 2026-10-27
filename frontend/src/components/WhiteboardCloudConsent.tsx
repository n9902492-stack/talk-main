import {useEffect,useRef,useState} from 'react';
import {boardRequest,type BoardElement} from '../lib/whiteboard';
type Props={base:string;csrf:()=>string;operation:string;prompt:string;revision:number;selected:BoardElement[];editable:boolean;status:any;onJob:(job:any)=>void};
export default function WhiteboardCloudConsent(p:Props){
  const [all,setAll]=useState(false),[preview,setPreview]=useState<any>(null),[pending,setPending]=useState(false),[error,setError]=useState('');
  const current=useRef<any>(null),sequence=useRef(0);
  const selected=p.selected.filter(e=>['text','sticky'].includes(e.type));
  const signature=JSON.stringify([p.base,p.operation,p.prompt,p.revision,p.selected.map(e=>[e.id,e.version]),all,p.status]);
  useEffect(()=>{setAll(false);},[p.operation]);
  useEffect(()=>{const old=current.current;sequence.current++;setPreview(null);current.current=null;setError('');if(old)void boardRequest(p.base+'/ai/cloud/cancel',{id:old.id,proof:old.proof},p.csrf()).catch(()=>{});},[signature]);
  useEffect(()=>()=>{sequence.current++;},[]);
  const cancel=async()=>{const ticket=current.current;setPreview(null);current.current=null;sequence.current++;if(ticket)try{await boardRequest(p.base+'/ai/cloud/cancel',{id:ticket.id,proof:ticket.proof},p.csrf());}catch{/* Expiry also removes abandoned approval payloads. */}};
  async function request(confirm=false){
    if(pending)return;setPending(true);setError('');const seq=sequence.current;
    try{
      const ticket=current.current;
      const result=await boardRequest(p.base+'/ai/cloud/'+(confirm?'confirm':'preview'),confirm?{id:ticket.id,proof:ticket.proof,payloadHash:ticket.payloadHash,confirm:true}:{operation:p.operation,prompt:p.prompt,sourceRevision:p.revision,scope:p.operation==='generate'?'prompt':all?'all':'selected',includeAll:all,selectedIds:p.operation==='generate'||all?[]:selected.map(e=>e.id)},p.csrf());
      if(seq!==sequence.current)return;
      if(confirm){setPreview(null);current.current=null;p.onJob(result);}else{setPreview(result);current.current=result;}
    }catch(e){if(seq===sequence.current)setError(e instanceof Error?e.message:'Cloud request unavailable.');}finally{setPending(false);}
  }
  return <section className="wb-cloud" aria-label="Cloud AI privacy controls">
    <strong>Cloud AI · {p.status?.status==='error'?'Error':p.status?.status==='available'&&p.status?.enabled?'Available':p.status?.configured?'Disabled':'Not configured'}</strong>
    <p>{p.status?.status==='available'&&p.status?.enabled?'An approved provider connection is verified. Every external operation still requires your explicit data-sharing approval.':'Cloud AI is not configured or enabled. Your whiteboard content has not been sent to any external AI service.'}</p>
    <small>Offline templates and source-based tools above remain available.</small>
    <details><summary>Cloud AI request and privacy</summary>
      {p.operation!=='generate'&&<><p>{selected.length} selected text notes · revision {p.revision}. Only selected text is included by default.</p><label className="wb-assistant-check"><input type="checkbox" checked={all} onChange={e=>setAll(e.target.checked)} disabled={pending}/>Explicitly include all text notes on this whiteboard</label></>}
      <p>Images, recordings, transcripts, email addresses and meeting credentials are excluded. Text you type may itself contain private information; review the exact payload.</p>
      <button disabled={pending||!p.editable||!p.status?.configured||p.operation!=='generate'&&!all&&!selected.length} onClick={()=>void request()}>Review external data request</button>
      {!p.status?.configured&&<small>A server operator must first configure an approved HTTPS provider. This interface cannot configure credentials.</small>}
      {preview&&<section className="wb-cloud-confirm" aria-label="External AI data approval">
        <h4>Review before sharing externally</h4>
        <dl><dt>Provider</dt><dd>{preview.provider}</dd><dt>Destination</dt><dd>{preview.destination}</dd><dt>Model</dt><dd>{preview.model}</dd><dt>Request</dt><dd>{preview.request||preview.operation}</dd><dt>Scope</dt><dd>{preview.scope} · {preview.sourceCount} notes · revision {preview.sourceRevision}</dd><dt>Information included</dt><dd>{preview.categories.join(', ')}</dd><dt>Uploaded images</dt><dd>Excluded</dd><dt>Estimated cost</dt><dd>{preview.estimatedCost?`${(preview.estimatedCost.microunits/1000000).toFixed(6)} ${preview.estimatedCost.currency} (estimate)`:'Unknown — reliable pricing has not been configured'}</dd></dl>
        <p role="note">{preview.warning}</p><small>Input estimate {preview.inputEstimate}; output cap {preview.outputLimit} tokens. Approval expires in five minutes.</small>
        <details><summary>Exact outbound JSON payload</summary><pre>{JSON.stringify(preview.exactPayload,null,2)}</pre></details>
        <div className="wb-assistant-actions"><button disabled={pending||!preview.canConfirm||!p.editable} onClick={()=>void request(true)}>Confirm external processing</button><button disabled={pending} onClick={()=>void cancel()}>Cancel</button></div>
        {!preview.canConfirm&&<p>External inference is locked for this development phase. Confirm cannot send a request.</p>}
      </section>}
      {error&&<p role="alert" className="wb-warning">{error}</p>}
    </details>
  </section>;
}
