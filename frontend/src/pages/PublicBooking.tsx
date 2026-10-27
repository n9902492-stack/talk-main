import {useEffect,useRef,useState} from 'react';
import {useAuth} from '../lib/auth';
import {bookingTime,browserTimezone,newBookingCredential,schedulingBase,schedulingRequest} from '../lib/scheduling';
import {navigateToMeeting} from '../lib/meetingSession';
import '../styles/scheduling.css';
export default function PublicBooking({confirmation=false}:{confirmation?:boolean}){
 const {user}=useAuth(),[event,setEvent]=useState<any>(null),[booking,setBooking]=useState<any>(null),[timezone,setTimezone]=useState(browserTimezone()),[slots,setSlots]=useState<any[]>([]),[recommended,setRecommended]=useState<any[]>([]),[showAll,setShowAll]=useState(false),[selected,setSelected]=useState<number|null>(null),[name,setName]=useState(''),[email,setEmail]=useState(''),[answers,setAnswers]=useState<Record<string,string|string[]>>({}),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[code,setCode]=useState(''),[sent,setSent]=useState(false),[rescheduling,setRescheduling]=useState(false),[page,setPage]=useState(0),[consent,setConsent]=useState(false);
 const emailActionHandled=useRef(false);
 const credential=useRef(''),requestCredential=useRef(newBookingCredential()),bookingId=useRef(new URLSearchParams(location.search).get('id')||''),embed=new URLSearchParams(location.search).get('embed')==='1',parent=new URLSearchParams(location.search).get('parent');
 const action=async(fn:()=>Promise<unknown>)=>{if(busy)return;setBusy(true);setError('');setNotice('');try{await fn();}catch(e){setError(e instanceof Error?e.message:'Booking unavailable.');}finally{setBusy(false);}};
 useEffect(()=>{let active=true;setLoading(true);const load=async()=>{if(confirmation){const fragment=location.hash.slice(1);if(fragment){credential.current=fragment;sessionStorage.setItem('talk-booking-access:'+bookingId.current,fragment);history.replaceState({},'',location.pathname+location.search);}else credential.current=sessionStorage.getItem('talk-booking-access:'+bookingId.current)||'';const pending=sessionStorage.getItem('talk-booking-pending:'+bookingId.current);let value;if(pending){try{value=await schedulingRequest(`/booking/${bookingId.current}/detail`,{credential:pending});credential.current=pending;sessionStorage.setItem('talk-booking-access:'+bookingId.current,pending);sessionStorage.removeItem('talk-booking-pending:'+bookingId.current);}catch{/* The original credential may still be valid if the transaction did not commit. */}}if(!value)value=await schedulingRequest(`/booking/${bookingId.current}/detail`,{credential:credential.current});if(active){setBooking(value.booking);setEvent(value.booking.event);setTimezone(value.booking.timezone);}}else{const parts=location.pathname.split('/').filter(Boolean);const result=await schedulingRequest(`/public/${encodeURIComponent(parts[1])}/${encodeURIComponent(parts[2])}`);if(embed){const cfg=await schedulingRequest(`/embed/${result.event.id}?parent=${encodeURIComponent(parent||'')}`);if(cfg.parent!==parent)throw new Error('Embedding is unavailable.');}if(active)setEvent(result.event);}};void load().catch(e=>active&&setError(e.message)).finally(()=>active&&setLoading(false));return()=>{active=false;};},[confirmation,embed,parent]);
 useEffect(()=>{if(!event||booking&&!rescheduling)return;let active=true;setLoading(true);setSelected(null);const from=Date.now()+page*14*86400000;void schedulingRequest(`/events/${event.id}/slots?from=${Math.floor(from)}&to=${Math.floor(from+14*86400000)}&timezone=${encodeURIComponent(timezone)}`).then(v=>{if(active){setSlots(v.slots);setRecommended(v.recommendations);}}).catch(e=>active&&setError(e.message)).finally(()=>active&&setLoading(false));return()=>{active=false;};},[event,timezone,page,booking,rescheduling]);
 useEffect(()=>{if(!booking||emailActionHandled.current)return;emailActionHandled.current=true;const action=new URLSearchParams(location.search).get('action');if(booking.status==='confirmed'&&booking.start>Date.now()&&action==='reschedule'){setRescheduling(true);setPage(0);setShowAll(false);}else if(action==='cancel')setNotice('Review your booking, then choose Cancel booking to confirm. Opening an email link does not cancel it.');},[booking]);
 useEffect(()=>{if(!embed||!parent||!event)return;const message=(e:MessageEvent)=>{if(e.origin===parent&&e.source===window.parent&&e.data?.type==='talk:request-size')window.parent.postMessage({type:'talk:booking-size',height:Math.min(1800,document.documentElement.scrollHeight)},parent);};window.addEventListener('message',message);window.parent.postMessage({type:'talk:booking-size',height:Math.min(1800,document.documentElement.scrollHeight)},parent);return()=>window.removeEventListener('message',message);},[embed,parent,event]);
 const submit=async()=>{if(selected===null)throw new Error('Choose a time.');if(rescheduling){const next=newBookingCredential();sessionStorage.setItem('talk-booking-pending:'+booking.id,next);let value;try{value=await schedulingRequest(`/booking/${booking.id}/change`,{credential:credential.current,newCredential:next,action:'reschedule',version:booking.version,start:selected});}catch(failure){try{value=await schedulingRequest(`/booking/${booking.id}/detail`,{credential:next});}catch{throw failure;}}credential.current=next;sessionStorage.removeItem('talk-booking-pending:'+booking.id);sessionStorage.setItem('talk-booking-access:'+booking.id,next);setBooking(value.booking);setRescheduling(false);setNotice('Your booking was rescheduled. Old invitation credentials were revoked.');return;}
 const value=await schedulingRequest(`/events/${event.id}/book`,{credential:requestCredential.current,start:selected,name,email,timezone,answers,analyticsConsent:consent});if(embed){setBooking(value.booking);credential.current=requestCredential.current;setNotice('Booking confirmed. Open your private confirmation to manage or join.');return;}navigateToMeeting(`/booking-confirmation?id=${value.booking.id}#${requestCredential.current}`);};
 const download=async()=>{const form=await schedulingRequest('/form'),response=await fetch(schedulingBase+`/booking/${booking.id}/calendar`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Scheduling-Token':form.formToken},body:JSON.stringify({credential:credential.current})});if(!response.ok)throw new Error('Calendar download is unavailable.');const url=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=url;a.download='talk-booking.ics';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};

 return <main className={'booking-live '+(embed?'is-embed':'')}>
  <header><a href="/" target={embed?'_blank':undefined} rel="noreferrer">Talk</a><a href="/bookings" target={embed?'_blank':undefined} rel="noreferrer">Your bookings</a></header>
  {error&&<p role="alert" className="scheduler-error">{error}</p>}
  {notice&&<p role="status" className="scheduler-notice">{notice}</p>}
  {!event&&loading&&<p role="status">Loading booking page...</p>}
  {event&&<header><div><span className="booking-step">{booking?'Your appointment':'Choose a time'}</span><h1>{event.title}</h1><p>With {event.hostName} | {event.duration} minutes | Host timezone: {event.timezone}</p></div></header>}
  {booking&&!rescheduling&&<section>
   <h2>{booking.status==='cancelled'?'Booking cancelled':booking.completed?'Meeting completed':'Booking confirmed'}</h2>
   <p>{bookingTime(booking.start,booking.timezone)} - {bookingTime(booking.end,booking.timezone)}</p>
   <p>Timezone: {booking.timezone}</p><p>{booking.name} | {booking.email}</p>
   {embed&&<a className="booking-cta" target="_blank" rel="noreferrer" href={'/booking-confirmation?id='+booking.id+'#'+credential.current}>Open private confirmation</a>}
   {!embed&&<div>
    <button className="secondary" onClick={()=>void action(download)}>Add to calendar</button>
    {booking.status==='confirmed'&&!booking.completed&&<div>
     {user?<a className="booking-cta" href={'/device-test?room='+booking.meetingId}>Join with my Talk account</a>:<div>
      <h3>Join as an invited guest</h3><p>Verify your booking email. Your host must admit you before audio or video is shared.</p>
      {!event.emailEnabled?<p role="status">Guest verification email is not configured on this local installation. Ask your host to configure scheduling email delivery.</p>:<div>
       <button disabled={busy} onClick={()=>void action(async()=>{await schedulingRequest('/booking/'+booking.id+'/code',{credential:credential.current});setSent(true);setNotice('A code was sent to your booking email.');})}>{sent?'Resend code':'Send email code'}</button>
       {sent&&<form onSubmit={e=>{e.preventDefault();void action(async()=>{const v=await schedulingRequest('/booking/'+booking.id+'/redeem',{credential:credential.current,code});sessionStorage.setItem('talk-name',booking.name);navigateToMeeting('/device-test?room='+v.meetingId+'&guest=1');});}}>
        <label>Verification code<input inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" value={code} onChange={e=>setCode(e.target.value)} required/></label><button disabled={busy}>Verify and check my devices</button>
       </form>}
      </div>}
     </div>}
     {booking.start>Date.now()&&<div>
      <button className="secondary" disabled={busy} onClick={()=>{setRescheduling(true);setPage(0);setShowAll(false);}}>Reschedule</button>
      <button className="secondary" disabled={busy} onClick={()=>{if(confirm('Cancel this booking?'))void action(async()=>{const v=await schedulingRequest('/booking/'+booking.id+'/change',{credential:credential.current,version:booking.version,action:'cancel'});setBooking(v.booking);setNotice('Booking cancelled. Guest access was revoked.');});}}>Cancel booking</button>
     </div>}
    </div>}
    {booking.completed&&<div><a className="booking-cta" href={'/booking/'+event.hostSlug+'/'+(event.followUp?.slug||event.slug)}>Book a follow-up</a><p>Host suggestion: {event.followUpDuration} minutes. {event.followUp?'A matching event type is available.':'A matching event type has not been published; this link shows the original meeting duration.'}</p></div>}
    {user&&<a className="booking-cta secondary" href={'/meeting-history/'+booking.meetingId}>Open authorized meeting resources</a>}
    <p>Keep your original private confirmation link. Booking guests do not receive access to private recordings, transcripts or saved whiteboards.</p>
   </div>}
  </section>}
  {event&&(!booking||rescheduling)&&<div>
   <section>
    <div className="booking-zone"><span>Showing times in {timezone}</span><label>Change timezone<input aria-label="Change timezone" list="booking-zones" value={timezone} onChange={e=>setTimezone(e.target.value)}/></label></div>
    <h2>{rescheduling?'Choose a new time':'Recommended times'}</h2>{rescheduling&&<button type="button" className="secondary" onClick={()=>setRescheduling(false)}>Keep current time</button>}
    {loading?<p role="status">Checking real availability...</p>:<div>
     <div className="booking-slots">{(showAll?slots:recommended).map((slot:any)=><button key={slot.start} aria-pressed={selected===slot.start} onClick={()=>{setSelected(slot.start);if(consent)void schedulingRequest('/events/'+event.id+'/metric',{kind:'selection',consent:true}).catch(()=>{});}}>{slot.label&&<small>{slot.label}</small>}{bookingTime(slot.start,timezone)}</button>)}</div>
     {!slots.length&&<p>No available times in these two weeks. Try the next dates.</p>}
     <button className="secondary" onClick={()=>setShowAll(!showAll)}>{showAll?'Show recommendations':'View all available times'}</button><button className="secondary" disabled={page===0} onClick={()=>setPage(p=>p-1)}>Earlier dates</button><button className="secondary" disabled={page>=5} onClick={()=>setPage(p=>p+1)}>Next dates</button>
    </div>}
   </section>
   {selected!==null&&<section>
    <h2>{rescheduling?'Confirm new time':'Your details'}</h2><p>{bookingTime(selected,timezone)} | {timezone}</p>
    <form onSubmit={e=>{e.preventDefault();void action(submit);}}>
     {!rescheduling&&<div>
      <label>Your name<input name="name" autoComplete="name" required maxLength={80} value={name} onChange={e=>setName(e.target.value)}/></label>
      <label>Your email<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)}/></label>
      <div className="booking-questions">{event.questions.map((q:any)=><div key={q.id}>
       {q.type==='multiple'?<fieldset className="booking-question-options"><legend>{q.label}{q.required?' (required)':''}</legend>{q.choices.map((c:string)=><label key={c}><input type="checkbox" checked={(answers[q.id]||[]).includes(c)} onChange={e=>setAnswers(a=>({...a,[q.id]:e.target.checked?[...(Array.isArray(a[q.id])?a[q.id]:[]),c]:(a[q.id] as string[]||[]).filter(v=>v!==c)}))}/>{c}</label>)}</fieldset>:<label>{q.label}{q.required?' (required)':''}
        {q.type==='single'?<select required={q.required} value={answers[q.id] as string||''} onChange={e=>setAnswers(a=>({...a,[q.id]:e.target.value}))}><option value="">Select an answer</option>{q.choices.map((c:string)=><option key={c}>{c}</option>)}</select>:q.type==='long'?<textarea required={q.required} maxLength={4000} value={answers[q.id] as string||''} onChange={e=>setAnswers(a=>({...a,[q.id]:e.target.value}))}/>:<input required={q.required} maxLength={300} value={answers[q.id] as string||''} onChange={e=>setAnswers(a=>({...a,[q.id]:e.target.value}))}/>}
       </label>}
      </div>)}</div>
     </div>}
     <button disabled={busy||loading}>{busy?'Saving...':rescheduling?'Confirm reschedule':'Confirm booking'}</button>
    </form>
   </section>}
   <label><input type="checkbox" checked={consent} onChange={e=>{setConsent(e.target.checked);if(e.target.checked)void schedulingRequest('/events/'+event.id+'/metric',{kind:'visit',consent:true}).catch(()=>{});}}/>Allow an anonymous booking-page count. No external analytics.</label>
  </div>}
  <datalist id="booking-zones">{['Asia/Kolkata','UTC','America/New_York','Europe/London','Australia/Sydney','Asia/Dubai'].map(z=><option key={z}>{z}</option>)}</datalist>
 </main>;
}
