import {useEffect,useRef,useState} from 'react';
import {ArrowRight,ArrowUpRight,CalendarCheck2,CalendarDays,ChevronRight,Clock3,FileText,FolderOpen,Link2,PenLine,Play,Radio,RefreshCw,Search,Users,Video,X} from 'lucide-react';
import {schedulingRequest,bookingTime,browserTimezone} from '../lib/scheduling';
import {useAuth} from '../lib/auth';
import {createTalkMeeting,navigateToMeeting} from '../lib/meetingSession';
import {meetingHistorySummary,type HistoryMeeting} from '../lib/meetingHistory';
import {calendarDayStart,calendarParts,shiftCalendarDate} from '../lib/schedulingCalendar';
import DashboardOrbitalArt from '../components/DashboardOrbitalArt';
import {OverviewActivity,OverviewCalendar,overviewDateLabel,type OverviewSchedule} from '../components/OverviewWidgets';
import '../styles/overview.css';

const sessions=[
 {id:'workshop',title:'Social Media Marketing Workshop',type:'meetings',detail:'Meeting · Interactive workshop',href:'/device-test',action:'Open',Icon:Video},
 {id:'webinar',title:'Learn from our AppSumo success',type:'webinars',detail:'Webinar · On-demand session',href:'/webinars',action:'View',Icon:Radio},
 {id:'demo',title:'See Talk in action',type:'demos',detail:'Demo · A tour with Team Talk',href:'/bookings',action:'Book',Icon:CalendarDays},
];
const features=[
 {title:'Stay organized',text:'Your availability and appointments, all together.',href:'/bookings',Icon:CalendarDays,Small:Clock3},
 {title:'Meet together',text:'A little more connection in every conversation.',href:'/meetings',Icon:Video,Small:Users},
 {title:'Make room for ideas',text:'Sketch, share and build something together.',href:'/whiteboard',Icon:PenLine,Small:FileText},
];

