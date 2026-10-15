import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays, ChevronDown, ChevronRight, Cloud, Download, FileText, LayoutDashboard, ListChecks, LogOut, Menu, Mic, Play, Radio, Search, Video, X } from 'lucide-react';
import { readSavedDemo } from '../lib/workspacePreview';
import { useAuth } from '../lib/auth';

const sessions = [
  { id: 'workshop', title: 'Social Media Marketing Workshop', type: 'meetings', detail: 'Meeting · Interactive workshop', status: 'Ready to explore', href: '/device-test', action: 'Open', Icon: Video },
  { id: 'webinar', title: 'Learn from our AppSumo success', type: 'webinars', detail: 'Webinar · On-demand session', status: 'On demand', href: '/webinars', action: 'View', Icon: Radio },
  { id: 'demo', title: 'See Talk in action', type: 'demos', detail: 'Demo · A tour with Team Talk', status: 'Book a time', href: '/bookings', action: 'Book', Icon: CalendarDays },
];
const navigation = [
  { label: 'Overview', href: '/dashboard', Icon: LayoutDashboard },
  { label: 'Meetings', href: '/device-test', Icon: Video },
  { label: 'Webinars', href: '/webinars', Icon: Radio },
  { label: 'Bookings', href: '/bookings', Icon: CalendarDays },
  { label: 'Agendas', href: '/meeting', Icon: ListChecks },
  { label: 'Transcripts', href: '/meeting?panel=transcript', Icon: FileText },
  { label: 'Cloud storage', href: '/dashboard#library', Icon: Cloud },
];

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const email = user?.email || user?.phoneNumber || '';
  const name = user?.name || '';
  const booking = readSavedDemo();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [accountError, setAccountError] = useState('');
  const [pictureFailed, setPictureFailed] = useState(false);
  const sidebar = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const account = useRef<HTMLDivElement>(null);
  const visibleSessions = sessions.filter(session => (filter === 'all' || session.type === filter) && `${session.title} ${session.detail}`.toLowerCase().includes(query.trim().toLowerCase()));
  const initial = (name || email).slice(0, 1).toUpperCase() || 'Y';
  const closeMobile = () => { setMobileOpen(false); menuButton.current?.focus(); };
  const leaveWorkspace = async () => {
    setSigningOut(true); setAccountError('');
    try { await signOut(); }
    catch { setAccountError('Could not sign out. Please try again.'); setAccountOpen(true); }
    finally { setSigningOut(false); }
  };
  const exitLabel = signingOut ? 'Signing out…' : 'Sign out';
  const isGoogle = user?.provider === 'google';
  const isPhone = user?.provider === 'phone';

  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!account.current?.contains(event.target as Node)) setAccountOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setAccountOpen(false); if (account.current?.contains(document.activeElement)) account.current.querySelector<HTMLButtonElement>('.dashboard-account-button')?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, []);
  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    sidebar.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMobileOpen(false); menuButton.current?.focus(); }
      if (event.key !== 'Tab') return;
      const items = Array.from(sidebar.current?.querySelectorAll<HTMLElement>('a[href], button') || []).filter(element => element.getClientRects().length);
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keyboard);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', keyboard); };
  }, [mobileOpen]);

  return <div className="dashboard-app">
    {mobileOpen && <button className="dashboard-scrim" aria-label="Close workspace navigation" onClick={closeMobile} />}
    <aside ref={sidebar} id="workspace-navigation" className={`dashboard-sidebar ${mobileOpen ? 'is-open' : ''}`}>
      <div className="dashboard-sidebar-brand"><a href="/dashboard" aria-label="Talk overview">Talk</a><button className="dashboard-mobile-close" aria-label="Close navigation" onClick={closeMobile}><X size={20} /></button></div>
      <div className="dashboard-workspace"><span>T</span><div><strong>My workspace</strong><small>{isGoogle ? 'Google account' : isPhone ? 'Verified phone' : 'Verified email'}</small></div></div>
      <p className="dashboard-nav-label">WORKSPACE</p>
      <nav aria-label="Workspace navigation">{navigation.map(({ label, href, Icon }) => <a key={label} href={href} className={label === 'Overview' ? 'is-active' : ''} aria-current={label === 'Overview' ? 'page' : undefined} onClick={() => setMobileOpen(false)}><Icon size={18} /><span>{label}</span></a>)}</nav>
      <div className="dashboard-sidebar-bottom"><a href="/" className="dashboard-website-link"><ArrowLeft size={16} />Back to website</a><button disabled={signingOut} onClick={() => void leaveWorkspace()}><LogOut size={16} />{exitLabel}</button></div>
    </aside>

    <div className="dashboard-main">
      <header className="dashboard-topbar">
        <div className="dashboard-topbar-location"><button ref={menuButton} className="dashboard-menu-button" aria-label="Open navigation" aria-controls="workspace-navigation" aria-expanded={mobileOpen} onClick={() => { setAccountOpen(false); setMobileOpen(true); }}><Menu size={21} /></button><span className="dashboard-breadcrumb-parent">My workspace<ChevronRight size={14} /></span><strong>Overview</strong></div>
        <div className="dashboard-topbar-actions"><span className="dashboard-preview-badge">{isGoogle ? 'Google signed in' : isPhone ? 'Phone verified' : 'Email verified'}</span><div className="dashboard-account" ref={account}><button className="dashboard-account-button" aria-label="Open account menu" aria-expanded={accountOpen} onClick={() => setAccountOpen(!accountOpen)}><span>{user?.picture && !pictureFailed ? <img src={user.picture} alt="" referrerPolicy="no-referrer" onError={() => setPictureFailed(true)} /> : initial}</span><ChevronDown size={14} /></button>{accountOpen && <div className="dashboard-account-menu"><strong>{name || 'Your workspace'}</strong><p>{email}</p><a className="dashboard-account-link" href="/choose-account">Switch account<ArrowRight size={14} /></a>{isGoogle && !user?.hasPassword && <a className="dashboard-account-link" href="/sign-up?mode=link">Add email sign-in<ArrowRight size={14} /></a>}{!user?.hasPhone && <a className="dashboard-account-link" href="/phone-sign-in?mode=link">Add phone sign-in<ArrowRight size={14} /></a>}{accountError && <p role="alert" className="dashboard-account-error">{accountError}</p>}<button disabled={signingOut} onClick={() => void leaveWorkspace()}><LogOut size={15} />{exitLabel}</button></div>}</div></div>
      </header>

      <main className="dashboard-content">
        <div className="dashboard-page-heading"><div><h1>Overview</h1><p>Your sessions, resources and next steps, together.</p></div><a className="primary-button" href="/device-test"><Video size={17} />Start a session</a></div>
        <p className="dashboard-preview-note">Sample sessions and resources for exploring your workspace.</p>

        <section className="dashboard-welcome" aria-labelledby="workspace-welcome">
          <div className="dashboard-welcome-copy"><span>YOUR SPACE. YOUR STAGE.</span><h2 id="workspace-welcome">Make your next session<br />a great one.</h2><p>Bring everyone together with a little more Talk.</p><a href="/device-test" className="secondary-button">Test audio &amp; video<ArrowRight size={16} /></a></div>
          <div className="dashboard-welcome-art" aria-hidden="true"><svg viewBox="0 0 320 200" focusable="false"><ellipse cx="170" cy="103" rx="120" ry="66" /><path d="M60 85Q165 5 269 130M68 146Q166 180 242 48M60 85Q150 110 68 146M242 48Q150 110 269 130" /><circle cx="170" cy="103" r="48" /><circle cx="170" cy="103" r="34" /></svg><img src="/assets/stitch/image-05.jpg" alt="" className="dashboard-art-person person-one" /><img src="/assets/stitch/image-07.jpg" alt="" className="dashboard-art-person person-two" /><img src="/assets/stitch/image-14.jpg" alt="" className="dashboard-art-person person-three" /><div className="dashboard-art-logo">Talk</div></div>
        </section>

        <section className="dashboard-stats" aria-label="Workspace summary">
          {[{ label: 'Session previews', value: sessions.length, note: 'Ready to explore', Icon: Video }, { label: 'Webinars', value: 1, note: 'Available on demand', Icon: Radio }, { label: 'Recordings', value: 1, note: 'In your sample library', Icon: Play }, { label: 'Saved bookings', value: booking ? 1 : 0, note: 'Saved in this browser', Icon: CalendarDays }].map(({ label, value, note, Icon }) => <div className="dashboard-stat" key={label}><div className="dashboard-stat-heading"><span>{label}</span><span className="dashboard-stat-icon"><Icon size={18} /></span></div><strong>{value.toString().padStart(2, '0')}</strong><p>{note}</p></div>)}
        </section>

        <div className="dashboard-lower-grid">
          <div className="dashboard-primary-column">
            <section className="dashboard-card" id="sessions" aria-labelledby="dashboard-sessions-heading">
              <div className="dashboard-card-heading"><div><h2 id="dashboard-sessions-heading">Your sessions</h2><p>A few ways to get started with Talk.</p></div><span className="dashboard-card-count">{sessions.length} previews</span></div>
              <div className="dashboard-session-tools"><div className="dashboard-filters" role="group" aria-label="Filter sessions">{[['all', 'All sessions'], ['meetings', 'Meetings'], ['webinars', 'Webinars'], ['demos', 'Demos']].map(([value, label]) => <button key={value} aria-pressed={filter === value} className={filter === value ? 'is-selected' : ''} onClick={() => setFilter(value)}>{label}</button>)}</div><div className="dashboard-search"><Search size={16} aria-hidden="true" /><input type="search" aria-label="Search sessions" placeholder="Search sessions" value={query} onChange={event => setQuery(event.target.value)} />{query && <button aria-label="Clear session search" onClick={() => setQuery('')}><X size={14} /></button>}</div></div>
              <div className="dashboard-session-list" aria-live="polite">{visibleSessions.length ? visibleSessions.map(({ id, title, detail, status, href, action, Icon }) => <article key={id} className="dashboard-session-row"><div className="dashboard-session-summary"><span className="dashboard-session-icon"><Icon size={18} /></span><div><h3><a href={href}>{title}</a></h3><p>{detail}</p></div></div><span className={`dashboard-session-status ${id === 'webinar' ? 'is-gold' : ''}`}>{status}</span><a className="dashboard-row-action" href={href} aria-label={`${action} ${title}`}>{action}<ChevronRight size={15} /></a></article>) : <div className="dashboard-empty"><Search size={24} /><h3>No sessions found</h3><p>Try another search or reset your filters.</p><button className="secondary-button" onClick={() => { setQuery(''); setFilter('all'); }}>Reset filters</button></div>}</div>
            </section>

            <section className="dashboard-card dashboard-library" id="library" aria-labelledby="dashboard-library-heading"><div className="dashboard-card-heading"><div><h2 id="dashboard-library-heading">Your library</h2><p>Keep the conversation close.</p></div><span className="dashboard-library-cloud"><Cloud size={22} /></span></div><div className="dashboard-recording"><span className="dashboard-recording-icon"><Play size={22} /></span><div><h3>Social Media Marketing Workshop</h3><p>Sample recording · Video &amp; transcript</p></div></div><div className="dashboard-library-actions"><a href="/meeting" className="secondary-button"><Play size={15} />Watch recording</a><a href="/meeting?panel=transcript" className="secondary-button"><FileText size={15} />Open transcript</a><a className="dashboard-download" href="/reference/session-recording.mp4" download="social-media-marketing-workshop.mp4"><Download size={15} />Download</a></div></section>
          </div>

          <aside className="dashboard-secondary-column" aria-label="Workspace quick actions">
            <section className="dashboard-card dashboard-quick-actions"><div className="dashboard-card-heading"><h2>Quick actions</h2></div>{[{ title: 'Check your setup', text: 'Test your camera and microphone.', href: '/device-test', Icon: Mic }, { title: 'Explore a webinar', text: 'Meet the speakers and see the agenda.', href: '/webinars', Icon: Radio }, { title: 'Book a live demo', text: 'Find a time to see Talk in action.', href: '/bookings', Icon: CalendarDays }].map(({ title, text, href, Icon }) => <a href={href} key={title} className="dashboard-quick-action"><span><Icon size={18} /></span><div><strong>{title}</strong><p>{text}</p></div><ChevronRight size={16} /></a>)}</section>
            <section className="dashboard-card dashboard-saved-demo"><div className="dashboard-card-heading"><h2>Your saved demo</h2><CalendarDays size={20} /></div>{booking ? <><span className="dashboard-booking-status">{booking.start.getTime() > Date.now() ? 'Upcoming' : 'Saved in this browser'}</span><h3>See Talk in action</h3><p>{new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(booking.start)}<br />{booking.time} · India Standard Time</p><a href="/bookings" className="dashboard-inline-link">View demo times<ArrowRight size={15} /></a></> : <><span className="dashboard-empty-calendar"><CalendarDays size={25} /></span><h3>A little time. A lot to discover.</h3><p>Book a tour with Team Talk and see what your next session could look like.</p><a href="/bookings" className="secondary-button">Book a demo<ArrowRight size={15} /></a></>}</section>
          </aside>
        </div>
        <footer className="dashboard-footer"><span>© 2026 Talk</span><a href="/#security">Privacy &amp; security</a></footer>
      </main>
    </div>
  </div>;
}
