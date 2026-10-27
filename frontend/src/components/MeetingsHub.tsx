import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays, Check, ChevronRight, Clock3, Copy, FileText, FolderOpen, LayoutGrid, Link2, List, LoaderCircle, LogIn, Play, Plus, Search, ShieldCheck, Users, Video, X } from 'lucide-react';
import { createTalkMeeting, navigateToMeeting } from '../lib/meetingSession';
import { parseTalkMeetingLink } from '../lib/meetingLink';
import { type HistoryMeeting, type MeetingHistoryFilters, filterMeetingHistory, meetingHistorySummary, formatMeetingDuration, isEndedMeeting } from '../lib/meetingHistory';
import '../styles/meetings-hub.css';
import '../styles/meeting-cards.css';

type Props = { meetings: HistoryMeeting[]; loading: boolean; error: string; onRetry: () => void };
const initialFilters: MeetingHistoryFilters = { query: '', kind: 'all', dateRange: 'all', host: '', sort: 'newest' };
const dateFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const amount = (value: number | undefined) => Math.max(0, Number.isFinite(value) ? value || 0 : 0);

function MeetingCard({ meeting, onCopy, copied, copyFallback }: { meeting: HistoryMeeting; onCopy: (id: string) => void; copied: boolean; copyFallback: string }) {
  const ended = isEndedMeeting(meeting);
  const recordings = amount(meeting.recordingCount), transcripts = amount(meeting.transcriptCount), participants = amount(meeting.participantCount);
  const created = new Date(meeting.createdAt);
  const validDate = Number.isFinite(created.getTime());
  const detailsUrl = `/meeting-history/${encodeURIComponent(meeting.id)}`;
  return <article role="listitem" aria-labelledby={`meeting-card-title-${meeting.id}`} className={`meetings-hub-card${ended ? ' is-ended' : ''}`}>
    <div className="meetings-hub-card-main">
      <div className="meetings-hub-card-top"><span className="meetings-hub-card-icon" aria-hidden="true"><Video size={22} /></span><span className={`meetings-hub-status${ended ? ' is-ended' : ''}`}><span />{ended ? 'Ended' : 'Open room'}</span></div>
      <div className="meetings-hub-card-copy">
        <div className="meetings-hub-card-title"><h3 id={`meeting-card-title-${meeting.id}`}><a href={detailsUrl}>{meeting.title}</a></h3></div>
        <p className="meetings-hub-host-line">Hosted by {meeting.hostName || 'Talk user'}</p>
        <span className="meetings-hub-card-created"><CalendarDays size={13} aria-hidden="true"/>Created {validDate ? <time dateTime={created.toISOString()} title={dateFormatter.format(created)+' '+timeFormatter.format(created)}>{dateFormatter.format(created)}</time> : 'date unavailable'}</span>
        <div className="meetings-hub-card-meta"><span><CalendarDays size={14} aria-hidden="true" />Created {validDate ? <time dateTime={created.toISOString()}>{dateFormatter.format(created)} · {timeFormatter.format(created)}</time> : 'date unavailable'}</span><span><Users size={14} aria-hidden="true" />{participants} {participants === 1 ? 'member' : 'members'}</span>{ended && <span><Clock3 size={14} aria-hidden="true" />Room lifetime: {formatMeetingDuration(Math.max(0, (meeting.endedAt || 0) - meeting.createdAt))}</span>}</div>
        <div className="meetings-hub-card-resources">{!recordings && !transcripts && <span className="meetings-hub-resources-empty">No saved recordings or transcripts</span>}{recordings ? <a className="meetings-hub-resource has-content" href={`${detailsUrl}?tab=recording`} aria-label={`Open recordings for ${meeting.title}`}><Video size={13} aria-hidden="true" />{recordings} {recordings === 1 ? 'recording' : 'recordings'}</a> : <span className="meetings-hub-resource"><Video size={13} aria-hidden="true" />No recordings</span>}{transcripts ? <a className="meetings-hub-resource has-content" href={`${detailsUrl}?tab=transcript`} aria-label={`Open transcripts for ${meeting.title}`}><FileText size={13} aria-hidden="true" />{transcripts} {transcripts === 1 ? 'transcript' : 'transcripts'}</a> : <span className="meetings-hub-resource"><FileText size={13} aria-hidden="true" />No transcripts</span>}</div>
      </div>
    </div>
    <div className="meetings-hub-card-bottom"><span className="meetings-hub-member-count" title={`${participants} ${participants===1?'member':'members'}`}><Users size={16} aria-hidden="true"/>{participants}<span>{participants===1?'member':'members'}</span></span><div className="meetings-hub-card-actions">{!ended ? <a className="meetings-hub-card-primary" href={`/device-test?room=${encodeURIComponent(meeting.id)}`} aria-label={`Join ${meeting.title}`}><Video size={16} aria-hidden="true" />Join room<ArrowRight size={15} aria-hidden="true" /></a> : recordings ? <a className="meetings-hub-card-primary" href={`${detailsUrl}?tab=recording`} aria-label={`Play recording for ${meeting.title}`}><Play size={15} aria-hidden="true" />Play recording<ArrowRight size={15} aria-hidden="true" /></a> : <a className="meetings-hub-card-primary" href={detailsUrl} aria-label={`View details for ${meeting.title}`}>View details<ArrowRight size={15} aria-hidden="true" /></a>}<div className="meetings-hub-card-secondary-actions">{!ended && <button type="button" className="meetings-hub-copy" onClick={() => onCopy(meeting.id)} aria-label={`Copy link for ${meeting.title}`}>{copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}<span>{copied ? 'Copied' : 'Copy link'}</span></button>}{(!ended || recordings > 0) && <a className="meetings-hub-details" href={detailsUrl} aria-label={`View details for ${meeting.title}`}>View details<ChevronRight size={16} aria-hidden="true" /></a>}</div></div></div>
    {copyFallback && <div className="meetings-hub-copy-fallback"><label htmlFor={`meeting-link-${meeting.id}`}>Copy the meeting link below. Access rules still apply.</label><input id={`meeting-link-${meeting.id}`} readOnly value={copyFallback} onFocus={event => event.currentTarget.select()} /></div>}
  </article>;
}

