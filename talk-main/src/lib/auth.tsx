import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { disableGoogleAutoSelect } from './googleIdentity';
import { clearPendingPassword } from './browserPasswords';

export type AuthUser = { id: string; name: string; email: string; picture?: string; provider?: 'google' | 'email' | 'phone'; hasPassword?: boolean; emailVerified?: boolean; phoneNumber?: string; hasPhone?: boolean };
type AuthState = {
  user: AuthUser | null;
  status: 'loading' | 'ready' | 'error';
  requiresConfirmation: boolean;
  completeSignIn: (user: AuthUser, csrfToken: string, requiresConfirmation?: boolean, options?: { redirect?: boolean }) => void;
  confirmGoogleSignIn: () => Promise<void>;
  cancelGoogleSignIn: () => Promise<void>;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};
const AuthContext = createContext<AuthState | null>(null);

export function navigateToDashboard() {
  window.history.replaceState({}, '', '/dashboard');
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function navigateToSignInConfirmation() {
  window.history.replaceState({}, '', '/confirm-sign-in');
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [requiresConfirmation, setRequiresConfirmation] = useState(false);
  const csrf = useRef('');
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setStatus('loading');
    try {
      const response = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error('Session unavailable');
      const data = await response.json();
      if (request !== generation.current) return;
      setUser(data.user || null);
      setRequiresConfirmation(Boolean(data.user && data.requiresConfirmation === true));
      csrf.current = data.csrfToken || '';
      setStatus('ready');
    } catch {
      if (request === generation.current) { setUser(null); setRequiresConfirmation(false); csrf.current = ''; setStatus('error'); }
    }
  }, []);
  useEffect(() => { void refresh(); return () => { ++generation.current; }; }, [refresh]);
  const completeSignIn = useCallback((verifiedUser: AuthUser, csrfToken: string, needsConfirmation = false, options?: { redirect?: boolean }) => {
    clearPendingPassword();
    window.dispatchEvent(new Event('talk:auth-session-changed'));
    // The credentials have already been verified by our server. Only the
    // returned display profile lives in React; credentials never enter Talk's storage.
    ++generation.current;
    csrf.current = csrfToken;
    setUser(verifiedUser); setRequiresConfirmation(needsConfirmation); setStatus('ready');
    try { sessionStorage.removeItem('talk-dashboard-preview'); } catch { /* Optional preview storage. */ }
    if (options?.redirect !== false) {
      if (needsConfirmation) navigateToSignInConfirmation();
      else navigateToDashboard();
    }
  }, []);
  const confirmGoogleSignIn = useCallback(async () => {
    const request = generation.current;
    const response = await fetch('/api/auth/google/confirm', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf.current }, body: '{}',
    });
    if (!response.ok) throw new Error('Could not continue with this account. Please try again.');
    const data = await response.json();
    if (request !== generation.current) throw new Error('Your session changed. Please review the account again.');
    if (!data.user || typeof data.user.id !== 'string' || typeof data.csrfToken !== 'string' || data.requiresConfirmation !== false) throw new Error('Could not confirm your account. Please try again.');
    ++generation.current; csrf.current = data.csrfToken;
    window.dispatchEvent(new Event('talk:auth-session-changed'));
    setUser(data.user); setRequiresConfirmation(false); setStatus('ready');
    navigateToDashboard();
  }, []);
  const signOut = useCallback(async () => {
    clearPendingPassword();
    window.dispatchEvent(new Event('talk:auth-session-changed'));
    const request = generation.current;
    const response = await fetch('/api/auth/logout', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf.current }, body: '{}',
    });
    if (!response.ok) {
      // An already expired server session is signed out. A CSRF rejection for
      // a live session must not be disguised as a successful logout.
      if (response.status !== 403) throw new Error('Could not sign out. Please try again.');
      const current = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' });
      if (!current.ok || (await current.json()).user) throw new Error('Could not sign out. Please try again.');
    }
    if (request !== generation.current) throw new Error('Your session changed. Please try again.');
    disableGoogleAutoSelect();
    ++generation.current; csrf.current = ''; setUser(null); setRequiresConfirmation(false); setStatus('ready');
    try { sessionStorage.removeItem('talk-dashboard-preview'); } catch { /* Optional preview storage. */ }
    window.history.replaceState({}, '', '/sign-in');
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, []);
  const cancelGoogleSignIn = useCallback(async () => {
    await signOut();
    window.history.replaceState({}, '', '/choose-account');
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, [signOut]);
  return <AuthContext.Provider value={{ user, status, requiresConfirmation, completeSignIn, confirmGoogleSignIn, cancelGoogleSignIn, refresh, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('AuthProvider is required.');
  return auth;
}
