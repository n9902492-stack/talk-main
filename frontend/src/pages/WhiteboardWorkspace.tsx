import { lazy, Suspense, useEffect, useState } from 'react';
import { ArrowRight, CalendarDays, Pencil, Search, ShieldCheck, Video } from 'lucide-react';
import type { HistoryMeeting } from '../lib/meetingHistory';
import '../styles/whiteboard-workspace.css';

const Whiteboard = lazy(() => import('../components/Whiteboard'));
const date = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

async function read(url: string, signal: AbortSignal) {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', signal });
  const value = await response.json();
  if (!response.ok) throw new Error(value.message || 'Your whiteboards are temporarily unavailable.');
  return value;
}

export default function WhiteboardWorkspace({ meetingId }: { meetingId?: string }) {
  const [meetings, setMeetings] = useState<HistoryMeeting[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [available, setAvailable] = useState(false), [query, setQuery] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    void Promise.all([read('/api/auth/config', controller.signal), read('/api/auth/meeting-history', controller.signal)])
      .then(([config, history]) => {
        if (controller.signal.aborted) return;
        setAvailable(config.whiteboardConfigured === true); setMeetings(history.meetings);
      }).catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Your whiteboards are temporarily unavailable.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [retry]);
  const selected = meetings.find(meeting => meeting.id === meetingId);
  const terms = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  const filtered = meetings.filter(meeting => terms.every(term => `${meeting.title} ${meeting.hostName}`.toLocaleLowerCase().includes(term)));
  const close = () => { window.history.pushState({}, '', '/whiteboard'); window.dispatchEvent(new PopStateEvent('popstate')); };
  return <main className={`whiteboard-workspace${selected ? ' has-board' : ''}`}>
    <header className="whiteboard-workspace-heading"><div><h1>Whiteboard</h1><p>{selected ? selected.title : 'A space for your ideas, diagrams and shared notes.'}</p></div><span className="whiteboard-workspace-private"><ShieldCheck size={15} />Private to your meetings</span></header>
    {loading ? <p className="whiteboard-workspace-state" role="status">Loading your whiteboards…</p> : error ? <div className="whiteboard-workspace-state" role="alert"><p>{error}</p><button className="secondary-button" onClick={() => setRetry(value => value + 1)}>Try again</button></div> : !available ? <div className="whiteboard-workspace-state"><h2>Whiteboard is unavailable in this environment</h2><p>Your saved work is unchanged. Use the Talk environment where whiteboards are enabled.</p></div> : meetingId && !selected ? <div className="whiteboard-workspace-state" role="alert"><h2>Whiteboard unavailable</h2><p>This meeting is unavailable or you do not have host or co-host access.</p><a className="secondary-button" href="/whiteboard">Back to whiteboards</a></div> : selected ? <Suspense fallback={<p role="status">Loading drawing tools…</p>}><Whiteboard key={selected.id} meetingId={selected.id} canStart onClose={close} closeLabel="Back to whiteboards" /></Suspense> : <>
      <section className="whiteboard-workspace-intro"><span className="whiteboard-workspace-icon"><Pencil size={23} /></span><div><h2>Your meeting whiteboards</h2><p>Choose a meeting to continue its board or open a new one. Use the same drawing, collaboration and assistant tools as in your call.</p></div><a className="secondary-button" href="/meetings"><Video size={16} />Meetings</a></section>
      {meetings.length > 0 && <label className="whiteboard-workspace-search"><Search size={18} aria-hidden="true" /><input type="search" aria-label="Search whiteboards by meeting or host" placeholder="Search by meeting title or host" value={query} onChange={event => setQuery(event.target.value)} /></label>}
      {!meetings.length ? <div className="whiteboard-workspace-state"><h2>Your next idea starts here</h2><p>Create a meeting first, then open its private whiteboard here. No video call is needed to draw.</p><a className="primary-button" href="/meetings">Go to meetings<ArrowRight size={16} /></a></div> : !filtered.length ? <div className="whiteboard-workspace-state"><h2>No matching meetings</h2><button className="secondary-button" onClick={() => setQuery('')}>Clear search</button></div> : <div className="whiteboard-workspace-grid" role="list" aria-label="Meeting whiteboards">{filtered.map(meeting => <article className="whiteboard-workspace-card" role="listitem" key={meeting.id}><div className="whiteboard-workspace-card-top"><span className="whiteboard-workspace-icon"><Pencil size={21} /></span><span>{meeting.endedAt != null ? 'Meeting ended' : 'Open meeting'}</span></div><h2>{meeting.title}</h2><p>Hosted by {meeting.hostName || 'Talk user'}</p><small><CalendarDays size={13} />Created {date.format(new Date(meeting.createdAt))}</small><a className="primary-button" href={`/whiteboard?meeting=${encodeURIComponent(meeting.id)}`} aria-label={`Open whiteboard for ${meeting.title}`}>Open whiteboard<ArrowRight size={16} /></a></article>)}</div>}
    </>}
  </main>;
}
