import {useEffect,useRef,useState} from 'react';
import {bookingTime,newBookingCredential,schedulingRequest} from '../lib/scheduling';
import {CalendarBookingControls} from './CalendarIntegration';

export default function SchedulingBookingManagement({bookings,timezone,onChanged}:{bookings:any[];timezone:string;onChanged:()=>Promise<void>}){
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[responses,setResponses]=useState<any>(null);
 const [moving,setMoving]=useState<any>(null),[selected,setSelected]=useState<number|null>(null);
 const handled=useRef(false),query=new URLSearchParams(location.search),target=query.get('booking');
 const action=async(fn:()=>Promise<void>)=>{if(busy)return;setBusy(true);setError('');setNotice('');try{await fn();}catch(e){setError(e instanceof Error?e.message:'Could not update this booking.');}finally{setBusy(false);}};
 async function chooseTime(b:any,from=Date.now()){
  const detail=await schedulingRequest(`/host-booking/${b.id}`),to=from+14*86400000;
  const available=await schedulingRequest(`/events/${detail.booking.event.id}/slots?from=${Math.floor(from)}&to=${Math.floor(to)}&timezone=${encodeURIComponent(timezone)}`);
  setSelected(null);setMoving({booking:detail.booking,from,slots:available.slots});
 }
 useEffect(()=>{
  if(handled.current||!target)return;const b=bookings.find(b=>b.id===target);if(!b)return;
  handled.current=true;document.getElementById(`booking-${b.id}`)?.scrollIntoView({block:'center'});
  if(query.get('action')==='reschedule'&&b.status==='confirmed'&&b.starts_at>Date.now())void action(()=>chooseTime(b));
  else if(query.get('action')==='cancel')setNotice('Review this booking, then choose Cancel booking to confirm. Opening an email link does not cancel it.');
 },[bookings,target]);
 return <section><h2>Upcoming and past bookings</h2>
  {error&&<p role="alert" className="scheduler-error">{error}</p>}{notice&&<p role="status" className="scheduler-notice">{notice}</p>}
  {!bookings.length&&<p>Your confirmed appointments will appear here.</p>}
  {bookings.map(b=><article key={b.id} id={`booking-${b.id}`} tabIndex={-1}>
   <h3>{b.title}</h3><p>{bookingTime(b.starts_at,timezone)} · {timezone}</p><p>{b.name} · {b.email} · {b.meeting_status==='ended'?'Completed':b.status}</p>
   {b.status==='confirmed'&&<a href={`/device-test?room=${b.meeting_id}`}>Join meeting</a>}<a href={`/meeting-history/${b.meeting_id}`}>Authorized meeting resources</a>
   <button className="secondary" disabled={busy} onClick={()=>void action(async()=>{setResponses((await schedulingRequest(`/host-booking/${b.id}`)).booking);})}>View responses</button>
   {b.status==='confirmed'&&b.starts_at>Date.now()&&<>
    <button className="secondary" disabled={busy} onClick={()=>void action(()=>chooseTime(b))}>Reschedule booking</button>
    <button className="secondary" disabled={busy} onClick={()=>{if(confirm('Cancel this booking?'))void action(async()=>{await schedulingRequest(`/host-booking/${b.id}/change`,{action:'cancel',version:b.version},true);setMoving(null);await onChanged();setNotice('Booking cancelled. Cancellation notices are queued; delivery follows the configured email setting.');});}}>Cancel booking</button>
   </>}
   <CalendarBookingControls bookingId={b.id}/>
  </article>)}
  {moving&&<div role="region" aria-label="Reschedule booking"><h3>Choose a new time for {moving.booking.event.title}</h3><p>Times shown in {timezone}. Select a slot and confirm; no change is made by opening this screen.</p>
   <div className="scheduler-slot-list">{moving.slots.filter((s:any)=>s.start!==moving.booking.start).map((s:any)=><button type="button" className="secondary" key={s.start} aria-pressed={selected===s.start} onClick={()=>setSelected(s.start)}>{bookingTime(s.start,timezone)}</button>)}</div>
   {!moving.slots.length&&<p>No available times in these two weeks.</p>}
   <button className="secondary" disabled={busy||moving.from<=Date.now()} onClick={()=>void action(()=>chooseTime(moving.booking,Math.max(Date.now(),moving.from-14*86400000)))}>Earlier dates</button>
   <button className="secondary" disabled={busy} onClick={()=>void action(()=>chooseTime(moving.booking,moving.from+14*86400000))}>Next dates</button>
   <button disabled={busy||selected===null} onClick={()=>void action(async()=>{await schedulingRequest(`/host-booking/${moving.booking.id}/change`,{action:'reschedule',version:moving.booking.version,start:selected,newCredential:newBookingCredential()},true);setMoving(null);await onChanged();setNotice('Booking rescheduled. Updated notices are queued; delivery follows the configured email setting.');})}>Confirm reschedule</button>
   <button className="secondary" disabled={busy} onClick={()=>setMoving(null)}>Keep current time</button>
  </div>}
  {responses&&<div role="region" aria-label="Pre-meeting responses"><h3>Responses from {responses.name}</h3>{responses.answers===null?<p>Responses expired.</p>:responses.event.questions.map((q:any)=><p key={q.id}><strong>{q.label}</strong>: {Array.isArray(responses.answers[q.id])?responses.answers[q.id].join(', '):responses.answers[q.id]||'No answer provided'}</p>)}<button className="secondary" onClick={()=>setResponses(null)}>Close responses</button></div>}
 </section>;
}
