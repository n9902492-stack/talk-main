import {useEffect,useState} from 'react';
import {schedulingRequest} from '../lib/scheduling';
type Delivery={id:string;kind:string;status:string;attempts:number;delivery_outcome:string|null;message_id:string;started_at:number|null;smtp_code:number|null;error_category:string|null};
const labels:Record<string,string>={CONFIRMED_ACCEPTED:'SMTP accepted',CONFIRMED_REJECTED:'SMTP rejected',CONFIRMED_NOT_SUBMITTED:'Not submitted',UNKNOWN_AMBIGUOUS:'Acceptance unknown'};
export default function EmailDeliveryStatus(){
 const [data,setData]=useState<{enabled:boolean;deliveries:Delivery[]}|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function load(){setBusy(true);setError('');try{setData(await schedulingRequest('/email-deliveries'));}catch(e){setError(e instanceof Error?e.message:'Email status unavailable.');}finally{setBusy(false);}}
 useEffect(()=>{void load();},[]);
 return <section aria-labelledby="email-delivery-heading"><h2 id="email-delivery-heading">Email delivery</h2><p>SMTP acceptance confirms that the mail server accepted a message. Inbox delivery still needs confirmation.</p>{data&&!data.enabled&&<p role="status">Automatic email delivery is disabled.</p>}<button className="secondary" disabled={busy} onClick={()=>void load()}>{busy?'Refreshing…':'Refresh email status'}</button>{error&&<p role="alert" className="scheduler-error">{error}</p>}{data&&!data.deliveries.length&&<p>No email jobs yet.</p>}{data?.deliveries.map(d=><article key={d.id}><strong>{d.kind.replaceAll('_',' ').replace(':',' · ')}</strong><p>{labels[d.delivery_outcome||'']||d.status} · {d.attempts} {d.attempts===1?'attempt':'attempts'}{d.smtp_code?` · SMTP ${d.smtp_code}`:''}</p>{d.delivery_outcome==='UNKNOWN_AMBIGUOUS'&&<p role="status">The server may have accepted this message. Automatic retries are stopped; verify delivery before any separately approved send.</p>}{d.started_at&&<small>{new Date(d.started_at).toLocaleString()}</small>}</article>)}</section>;
}
