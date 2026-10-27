import {useRef,useState} from 'react';
import {ArrowUpRight,ChevronLeft,ChevronRight} from 'lucide-react';
import {calendarParts,shiftCalendarDate} from '../lib/schedulingCalendar';

export type OverviewBooking={id:string;title:string;name:string;status:string;starts_at:number;ends_at:number;meeting_id:string;meeting_status:string};
export type OverviewSchedule={profile:{timezone:string;slug:string}|null;events:{id:string;title:string;enabled:number|boolean}[];bookings:OverviewBooking[]};
export const overviewDateLabel=(date:string,options:Intl.DateTimeFormatOptions={dateStyle:'full'})=>new Intl.DateTimeFormat(undefined,{...options,timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'));
function shiftMonth(month:string,offset:number){const date=new Date(month+'-15T12:00:00Z');date.setUTCMonth(date.getUTCMonth()+offset);return date.toISOString().slice(0,7);}

export function OverviewCalendar({bookings,timezone,selected,onSelect}:{bookings:OverviewBooking[];timezone:string;selected:string;onSelect:(date:string)=>void}){
 const today=calendarParts(Date.now(),timezone).date,[month,setMonth]=useState(today.slice(0,7)),grid=useRef<HTMLDivElement>(null);
 const start=month+'-01',first=shiftCalendarDate(start,-new Date(start+'T12:00:00Z').getUTCDay());
 const dates=Array.from({length:42},(_,i)=>shiftCalendarDate(first,i)),marked=new Set(bookings.filter(b=>b.status==='confirmed').map(b=>calendarParts(b.starts_at,timezone).date));
 const label=overviewDateLabel(start,{month:'long',year:'numeric'});
 return <section className="overview-panel overview-calendar" aria-labelledby="overview-calendar-title">
  <header className="overview-panel-heading"><h2 id="overview-calendar-title">My calendar</h2><button className="overview-text-button" onClick={()=>{setMonth(today.slice(0,7));onSelect(today);}}>Today</button></header>
  <div className="overview-month"><button aria-label="Previous calendar month" onClick={()=>setMonth(shiftMonth(month,-1))}><ChevronLeft size={17}/></button><strong aria-live="polite">{label}</strong><button aria-label="Next calendar month" onClick={()=>setMonth(shiftMonth(month,1))}><ChevronRight size={17}/></button></div>
  <div className="overview-weekdays" aria-hidden="true">{['Su','Mo','Tu','We','Th','Fr','Sa'].map(d=><span key={d}>{d}</span>)}</div>
  <div className="overview-calendar-dates" role="group" aria-label={`Dates in ${label}`} ref={grid} onKeyDown={e=>{const steps:Record<string,number>={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7};if(!(e.key in steps))return;e.preventDefault();const current=(e.target as HTMLButtonElement).dataset.date;if(!current)return;const next=shiftCalendarDate(current,steps[e.key]);onSelect(next);setMonth(next.slice(0,7));requestAnimationFrame(()=>grid.current?.querySelector<HTMLButtonElement>(`[data-date="${next}"]`)?.focus());}}>
   {dates.map(date=><button key={date} data-date={date} disabled={!date.startsWith(month)} tabIndex={date===(selected.startsWith(month)?selected:start)?0:-1} className={`${!date.startsWith(month)?'is-outside ':''}${date===today?'is-today ':''}`} aria-label={overviewDateLabel(date)+(marked.has(date)?', has bookings':'')} aria-pressed={date===selected} aria-current={date===today?'date':undefined} onClick={()=>onSelect(date)}><span>{Number(date.slice(-2))}</span>{marked.has(date)&&<i/>}</button>)}
  </div><div className="overview-calendar-note"><span><i/> Booked day</span><span>{timezone.replaceAll('_',' ')}</span></div>
 </section>;
}

export function OverviewActivity({bookings,timezone,loading,available}:{bookings:OverviewBooking[];timezone:string;loading:boolean;available:boolean}){
 const current=calendarParts(Date.now(),timezone).date.slice(0,7),months=Array.from({length:6},(_,i)=>shiftMonth(current,i-5));
 const values=months.map(month=>bookings.filter(b=>b.status==='confirmed'&&calendarParts(b.starts_at,timezone).date.startsWith(month)).length),max=Math.max(1,...values),total=values.reduce((a,b)=>a+b,0);
 return <section className="overview-panel overview-activity" aria-labelledby="overview-activity-title" aria-busy={loading}>
  <header className="overview-panel-heading"><div><h2 id="overview-activity-title">Booking activity</h2><p>Confirmed appointments · recent history</p></div><a className="overview-icon-link" href="/analytics" aria-label="View booking analytics"><ArrowUpRight size={18}/></a></header>
  <div className="overview-activity-total"><strong>{loading||!available?'—':total}</strong><span>{available?'bookings across the last 6 months':'Booking activity unavailable'}</span></div>
  <div className="overview-chart" role="img" aria-label={loading?'Loading booking activity':!available?'Booking activity unavailable':months.map((m,i)=>`${overviewDateLabel(m+'-01',{month:'long'})}: ${values[i]}`).join(', ')}>{months.map((month,i)=><div key={month} className={month===current?'is-current':''}><span className="overview-bar-value">{available?values[i]:'—'}</span><div className="overview-bar-space"><i style={{height:available&&values[i]?`${Math.max(14,values[i]/max*88)}px`:'5px'}}/></div><span>{overviewDateLabel(month+'-01',{month:'short'})}</span></div>)}</div>
 </section>;
}