export default function Dashboard(){
 const {user}=useAuth(),firstName=user?.name?.trim().split(/\s+/)[0];
 const [schedule,setSchedule]=useState<OverviewSchedule|null>(null),[history,setHistory]=useState<HistoryMeeting[]|null>(null),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState(''),[retry,setRetry]=useState(0);
 const [selectedDate,setSelectedDate]=useState<string|null>(null),[query,setQuery]=useState(''),[filter,setFilter]=useState('all'),[starting,setStarting]=useState(false),[meetingError,setMeetingError]=useState(''),startingRef=useRef(false);
 useEffect(()=>{let active=true;setLoading(true);setLoadError('');void Promise.allSettled([
  schedulingRequest('/dashboard') as Promise<OverviewSchedule>,
  fetch('/api/auth/meeting-history',{cache:'no-store'}).then(async response=>{if(!response.ok)throw new Error('Meeting history unavailable');return (await response.json()).meetings as HistoryMeeting[];}),
 ]).then(([bookings,meetings])=>{if(!active)return;if(bookings.status==='fulfilled')setSchedule(bookings.value);if(meetings.status==='fulfilled')setHistory(meetings.value);if(bookings.status==='rejected'||meetings.status==='rejected')setLoadError('Some workspace information could not be loaded. Please try again.');setLoading(false);});return()=>{active=false;};},[retry]);
 const timezone=schedule?.profile?.timezone||browserTimezone(),today=calendarParts(Date.now(),timezone).date,selected=selectedDate||today,bookings=schedule?.bookings||[];
 const upcoming=bookings.filter(b=>b.status==='confirmed'&&b.meeting_status!=='ended'&&b.ends_at>Date.now()).sort((a,b)=>a.starts_at-b.starts_at);
 const resources=meetingHistorySummary(history||[]),activeLinks=schedule?.events.filter(e=>e.enabled).length||0;
 const transcriptMeeting=history?.find(m=>(m.transcriptCount||0)>0),transcriptHref=transcriptMeeting?`/meeting-history/${encodeURIComponent(transcriptMeeting.id)}?tab=transcript`:'/meeting-history';
 const dayStart=calendarDayStart(selected,timezone),dayEnd=calendarDayStart(shiftCalendarDate(selected,1),timezone);
 const agenda=bookings.filter(b=>b.status==='confirmed'&&b.starts_at<dayEnd&&b.ends_at>dayStart).sort((a,b)=>a.starts_at-b.starts_at);
 const time=(value:number)=>new Intl.DateTimeFormat(undefined,{timeZone:timezone,hour:'numeric',minute:'2-digit'}).format(value);
 const startSession=async()=>{if(startingRef.current)return;startingRef.current=true;setStarting(true);setMeetingError('');try{const created=await createTalkMeeting();navigateToMeeting(`/device-test?room=${encodeURIComponent(created.id)}`);}catch(error){setMeetingError(error instanceof Error?error.message:'Could not create the meeting. Try again.');}finally{startingRef.current=false;setStarting(false);}};
 const visibleSessions=sessions.filter(s=>(filter==='all'||s.type===filter)&&`${s.title} ${s.detail}`.toLowerCase().includes(query.trim().toLowerCase()));
 return <main className="dashboard-content overview-redesign">
  <div className="overview-intro">
   <div className="overview-greeting"><span className="overview-eyebrow">YOUR SPACE. YOUR STAGE.</span><h1>{firstName?`Welcome back, ${firstName}!`:'Welcome back!'}</h1><p>Your day, your conversations.<br/>Everything you need, together.</p><button className="primary-button" disabled={starting} onClick={()=>void startSession()}><Video size={16}/>{starting?'Creating meeting…':'Start a session'}</button></div>
   <div className="overview-features">{features.map(({title,text,href,Icon,Small})=><a className="overview-feature" key={title} href={href}><div className="overview-feature-art" aria-hidden="true"><i/><Icon size={38} strokeWidth={1.4}/><span><Small size={17}/></span></div><div><strong>{title}</strong><p>{text}</p></div><ArrowUpRight className="overview-feature-arrow" size={15}/></a>)}</div>
  </div>
  {meetingError&&<p role="alert" className="dashboard-account-error">{meetingError}</p>}
  {loadError&&<div className="overview-load-error" role="alert"><span>{loadError}</span><button className="overview-text-button" onClick={()=>setRetry(v=>v+1)}><RefreshCw size={14}/>Try again</button></div>}

  <section className="dashboard-welcome" aria-labelledby="workspace-welcome">
   <div className="dashboard-welcome-copy"><span>YOUR SPACE. YOUR STAGE.</span><h2 id="workspace-welcome">Make your next session<br />a great one.</h2><p>Bring everyone together with a little more Talk.</p><a href="/device-test" className="secondary-button">Test audio &amp; video<ArrowRight size={16} /></a></div>
   <DashboardOrbitalArt/>
  </section>

  <div className="overview-main-grid">
   <section className="overview-panel" aria-labelledby="overview-updates-title" aria-busy={loading}><header className="overview-panel-heading"><h2 id="overview-updates-title">Workspace updates</h2><CalendarCheck2 size={18}/></header>
    {loading?<p className="overview-empty-copy">Loading your workspace…</p>:<div className="overview-updates">
     <a href="/bookings"><span className="overview-small-icon"><CalendarDays size={17}/></span><div><strong>{!schedule?'Bookings unavailable':upcoming.length?`${upcoming.length} upcoming ${upcoming.length===1?'booking':'bookings'}`:'Your calendar has room'}</strong><p>Plan your next conversation.</p></div><ChevronRight size={14}/></a>
     <a href="/bookings"><span className="overview-small-icon"><Link2 size={17}/></span><div><strong>{!schedule?'Booking links unavailable':activeLinks?`${activeLinks} active booking ${activeLinks===1?'link':'links'}`:'Create your first booking link'}</strong><p>Make it easy to find a time.</p></div><ChevronRight size={14}/></a>
     <a href="/recordings"><span className="overview-small-icon"><FolderOpen size={17}/></span><div><strong>{history===null?'Meeting library unavailable':resources.recordings?`${resources.recordings} saved ${resources.recordings===1?'recording':'recordings'}`:'Your meeting library'}</strong><p>{resources.transcripts?`${resources.transcripts} transcripts to revisit.`:'Keep your conversations close.'}</p></div><ChevronRight size={14}/></a>
    </div>}<a className="overview-panel-footer" href="/bookings">Manage workspace<ArrowRight size={14}/></a>
   </section>
   <section className="overview-panel" aria-labelledby="overview-upcoming-title" aria-busy={loading}><header className="overview-panel-heading"><h2 id="overview-upcoming-title">Upcoming meetings</h2><a className="overview-icon-link" href="/bookings" aria-label="View all upcoming meetings"><CalendarDays size={18}/></a></header>
    {loading?<p className="overview-empty-copy">Loading your meetings…</p>:upcoming.length?<div className="overview-upcoming-list">{upcoming.slice(0,2).map(b=><a key={b.id} href={`/bookings?booking=${encodeURIComponent(b.id)}`}><span className="overview-upcoming-time">{bookingTime(b.starts_at,timezone)}</span><div><span className="overview-small-icon"><Video size={18}/></span><div><strong>{b.title}</strong><p>With {b.name} · {Math.round((b.ends_at-b.starts_at)/60000)} min</p></div><ArrowUpRight size={14}/></div></a>)}</div>:<div className="overview-empty"><CalendarDays size={27}/><strong>{schedule?'A little space for your next meeting.':'Meetings could not be loaded.'}</strong><p>{schedule?'Your confirmed bookings will appear here.':'Use Try again to refresh your workspace.'}</p></div>}
    <a className="overview-panel-footer" href="/bookings">View all bookings<ArrowRight size={14}/></a>
   </section>
   <OverviewActivity bookings={bookings} timezone={timezone} loading={loading} available={schedule!==null}/>
  </div>

  <div className="overview-bottom-grid">
   <section className="overview-panel overview-agenda" aria-labelledby="overview-agenda-title" aria-busy={loading}><header className="overview-panel-heading"><div><h2 id="overview-agenda-title">Daily agenda</h2><p>{overviewDateLabel(selected,{weekday:'long',month:'short',day:'numeric'})}</p></div><a className="overview-icon-link" href="/bookings" aria-label="Manage your agenda"><ArrowUpRight size={18}/></a></header>
    <div className="overview-agenda-content" aria-live="polite">{loading?<p className="overview-empty-copy">Loading your agenda…</p>:agenda.length?agenda.map(b=><a className="overview-agenda-row" key={b.id} href={b.meeting_status==='ended'?`/meeting-history/${encodeURIComponent(b.meeting_id)}`:`/device-test?room=${encodeURIComponent(b.meeting_id)}`}><span className="overview-small-icon"><Video size={18}/></span><div><strong>{b.title}</strong><span>{time(b.starts_at)} – {time(b.ends_at)}</span><p>{b.name} · {Math.round((b.ends_at-b.starts_at)/60000)} minutes</p></div><span className="overview-status">{b.meeting_status==='ended'?'Completed':b.ends_at<Date.now()?'Past':b.starts_at>Date.now()?'Upcoming':'Scheduled now'}</span></a>):<div className="overview-empty"><CalendarCheck2 size={28}/><strong>{schedule?'No meetings for this day.':'Agenda unavailable.'}</strong><p>{schedule?'Pick a booked day on your calendar or plan something new.':'Refresh your workspace to try again.'}</p><a href="/bookings" className="overview-text-button">Plan a meeting<ArrowRight size={14}/></a></div>}</div><div className="overview-agenda-zone"><Clock3 size={13}/>Times in {timezone.replaceAll('_',' ')}</div>
   </section>
   <OverviewCalendar key={timezone} bookings={bookings} timezone={timezone} selected={selected} onSelect={setSelectedDate}/>
   <section className="overview-launch"><div className="overview-launch-art" aria-hidden="true"><Video size={42} strokeWidth={1.3}/><span><Users size={20}/></span><i/></div><span className="overview-eyebrow">A LITTLE MORE TALK</span><h2>Make your next<br/>conversation count.</h2><p>A quick catch-up.<br/>A big idea. A fresh start.</p><button className="overview-launch-button" disabled={starting} onClick={()=>void startSession()}>{starting?'Creating meeting…':'Start a session'}<ArrowRight size={15}/></button><a href="/whiteboard">Open a whiteboard<PenLine size={14}/></a></section>
  </div>

  <section className="overview-panel overview-resources" id="library" aria-label="Recent workspace resources"><div className="overview-resources-title"><h2>Your workspace</h2><p>Resources from your recent meeting library.</p></div><div>{[{label:'Meetings',value:resources.meetings,ready:history!==null,href:'/meeting-history',Icon:Video},{label:'Recordings',value:resources.recordings,ready:history!==null,href:'/recordings',Icon:Play},{label:'Transcripts',value:resources.transcripts,ready:history!==null,href:transcriptHref,Icon:FileText},{label:'Booking links',value:activeLinks,ready:schedule!==null,href:'/bookings',Icon:Link2}].map(({label,value,ready,href,Icon})=><a key={label} href={href}><span className="overview-small-icon"><Icon size={18}/></span><strong>{loading||!ready?'—':value.toString().padStart(2,'0')}</strong><span>{label}</span><ArrowUpRight size={14}/></a>)}</div></section>

  <section className="overview-panel overview-explore" id="sessions" aria-labelledby="dashboard-sessions-heading"><header className="overview-panel-heading"><div><h2 id="dashboard-sessions-heading">Explore Talk</h2><p>A few previews to help you get started.</p></div><span className="overview-status">3 previews</span></header>
   <div className="dashboard-session-tools"><div className="dashboard-filters" role="group" aria-label="Filter sessions">{[['all','All sessions'],['meetings','Meetings'],['webinars','Webinars'],['demos','Demos']].map(([value,label])=><button key={value} aria-pressed={filter===value} className={filter===value?'is-selected':''} onClick={()=>setFilter(value)}>{label}</button>)}</div><div className="dashboard-search"><Search size={16}/><input type="search" aria-label="Search sessions" placeholder="Search sessions" value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<button aria-label="Clear session search" onClick={()=>setQuery('')}><X size={14}/></button>}</div></div>
   <div className="dashboard-session-list" aria-live="polite">{visibleSessions.length?visibleSessions.map(({id,title,detail,href,action,Icon})=><article key={id} className="dashboard-session-row"><div className="dashboard-session-summary"><span className="dashboard-session-icon"><Icon size={18}/></span><div><h3><a href={href}>{title}</a></h3><p>{detail}</p></div></div><span className="dashboard-session-status">Preview</span><a className="dashboard-row-action" href={href} aria-label={`${action} ${title}`}>{action}<ChevronRight size={15}/></a></article>):<div className="overview-empty"><Search size={24}/><strong>No sessions found</strong><p>Try another search or reset your filters.</p><button className="overview-text-button" onClick={()=>{setQuery('');setFilter('all');}}>Reset filters</button></div>}</div>
  </section>
  <footer className="dashboard-footer"><span>© 2026 Talk</span><a href="/#security">Privacy &amp; security</a></footer>
 </main>;
}
