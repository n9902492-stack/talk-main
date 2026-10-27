import {useEffect,useState} from 'react';
import {CalendarDays,CheckCircle2,ExternalLink,Link2,RefreshCw,Unplug} from 'lucide-react';
import {schedulingRequest} from '../lib/scheduling';
import '../styles/calendar-integration.css';
const base='/google-calendar';
type Preferences={autoCreate:boolean;remind15:boolean;remindDay:boolean;inviteGuests:boolean};
type Connection={configured:boolean;authorizationEnabled:boolean;writesEnabled:boolean;readsEnabled:boolean;invitationsEnabled:boolean;status:string;accountEmail:string|null;settings:Preferences;lastSyncAt:number|null;errorCode:string|null};
const errorText=(e:unknown)=>e instanceof Error?e.message:'Calendar could not be updated. Please try again.';
export default function CalendarIntegration(){
 const [data,setData]=useState<Connection|null>(null),[prefs,setPrefs]=useState<Preferences|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 async function load(){const d=await schedulingRequest(base);setData(d);setPrefs(d.settings);}
 useEffect(()=>{const result=new URLSearchParams(location.search).get('calendar');if(result==='authorization-failed')setError('Calendar consent was not completed or expired. Reconnect to try again.');if(result==='connected')setNotice('Google Calendar connected.');void load().catch(e=>setError(errorText(e)));},[]);
 async function action(fn:()=>Promise<void>){if(busy)return;setBusy(true);setError('');setNotice('');try{await fn();}catch(e){setError(errorText(e));}finally{setBusy(false);}}
 return <section id="calendar-integration" className="calendar-integration" aria-labelledby="calendar-heading">
  <header><span className="calendar-integration-icon"><CalendarDays size={22}/></span><div><h2 id="calendar-heading">Calendar Integration</h2><p>Keep your Talk bookings in your Google Calendar.</p></div>{data&&<span className="calendar-state">{data.status==='connected'?<CheckCircle2 size={14}/>:<Link2 size={14}/>} {data.status.replaceAll('_',' ')}</span>}</header>
  {error&&<p role="alert" className="scheduler-error">{error}</p>}{notice&&<p role="status" className="scheduler-notice">{notice}</p>}
  {!data&&!error&&<p role="status">Loading Calendar settings…</p>}
  {data&&prefs&&<>
   {data.accountEmail&&<p>Google account: <strong>{data.accountEmail}</strong></p>}
   {!data.configured&&<p className="calendar-setup">Google Calendar setup is pending. ICS downloads are available for every booking.</p>}
   {data.errorCode&&<p role="status">Calendar needs attention: {data.errorCode.replaceAll('_',' ')}. Your Talk bookings remain available.</p>}
   <div className="calendar-actions">
    <button disabled={busy||!data.authorizationEnabled} onClick={()=>void action(async()=>{const r=await schedulingRequest(base+'/connect',{},true);const u=new URL(r.authorizationUrl);if(u.protocol!=='https:'||u.hostname!=='accounts.google.com')throw Error('Calendar authorization URL is unavailable.');location.assign(u.href);})}><Link2 size={16}/>{data.status==='disconnected'?'Connect Google Calendar':'Reconnect Google Calendar'}</button>
    {data.status!=='disconnected'&&<button className="secondary" disabled={busy} onClick={()=>{if(confirm('Disconnect Calendar? Existing Google events will remain.'))void action(async()=>{await schedulingRequest(base+'/disconnect',{},true);await load();setNotice('Calendar disconnected. Existing Google events were preserved.');});}}><Unplug size={16}/>Disconnect</button>}
    <button className="secondary" disabled={busy||!data.readsEnabled||data.status!=='connected'} onClick={()=>void action(async()=>{await schedulingRequest(base+'/check',{},true);await load();setNotice('Calendar changes checked. Review conflicts in the booking details below.');})}><RefreshCw size={16}/>Check Calendar changes</button>
   </div>
   <fieldset disabled={busy}><legend>Calendar preferences</legend>
    {([['autoCreate','Automatically add new bookings'],['remind15','Popup reminder 15 minutes before'],['remindDay','Popup reminder 1 day before'],['inviteGuests','Send Google Calendar attendee invitations']] as const).map(([key,label])=><label key={key}><input type="checkbox" checked={prefs[key]} disabled={key==='inviteGuests'&&!data.invitationsEnabled} onChange={e=>setPrefs({...prefs,[key]:e.target.checked})}/>{label}</label>)}
   </fieldset>
   <p className="calendar-help">Google Calendar notification visibility depends on Calendar and device notification settings. Talk email reminders use a separate delivery setting. Enabling Google invitations may create an additional email; invitee acceptance is not guaranteed.</p>
   {!data.writesEnabled&&<p className="calendar-help">Live Calendar writes are disabled. No event or invitation will be sent by changing these preferences.</p>}
   <button className="secondary" disabled={busy} onClick={()=>void action(async()=>{const r=await schedulingRequest(base+'/preferences',prefs,true);setData(r);setNotice('Calendar preferences saved.');})}>Save Calendar preferences</button>
   {data.lastSyncAt&&<p className="calendar-help">Last synchronized: {new Date(data.lastSyncAt).toLocaleString()}</p>}
  </>}
 </section>;
}
export function CalendarBookingControls({bookingId}:{bookingId:string}){
 const [open,setOpen]=useState(false),[data,setData]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const url=base+'/bookings/'+encodeURIComponent(bookingId);
 async function load(){setData(await schedulingRequest(url));}
 useEffect(()=>{if(!open)return;void load().catch(e=>setError(errorText(e)));const timer=setInterval(()=>void load().catch(()=>{}),15000);return()=>clearInterval(timer);},[open,bookingId]);
 async function action(fn:()=>Promise<void>){setBusy(true);setError('');try{await fn();await load();}catch(e){setError(errorText(e));}finally{setBusy(false);}}
 return <details className="calendar-booking" onToggle={e=>setOpen(e.currentTarget.open)}><summary><CalendarDays size={16}/> Calendar &amp; joining link</summary>
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {data&&<><p>Google Calendar: <strong>{data.status.replaceAll('_',' ')}</strong>{data.errorCode&&` · ${data.errorCode.replaceAll('_',' ')}`}</p>
   <div className="calendar-actions"><button className="secondary" disabled={busy||!data.connection.writesEnabled||data.connection.status!=='connected'} onClick={()=>void action(async()=>{await schedulingRequest(url+'/add',{},true);setNotice('Calendar sync queued.');})}>Add to Google Calendar</button>
    {data.eventUrl&&<a href={data.eventUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={14}/>View Calendar event</a>}
    <a href={'/api/auth/scheduling'+url+'/ics'} download>Download ICS</a>
    <a href="#calendar-integration">Reminder preferences / reconnect</a>
    <button className="secondary" disabled={!data.talkUrl} onClick={()=>void action(async()=>{await navigator.clipboard.writeText(new URL(data.talkUrl,location.origin).href);setNotice('Talk link copied. Guests still need their private invitation and host admission.');})}>Copy Talk joining link</button>
   </div>
   {data.attendees.map((a:any)=><p key={a.email}>{a.email}: {a.responseStatus}</p>)}
   {data.conflicts.map((c:any)=><div key={c.id} className="calendar-conflict"><p>Review: {c.kind.replaceAll('_',' ')}. Your Talk booking has not changed.</p><button className="secondary" disabled={busy} onClick={()=>void action(async()=>{await schedulingRequest(url+'/resolve',{conflictId:c.id,action:'dismiss'},true);})}>Acknowledge change</button>{c.kind!=='external_busy'&&<button className="secondary" disabled={busy||!data.connection.writesEnabled} onClick={()=>{if(confirm('Replace the Calendar event details with the current Talk booking?'))void action(async()=>{await schedulingRequest(url+'/resolve',{conflictId:c.id,action:'reassert'},true);});}}>Use Talk details in Calendar</button>}</div>)}
  </>}
 </details>;
}
