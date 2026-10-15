import { lazy, Suspense, useEffect, useState } from 'react';
import Shell from './components/Shell';
import Landing from './pages/Landing';
import Webinar from './pages/Webinar';
import DeviceTest from './pages/DeviceTest';
import MeetingRoom from './pages/MeetingRoom';
import Booking from './pages/Booking';
import SignIn from './pages/SignIn';
import SignUp from './pages/SignUp';
import Dashboard from './pages/Dashboard';
import DashboardAccess from './components/DashboardAccess';
import VerifyEmail from './pages/VerifyEmail';
import ChooseAccount from './pages/ChooseAccount';
import ConfirmSignIn from './pages/ConfirmSignIn';
import { clearPendingPassword } from './lib/browserPasswords';

const PhoneSignIn = lazy(() => import('./pages/PhoneSignIn'));
const VerifyPhone = lazy(() => import('./pages/VerifyPhone'));

export default function AppRouter() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    if (window.location.pathname !== '/verify-email') clearPendingPassword();
    const leavePhone = () => { window.dispatchEvent(new Event('talk:phone-auth-leave')); };
    const update = () => {
      if (window.location.pathname !== '/verify-email') clearPendingPassword();
      if (!['/phone-sign-in', '/verify-phone'].includes(window.location.pathname)) leavePhone();
      setPath(window.location.pathname); window.scrollTo(0, 0);
    };
    const links = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');
      if (!anchor || anchor.target || anchor.hasAttribute('download')) return;
      const url = new URL(anchor.href);
      if (url.origin !== window.location.origin || !['/', '/webinars', '/device-test', '/test', '/meeting', '/bookings', '/sign-in', '/sign-up', '/verify-email', '/phone-sign-in', '/verify-phone', '/choose-account', '/confirm-sign-in', '/dashboard'].includes(url.pathname)) return;
      if (url.pathname === window.location.pathname && url.hash) return;
      event.preventDefault();
      window.history.pushState({}, '', url.pathname + url.search + url.hash);
      update();
      if (url.hash) requestAnimationFrame(() => document.querySelector(url.hash)?.scrollIntoView({ behavior: 'smooth' }));
    };
    window.addEventListener('popstate', update);
    window.addEventListener('pagehide', clearPendingPassword);
    window.addEventListener('pagehide', leavePhone);
    document.addEventListener('click', links);
    return () => { clearPendingPassword(); leavePhone(); window.removeEventListener('popstate', update); window.removeEventListener('pagehide', clearPendingPassword); window.removeEventListener('pagehide', leavePhone); document.removeEventListener('click', links); };
  }, []);
  useEffect(() => {
    const titles: Record<string, string> = { '/webinars': 'Webinars', '/device-test': 'Test your camera and microphone', '/meeting': 'Social Media Marketing Workshop', '/bookings': 'See Talk in action', '/sign-in': 'Sign in', '/sign-up': 'Sign up', '/verify-email': 'Verify your email', '/phone-sign-in': 'Continue with phone number', '/verify-phone': 'Verify your phone', '/choose-account': 'Choose an account', '/confirm-sign-in': 'Confirm sign-in', '/dashboard': 'Dashboard overview' };
    document.title = `Talk — ${titles[path] || 'Run online meetings and webinars like a pro'}`;
  }, [path]);
  if (path === '/meeting') return <MeetingRoom />;
  if (path === '/sign-in') return <SignIn />;
  if (path === '/sign-up') return <SignUp />;
  if (path === '/verify-email') return <VerifyEmail />;
  if (path === '/phone-sign-in' || path === '/verify-phone') return <Suspense fallback={<main className="auth-session-status" role="status">Loading phone sign-in...</main>}>{path === '/phone-sign-in' ? <PhoneSignIn /> : <VerifyPhone />}</Suspense>;
  if (path === '/choose-account') return <ChooseAccount />;
  if (path === '/confirm-sign-in') return <ConfirmSignIn />;
  if (path === '/dashboard') return <DashboardAccess><Dashboard /></DashboardAccess>;
  return <Shell>{path === '/webinars' ? <Webinar /> : path === '/device-test' || path === '/test' ? <DeviceTest /> : path === '/bookings' ? <Booking /> : path === '/' ? <Landing /> : <div className="page-width py-24 text-center"><h1>Page not found</h1><a href="/" className="primary-button mt-6">Back to Talk</a></div>}</Shell>;
}
