import { lazy, Suspense, useEffect, useState } from 'react';
import Shell from './components/Shell';
import WorkspaceShell from './components/WorkspaceShell';
import Landing from './pages/Landing';
import Webinar from './pages/Webinar';
import DeviceTest from './pages/DeviceTest';
import MeetingRoom from './pages/MeetingRoom';
import Booking from './pages/Booking';
import PublicBooking from './pages/PublicBooking';
import AuthTransition from './components/AuthTransition';
import Dashboard from './pages/Dashboard';
import MeetingHistory from './pages/MeetingHistory';
import DashboardAccess from './components/DashboardAccess';
import VerifyEmail from './pages/VerifyEmail';
import ForgotPassword from './pages/ForgotPassword';
import ChooseAccount from './pages/ChooseAccount';
import ConfirmSignIn from './pages/ConfirmSignIn';
import { clearPendingPassword } from './lib/browserPasswords';
import { clearPendingMeetingJoin } from './lib/meetingSession';

const PhoneSignIn = lazy(() => import('./pages/PhoneSignIn'));
const VerifyPhone = lazy(() => import('./pages/VerifyPhone'));
const WhiteboardWorkspace = lazy(() => import('./pages/WhiteboardWorkspace'));
const RecordingsWorkspace = lazy(() => import('./pages/RecordingsWorkspace'));
const Analytics = lazy(() => import('./pages/Analytics'));

