import { useEffect, type ReactNode } from 'react';
import { navigateToSignInConfirmation, useAuth } from '../lib/auth';

export default function DashboardAccess({ children }: { children: ReactNode }) {
  const { user, status, requiresConfirmation, refresh } = useAuth();
  useEffect(() => {
    if (status === 'ready' && user && requiresConfirmation) { navigateToSignInConfirmation(); return; }
    if (status === 'ready' && !user) {
      window.history.replaceState({}, '', '/sign-in');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  }, [user, status, requiresConfirmation]);
  if (status === 'loading') return <main className="auth-session-status" role="status">Checking your session…</main>;
  if (user && !requiresConfirmation) return <>{children}</>;
  if (status === 'error') return <main className="auth-session-status"><p role="alert">We couldn’t check your session.</p><button className="primary-button" onClick={() => void refresh()}>Try again</button><a href="/sign-in">Back to sign in</a></main>;
  return null;
}
