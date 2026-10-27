import { useEffect, useState } from 'react';
import { ArrowRight, CalendarDays, FileText, Play, Search, ShieldCheck, Video } from 'lucide-react';
import type { HistoryMeeting } from '../lib/meetingHistory';
import '../styles/recordings-workspace.css';

const date = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const count = (value?: number) => Math.max(0, Number(value) || 0);
export default function RecordingsWorkspace() {
  const [meetings, setMeetings] = useState<HistoryMeeting[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [query, setQuery] = useState(''), [scope, setScope] = useState('saved'), [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); let refreshing = false;
    setLoading(true);
    const refresh = async () => {
      if (refreshing) return; refreshing = true;
      try {
        const response = await fetch('/api/auth/meeting-history', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
        const value = await response.json();
        if (!response.ok) throw new Error(value.message || 'Your recordings are temporarily unavailable.');
        if (!controller.signal.aborted) { setMeetings(value.meetings); setError(''); }
      } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Your recordings are temporarily unavailable.'); }
      finally { refreshing = false; if (!controller.signal.aborted) setLoading(false); }
    };
    void refresh(); const timer = window.setInterval(() => void refresh(), 10000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [retry]);
  const words = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  const filtered = meetings.filter(meeting => (scope === 'all' || count(meeting.recordingCount) > 0) && words.every(word => `${meeting.title} ${meeting.hostName}`.toLocaleLowerCase().includes(word)));
  const ready = meetings.reduce((sum, meeting) => sum + count(meeting.recordingCount), 0), transcripts = meetings.reduce((sum, meeting) => sum + count(meeting.transcriptCount), 0);
  return <main className="recordings-workspace">
    <header className="recordings-workspace-heading"><div><h1>Recordings</h1><p>Your saved conversations and transcripts, in one place.</p></div><a className="secondary-button" href="/meetings"><Video size={16} />Record in a meeting</a></header>
    <p className="recordings-workspace-private"><ShieldCheck size={15} />Private to authorized hosts and co-hosts</p>
    {loading ? <div className="recordings-workspace-state" role="status">Loading your recordings…</div> : error ? <div className="recordings-workspace-state" role="alert"><p>{error}</p><button className="secondary-button" onClick={() => setRetry(value => value + 1)}>Try again</button></div> : <>
      <section className="recordings-workspace-summary" aria-label="Recording library totals"><div><span className="recordings-workspace-icon"><Play size={21} /></span><div><h2>Ready recordings</h2><p>Saved and available to play</p></div><strong>{ready}</strong></div><div><span className="recordings-workspace-icon"><FileText size={21} /></span><div><h2>Transcripts ready</h2><p>Search, read or export</p></div><strong>{transcripts}</strong></div></section>
      <div className="recordings-workspace-filters"><label className="recordings-workspace-search"><Search size={18} aria-hidden="true" /><input type="search" aria-label="Search recordings by meeting or host" placeholder="Search by meeting title or host" value={query} onChange={event => setQuery(event.target.value)} /></label><label className="recordings-workspace-scope"><span>Show</span><select aria-label="Recording library view" value={scope} onChange={event => setScope(event.target.value)}><option value="saved">Saved recordings</option><option value="all">All meeting recordings</option></select></label></div>
      <p className="recordings-workspace-caption">{filtered.length} {filtered.length === 1 ? 'meeting' : 'meetings'} · Latest {meetings.length} hosted or co-hosted meetings. Choose “All meeting recordings” to check consent, processing or failed segments.</p>
      {!filtered.length ? <section className="recordings-workspace-state"><h2>{query ? 'No matching recordings' : scope === 'saved' ? 'No saved recordings yet' : 'No meeting recordings yet'}</h2><p>{query ? 'Try another meeting title or host name.' : 'A recording becomes playable after the consented capture is stopped and safely saved. Open a meeting to check individual segments and their status.'}</p>{query ? <button className="secondary-button" onClick={() => setQuery('')}>Clear search</button> : scope === 'saved' && meetings.length ? <button className="secondary-button" onClick={() => setScope('all')}>Show all meeting recordings</button> : <a className="primary-button" href="/meetings">Go to meetings<ArrowRight size={16} /></a>}</section> : <div className="recordings-workspace-grid" role="list" aria-label="Recorded meetings">{filtered.map(meeting => <article role="listitem" key={meeting.id} className="recordings-workspace-card"><div className="recordings-workspace-card-top"><span className="recordings-workspace-icon"><Play size={21} /></span><span className={count(meeting.recordingCount) ? 'is-ready' : ''}>{count(meeting.recordingCount) ? 'Ready to play' : 'Check recording status'}</span></div><h2>{meeting.title}</h2><p>Hosted by {meeting.hostName || 'Talk user'}</p><small><CalendarDays size={13} />Meeting created {date.format(new Date(meeting.createdAt))}</small><div className="recordings-workspace-resources"><span><Play size={13} />{count(meeting.recordingCount)} saved</span><span><FileText size={13} />{count(meeting.transcriptCount)} transcripts ready</span></div><footer>{count(meeting.transcriptCount) > 0 && <a className="secondary-button" href={`/recordings?meeting=${encodeURIComponent(meeting.id)}&tab=transcript`} aria-label={`Read transcripts for ${meeting.title}`}>Transcript<FileText size={14} /></a>}<a className="primary-button" href={`/recordings?meeting=${encodeURIComponent(meeting.id)}&tab=recording`} aria-label={`Open recordings for ${meeting.title}`}>{count(meeting.recordingCount) ? 'Play recordings' : 'View status'}<ArrowRight size={15} /></a></footer></article>)}</div>}
    </>}
  </main>;
}