export default function AppRouter() {
  const [route, setRoute] = useState(window.location.pathname + window.location.search);
  const path = route.split('?')[0];
  useEffect(() => {
    let previousPath = window.location.pathname;
    if (window.location.pathname !== '/verify-email') clearPendingPassword();
    const leavePhone = () => { window.dispatchEvent(new Event('talk:phone-auth-leave')); };
    const update = () => {
      const nextPath = window.location.pathname;
      const switchingAuthForms = ['/sign-in', '/sign-up'].includes(previousPath) && ['/sign-in', '/sign-up'].includes(nextPath);
      previousPath = nextPath;
      if (window.location.pathname !== '/meeting' || new URLSearchParams(window.location.search).get('live') !== '1') clearPendingMeetingJoin();
      if (window.location.pathname !== '/verify-email') clearPendingPassword();
      if (!['/phone-sign-in', '/verify-phone'].includes(window.location.pathname)) leavePhone();
      setRoute(window.location.pathname + window.location.search);
      if (!switchingAuthForms) window.scrollTo(0, 0);
    };
    const links = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');
      if (!anchor || anchor.target || anchor.hasAttribute('download')) return;
      const url = new URL(anchor.href);
      if(url.origin===window.location.origin&&url.pathname==='/analytics'){event.preventDefault();window.history.pushState({},'',url.pathname+url.search);update();return;}
      if (url.origin !== window.location.origin || !['/', '/webinars', '/device-test', '/test', '/meeting', '/bookings', '/sign-in', '/sign-up', '/verify-email', '/forgot-password', '/phone-sign-in', '/verify-phone', '/choose-account', '/confirm-sign-in', '/dashboard', '/meetings', '/recordings', '/whiteboard', '/booking-confirmation'].includes(url.pathname) && !/^\/booking\/[a-z0-9-]+\/[a-z0-9-]+$/.test(url.pathname) && !/^\/meeting-history(?:\/[a-z\d-]+)?$/.test(url.pathname)) return;
      if (url.pathname === window.location.pathname && url.hash) return;
      event.preventDefault();
      window.history.pushState({}, '', url.pathname + url.search + url.hash);
      update();
      if (url.hash) requestAnimationFrame(() => document.querySelector(url.hash)?.scrollIntoView({ behavior: 'smooth' }));
    };
    window.addEventListener('popstate', update);
    window.addEventListener('pagehide', clearPendingPassword);
    window.addEventListener('pagehide', clearPendingMeetingJoin);
    window.addEventListener('pagehide', leavePhone);
    document.addEventListener('click', links);
    return () => { clearPendingPassword(); clearPendingMeetingJoin(); leavePhone(); window.removeEventListener('popstate', update); window.removeEventListener('pagehide', clearPendingPassword); window.removeEventListener('pagehide', clearPendingMeetingJoin); window.removeEventListener('pagehide', leavePhone); document.removeEventListener('click', links); };
  }, []);
  useEffect(() => {
    const titles: Record<string, string> = { '/webinars': 'Webinars', '/device-test': 'Test your camera and microphone', '/meeting': 'Social Media Marketing Workshop', '/bookings': 'Bookings', '/recordings': 'Recordings', '/whiteboard': 'Whiteboard', '/sign-in': 'Sign in', '/sign-up': 'Sign up', '/verify-email': 'Verify your email', '/forgot-password':'Reset your password', '/phone-sign-in': 'Continue with phone number', '/verify-phone': 'Verify your phone', '/choose-account': 'Choose an account', '/confirm-sign-in': 'Confirm sign-in', '/dashboard': 'Dashboard overview' };
    document.title = `Talk — ${path === '/meeting-history' ? 'Meetings' : path.startsWith('/meeting-history/') ? 'Meeting details' : titles[path] || 'Run online meetings and webinars like a pro'}`;
  }, [path]);
  useEffect(()=>{if(path==='/analytics')document.title='Talk — Analytics';},[path]);
  if(path==='/analytics')return <DashboardAccess><WorkspaceShell path={path}><Suspense fallback={<main className="auth-session-status" role="status">Loading analytics…</main>}><Analytics/></Suspense></WorkspaceShell></DashboardAccess>;
  if (path === '/meeting') return <MeetingRoom />;
  if (path === '/device-test' || path === '/test') return <DeviceTest />;
  if (path === '/sign-in' || path === '/sign-up') return <AuthTransition page={path === '/sign-up' ? 'signup' : 'signin'} />;
  if (path === '/verify-email') return <VerifyEmail />;
  if (path === '/forgot-password') return <ForgotPassword />;
  if (path === '/phone-sign-in' || path === '/verify-phone') return <Suspense fallback={<main className="auth-session-status" role="status">Loading phone sign-in...</main>}>{path === '/phone-sign-in' ? <PhoneSignIn /> : <VerifyPhone />}</Suspense>;
  if (path === '/choose-account') return <ChooseAccount />;
  if (path === '/confirm-sign-in') return <ConfirmSignIn />;
  if (path === '/dashboard') return <DashboardAccess><WorkspaceShell path={path}><Dashboard /></WorkspaceShell></DashboardAccess>;
  if (path === '/bookings') return <DashboardAccess><WorkspaceShell path={path}><Booking /></WorkspaceShell></DashboardAccess>;
  if (path === '/recordings') {
    const meetingId = new URLSearchParams(route.split('?')[1] || '').get('meeting');
    return <DashboardAccess><WorkspaceShell path={path}>{meetingId ? <MeetingHistory key={route} meetingId={meetingId} backHref="/recordings" backLabel="Back to recordings" /> : <Suspense fallback={<main className="auth-session-status" role="status">Loading recordings…</main>}><RecordingsWorkspace /></Suspense>}</WorkspaceShell></DashboardAccess>;
  }
  if (path === '/whiteboard') return <DashboardAccess><WorkspaceShell path={path}><Suspense fallback={<main className="auth-session-status" role="status">Loading whiteboards…</main>}><WhiteboardWorkspace meetingId={new URLSearchParams(route.split('?')[1] || '').get('meeting') || undefined} /></Suspense></WorkspaceShell></DashboardAccess>;
  if (path === '/booking-confirmation') return <PublicBooking key={route} confirmation />;
  if (/^\/booking\/[a-z0-9-]+\/[a-z0-9-]+$/.test(path)) return <PublicBooking key={path} />;
  if (path === '/meetings') return <DashboardAccess><WorkspaceShell path={path}><MeetingHistory /></WorkspaceShell></DashboardAccess>;
  if (path === '/meeting-history' || path.startsWith('/meeting-history/')) return <DashboardAccess><WorkspaceShell path={path}><MeetingHistory key={path} meetingId={path.split('/')[2]} /></WorkspaceShell></DashboardAccess>;
  return <Shell>{path === '/webinars' ? <Webinar /> : path === '/bookings' ? <Booking /> : path === '/' ? <Landing /> : <div className="page-width py-24 text-center"><h1>Page not found</h1><a href="/" className="primary-button mt-6">Back to Talk</a></div>}</Shell>;
}