export default function MeetingsHub({ meetings, loading, error, onRetry }: Props) {

  const [filters, setFilters] = useState<MeetingHistoryFilters>(initialFilters);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [starting, setStarting] = useState(false), [createError, setCreateError] = useState('');
  const [meetingTitle, setMeetingTitle] = useState(''), [approvalRequired, setApprovalRequired] = useState(true);
  const [meetingLink, setMeetingLink] = useState(''), [joinError, setJoinError] = useState('');
  const [copied, setCopied] = useState(''), [copyFallback, setCopyFallback] = useState({ id: '', url: '' });
  const startingRef = useRef(false), copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const createDialog = useRef<HTMLDialogElement>(null), createTrigger = useRef<HTMLElement | null>(null), titleInput = useRef<HTMLInputElement>(null);
  const joinDialog = useRef<HTMLDialogElement>(null), joinTrigger = useRef<HTMLElement | null>(null), linkInput = useRef<HTMLInputElement>(null);
  const summary = useMemo(() => meetingHistorySummary(meetings), [meetings]);
  const visibleMeetings = useMemo(() => filterMeetingHistory(meetings, filters), [meetings, filters]);
  const hosts = useMemo(() => [...new Set(meetings.map(meeting => meeting.hostName).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [meetings]);
  const hasFilters = filters.query !== '' || filters.kind !== 'all' || filters.dateRange !== 'all' || filters.host !== '' || filters.sort !== 'newest';
  const hasData = !loading && (!error || meetings.length > 0);
  const categories: { value: MeetingHistoryFilters['kind']; label: string; count: number }[] = [
    { value: 'all', label: 'All meetings', count: meetings.length },
    { value: 'open', label: 'Open rooms', count: summary.open },
    { value: 'ended', label: 'Ended', count: meetings.length - summary.open },
    { value: 'recordings', label: 'With recordings', count: meetings.filter(meeting => amount(meeting.recordingCount) > 0).length },
    { value: 'transcripts', label: 'With transcripts', count: meetings.filter(meeting => amount(meeting.transcriptCount) > 0).length },
  ];
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);
  const updateFilter = <K extends keyof MeetingHistoryFilters>(key: K, value: MeetingHistoryFilters[K]) => setFilters(previous => ({ ...previous, [key]: value }));
  const openCreateDialog = () => {
    createTrigger.current = document.activeElement as HTMLElement | null;
    setCreateError(''); createDialog.current?.showModal(); titleInput.current?.focus();
  };
  const closeCreateDialog = () => {
    if (startingRef.current) return;
    createDialog.current?.close(); createTrigger.current?.focus();
  };
  const openJoinDialog = () => {
    joinTrigger.current = document.activeElement as HTMLElement | null;
    setJoinError(''); joinDialog.current?.showModal(); linkInput.current?.focus();
  };
  const closeJoinDialog = () => {
    joinDialog.current?.close(); joinTrigger.current?.focus();
  };
  const joinMeeting = () => {
    const roomId = parseTalkMeetingLink(meetingLink, window.location.origin);
    if (!roomId) {
      setJoinError('Enter a valid Talk meeting link from this site, or the meeting ID shared by your host.');
      linkInput.current?.focus(); return;
    }
    joinDialog.current?.close();
    navigateToMeeting(`/device-test?room=${encodeURIComponent(roomId)}`);
  };
  const startMeeting = async () => {
    if (startingRef.current) return;
    const title = meetingTitle.trim();
    if (!title || title.length > 80) { setCreateError('Enter a meeting title between 1 and 80 characters.'); titleInput.current?.focus(); return; }
    startingRef.current = true; setStarting(true); setCreateError('');
    try { const created = await createTalkMeeting({ title, approvalRequired }); navigateToMeeting(`/device-test?room=${encodeURIComponent(created.id)}`); }
    catch (failure) { setCreateError(failure instanceof Error ? failure.message : 'Could not create the meeting. Please try again.'); }
    finally { startingRef.current = false; setStarting(false); }
  };
  const copyMeetingLink = async (id: string) => {
    const url = new URL(`/device-test?room=${encodeURIComponent(id)}`, window.location.origin).href;
    if (copyTimer.current) clearTimeout(copyTimer.current);
    setCopied(''); setCopyFallback({ id: '', url: '' });
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(url); setCopied(id);
      copyTimer.current = setTimeout(() => setCopied(''), 3000);
    } catch { setCopyFallback({ id, url }); }
  };

  return <div className="meetings-hub workspace-reference">
    <dialog ref={joinDialog} className="meetings-hub-create-dialog meetings-hub-join-dialog" aria-labelledby="meetings-hub-join-heading" aria-describedby="meetings-hub-join-description" onCancel={event => { event.preventDefault(); closeJoinDialog(); }} onClick={event => { if (event.target === event.currentTarget) closeJoinDialog(); }}>
      <form onSubmit={event => { event.preventDefault(); joinMeeting(); }}>
        <div className="meetings-hub-create-heading"><span><Link2 size={22} aria-hidden="true" /></span><button type="button" aria-label="Close join meeting" onClick={closeJoinDialog}><X size={20} aria-hidden="true" /></button></div>
        <h2 id="meetings-hub-join-heading">Join a meeting</h2>
        <p id="meetings-hub-join-description">Paste the link or meeting ID shared by your host. Next, check your camera and microphone before joining.</p>
        <label className="meetings-hub-create-title" htmlFor="join-meeting-link">Meeting link or ID<input ref={linkInput} id="join-meeting-link" required maxLength={2048} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="Paste a Talk meeting link or ID" value={meetingLink} onChange={event => { setMeetingLink(event.target.value); setJoinError(''); }} aria-invalid={!!joinError} aria-describedby={`meetings-hub-join-help${joinError ? ' meetings-hub-join-error' : ''}`} /></label>
        <p id="meetings-hub-join-help" className="meetings-hub-join-help"><ShieldCheck size={15} aria-hidden="true" />Host approval and meeting access rules still apply.</p>
        {joinError && <p id="meetings-hub-join-error" className="meetings-hub-create-error" role="alert">{joinError}</p>}
        <div className="meetings-hub-create-actions"><button type="button" className="secondary-button" onClick={closeJoinDialog}>Cancel</button><button type="submit" className="primary-button"><LogIn size={17} aria-hidden="true" />Join meeting</button></div>
      </form>
    </dialog>
    <dialog ref={createDialog} className="meetings-hub-create-dialog" aria-labelledby="meetings-hub-create-heading" onCancel={event => { event.preventDefault(); closeCreateDialog(); }} onClick={event => { if (event.target === event.currentTarget) closeCreateDialog(); }}>
      <form onSubmit={event => { event.preventDefault(); void startMeeting(); }}><div className="meetings-hub-create-heading"><span><Video size={22} /></span><button type="button" aria-label="Close new meeting" disabled={starting} onClick={closeCreateDialog}><X size={20} /></button></div><h2 id="meetings-hub-create-heading">Create a meeting</h2><p>Give your room a name. You’ll check your camera and microphone before joining.</p><label className="meetings-hub-create-title" htmlFor="new-meeting-title">Meeting title<input ref={titleInput} id="new-meeting-title" required maxLength={80} autoComplete="off" placeholder="e.g. Daily team check-in" value={meetingTitle} onChange={event => setMeetingTitle(event.target.value)} disabled={starting} /></label><span className="meetings-hub-title-length">{meetingTitle.length}/80</span><label className="meetings-hub-approval"><input type="checkbox" checked={approvalRequired} onChange={event => setApprovalRequired(event.target.checked)} disabled={starting} /><span><strong>Require host approval to join</strong><small>People wait until you or a co-host admits them.</small></span></label>{createError && <p className="meetings-hub-create-error" role="alert">{createError}</p>}<div className="meetings-hub-create-actions"><button type="button" className="secondary-button" disabled={starting} onClick={closeCreateDialog}>Cancel</button><button type="submit" className="primary-button" disabled={starting} aria-busy={starting}>{starting ? <LoaderCircle size={16} className="meetings-hub-spinner" /> : <Plus size={16} />}{starting ? 'Creating meeting…' : 'Create meeting'}</button></div></form>
    </dialog>

    <main className="meetings-hub-main">
      <a href="/dashboard" className="meetings-hub-back"><ArrowLeft size={15} />Back to overview</a>
      <div className="meetings-hub-heading"><div><h1>Meetings</h1><p>Your conversations, recordings and transcripts. All in one place.</p></div><div className="meetings-hub-heading-actions"><a className="secondary-button" href="/device-test"><Video size={17} />Test audio &amp; video</a><button className="secondary-button" type="button" onClick={openJoinDialog}><LogIn size={18} aria-hidden="true" />Join meeting</button><button className="primary-button" type="button" onClick={openCreateDialog}><Plus size={18} />New meeting</button></div></div>
      <section className="meetings-hub-stats" aria-label="Meeting library summary">{[
        { label: 'Meetings in library', value: summary.meetings, description: 'Hosted or co-hosted by you', Icon: Video },
        { label: 'Recordings available', value: summary.recordings, description: 'Saved meeting recordings', Icon: FolderOpen },
        { label: 'Transcripts ready', value: summary.transcripts, description: 'Completed transcripts', Icon: FileText },
      ].map(({ label, value, description, Icon }) => <div key={label} className="meetings-hub-stat"><span className="meetings-hub-stat-icon"><Icon size={20} /></span><div><span>{label}</span><strong aria-label={hasData ? `${value} ${label.toLowerCase()}` : `${label} loading`}>{hasData ? value : '—'}</strong><small>{description}</small></div></div>)}</section>
      <section className="meetings-hub-library" aria-labelledby="meetings-hub-library-heading"><div className="meetings-hub-library-heading"><div><h2 id="meetings-hub-library-heading">Your meeting library</h2><p>Find a room or revisit a conversation.</p></div><span className="meetings-hub-access"><ShieldCheck size={14}/>Host &amp; co-host access</span></div>
        <div className="meetings-hub-categories" role="group" aria-label="Filter meeting category">{categories.map(({ value, label, count }) => <button key={value} type="button" aria-pressed={filters.kind === value} onClick={() => updateFilter('kind', value)}>{label}<span className="meetings-hub-tab-count">{hasData ? count : '?'}</span></button>)}</div>
        <div className="meetings-hub-filters"><div className="meetings-hub-search"><Search size={18} aria-hidden="true" /><label htmlFor="meetings-hub-search" className="meetings-hub-sr-only">Search meetings by title or host</label><input id="meetings-hub-search" type="search" placeholder="Search by meeting title or host" value={filters.query} onChange={event => updateFilter('query', event.target.value)} />{filters.query && <button type="button" aria-label="Clear meeting search" onClick={() => updateFilter('query', '')}><X size={16} /></button>}</div><div className="meetings-hub-selects"><label htmlFor="meetings-hub-date"><span id="meetings-hub-date-label">Created date</span><select id="meetings-hub-date" aria-labelledby="meetings-hub-date-label" value={filters.dateRange} onChange={event => updateFilter('dateRange', event.target.value as MeetingHistoryFilters['dateRange'])}><option value="all">All dates</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select></label><label htmlFor="meetings-hub-host"><span id="meetings-hub-host-label">Host</span><select id="meetings-hub-host" aria-labelledby="meetings-hub-host-label" value={filters.host} onChange={event => updateFilter('host', event.target.value)}><option value="">All hosts</option>{hosts.map(host => <option key={host} value={host}>{host}</option>)}</select></label><label htmlFor="meetings-hub-sort"><span id="meetings-hub-sort-label">Sort by</span><select id="meetings-hub-sort" aria-labelledby="meetings-hub-sort-label" value={filters.sort} onChange={event => updateFilter('sort', event.target.value as MeetingHistoryFilters['sort'])}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="title">Meeting title</option></select></label></div></div>
        <div className="meetings-hub-results-summary"><p aria-live="polite">{loading ? 'Loading your meetings…' : error && !meetings.length ? 'Meeting library unavailable' : `${visibleMeetings.length} ${visibleMeetings.length === 1 ? 'meeting' : 'meetings'}${hasFilters ? ` of ${meetings.length}` : ''}${meetings.length >= 100 ? ' · Latest 100 rooms' : ''}`}</p><div className="meetings-hub-result-actions">{hasFilters && <button type="button" className="meetings-hub-clear-filters" onClick={() => setFilters(initialFilters)}><X size={13} />Clear filters</button>}<div className="meetings-hub-view-switch" role="group" aria-label="Meeting view"><button type="button" aria-label="Card view" aria-pressed={view === 'grid'} onClick={() => setView('grid')}><LayoutGrid size={15} aria-hidden="true" /><span>Cards</span></button><button type="button" aria-label="List view" aria-pressed={view === 'list'} onClick={() => setView('list')}><List size={16} aria-hidden="true" /><span>List</span></button></div></div></div>
        {error && <div className="meetings-hub-load-error" role="alert"><div><h3>We couldn’t refresh your meetings.</h3><p>{error}</p></div><button type="button" className="secondary-button" onClick={onRetry} disabled={loading}>Try again</button></div>}
        {loading ? <div className={`meetings-hub-loading is-${view}`} role="status"><span className="meetings-hub-sr-only">Loading meeting history</span>{[0, 1, 2].map(value => <div key={value} className="meetings-hub-skeleton" aria-hidden="true"><span /><div><i /><i /><i /></div></div>)}</div> : visibleMeetings.length ? <div className={`meetings-hub-list is-${view}`} role="list" aria-label="Meeting list">{visibleMeetings.map(meeting => <MeetingCard key={meeting.id} meeting={meeting} copied={copied === meeting.id} onCopy={id => void copyMeetingLink(id)} copyFallback={copyFallback.id === meeting.id ? copyFallback.url : ''} />)}</div> : !error && <div className="meetings-hub-empty"><span>{hasFilters ? <Search size={27} /> : <Video size={29} />}</span><h3>{hasFilters ? 'No meetings match your filters' : 'Your next conversation starts here'}</h3><p>{hasFilters ? 'Try a different title, host or date range, or clear your filters.' : 'Create your first meeting and invite your team. Rooms you host or co-host will appear here.'}</p>{hasFilters ? <button type="button" className="secondary-button" onClick={() => setFilters(initialFilters)}>Clear filters</button> : <button type="button" className="primary-button" onClick={openCreateDialog}><Plus size={17} />Create a meeting</button>}</div>}
      </section>
      <footer className="meetings-hub-footer"><p><ShieldCheck size={15} />Recordings and transcripts are available only to authorized hosts and co-hosts.</p><span>Made for better conversations.</span></footer>
      <span className="meetings-hub-sr-only" role="status">{copied ? 'Meeting link copied to clipboard.' : copyFallback.url ? 'Clipboard unavailable. Select and copy the meeting link shown in the card.' : ''}</span>
    </main>
  </div>;
}
