import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuthUser } from './auth';

export type VerificationDetails = {
  email: string;
  expiresAt: string;
  resendAt: string;
  purpose?: 'signup' | 'login' | 'link' | 'existing';
  deliveryState?: 'active' | 'sending' | 'failed';
  attemptsRemaining?: number;
};
export type VerificationState = { verification: VerificationDetails | null; csrfToken?: string; serverTime?: string | number };
export type EmailAuthResult = { user?: AuthUser; csrfToken?: string; verification?: VerificationDetails | null; message?: string; verifiedChallengeToken?: string };

export class EmailAuthError extends Error {
  constructor(public code: string, message: string, public retryAt = 0) { super(message); this.name = 'EmailAuthError'; }
}

async function request(path: string, signal: AbortSignal, init: RequestInit = {}, acceptPendingDeliveryFailure = false) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  let timedOut = false;
  const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 25000);
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) controller.abort();
  try {
    const response = await fetch(path, { ...init, credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
    let data: Record<string, unknown>;
    try { data = await response.json(); }
    catch { throw new EmailAuthError('unavailable', 'Talk authentication is unavailable right now. Please try again.'); }
    if (!response.ok) {
      const code = typeof data.error === 'string' ? data.error : 'unavailable';
      // The server created or rotated the browser-bound challenge, even though
      // delivery failed. Keep the recovery screen's expiry and cooldown current.
      const pendingVerification = verification(data.verification);
      if (acceptPendingDeliveryFailure && response.status === 503 && code === 'email_delivery_failed' && pendingVerification?.deliveryState === 'failed' && typeof data.csrfToken === 'string' && data.csrfToken) return data;
      const retryAfter = Number(data.retryAfter ?? response.headers.get('Retry-After'));
      const retryAt = Number.isFinite(retryAfter) && retryAfter > 0 ? Date.now() + Math.min(retryAfter, 86400) * 1000 : 0;
      // Authentication errors are deliberately generic. Unexpected service
      // details are never rendered into the account forms.
      const message = response.status === 401 && path === '/api/auth/email/login' ? 'The email or password could not be verified. Please try again.'
        : code === 'attempt_limit' ? 'This code has reached its limit of 5 incorrect attempts. Request a new code after the cooldown.'
          : code === 'resend_cooldown' ? 'Please wait before requesting another verification code.'
        : response.status === 429 ? 'Too many attempts. Please wait before trying again.'
          : response.status === 503 && code === 'email_delivery_failed' ? 'We could not send a verification email right now. Please try again shortly.'
            : response.status === 503 ? 'Email authentication is unavailable right now. Please try again later.'
            : response.status >= 500 ? 'Talk authentication is unavailable right now. Please try again.'
              : typeof data.message === 'string' ? data.message : 'This request could not be completed. Please try again.';
      throw new EmailAuthError(code, message, retryAt);
    }
    return data;
  } catch (error) {
    if (signal.aborted) throw new DOMException('Authentication cancelled.', 'AbortError');
    if (error instanceof EmailAuthError) throw error;
    throw new EmailAuthError('connection', timedOut ? 'This request took too long. Check your inbox before trying again.' : 'Could not connect to Talk. Check your connection and try again.');
  } finally {
    window.clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
  }
}

function verification(value: unknown): VerificationDetails | null {
  if (!value || typeof value !== 'object') return null;
  const details = value as VerificationDetails;
  return typeof details.email === 'string' && details.email.length <= 254 && Number.isFinite(Date.parse(details.expiresAt)) && Number.isFinite(Date.parse(details.resendAt)) ? details : null;
}

export async function readEmailVerification(signal: AbortSignal): Promise<VerificationState> {
  const data = await request('/api/auth/email/verification', signal);
  return { verification: verification(data.verification), csrfToken: typeof data.csrfToken === 'string' ? data.csrfToken : undefined, serverTime: typeof data.serverTime === 'string' || typeof data.serverTime === 'number' ? data.serverTime : undefined };
}

async function post(path: string, body: Record<string, unknown>, signal: AbortSignal, tokenSource: 'public' | 'verification' | 'session') {
  const source = tokenSource === 'verification' ? '/api/auth/email/verification' : tokenSource === 'session' ? '/api/auth/session' : '/api/auth/config';
  const context = await request(source, signal);
  if (typeof context.csrfToken !== 'string' || !context.csrfToken) throw new EmailAuthError('expired_session', tokenSource === 'session' ? 'Please sign in again to securely link email sign-in.' : 'Your verification session expired. Sign in with your email and password to request a new code.');
  const data = await request(path, signal, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': context.csrfToken }, body: JSON.stringify(body) }, ['/api/auth/email/signup', '/api/auth/email/link/start', '/api/auth/email/resend'].includes(path));
  const result = data as EmailAuthResult;
  if (data.verification !== undefined && data.verification !== null && !verification(data.verification)) throw new EmailAuthError('unavailable', 'Talk could not start verification. Please try again.');
  if (data.user !== undefined) {
    const profile = data.user as AuthUser;
    if (!profile || typeof profile.id !== 'string' || typeof profile.email !== 'string' || typeof profile.name !== 'string' || typeof data.csrfToken !== 'string' || !data.csrfToken) throw new EmailAuthError('unavailable', 'Talk could not finish signing you in. Please try again.');
  }
  // Bind optional browser password saving to the challenge actually used by
  // this successful verification request, including changes in another tab.
  return path === '/api/auth/email/verify' ? { ...result, verifiedChallengeToken: context.csrfToken } : result;
}

export const signUpWithEmail = (name: string, email: string, password: string, signal: AbortSignal) => post('/api/auth/email/signup', { name: name.trim(), email: email.trim(), password }, signal, 'public');
export const signInWithEmail = (email: string, password: string, signal: AbortSignal) => post('/api/auth/email/login', { email: email.trim(), password }, signal, 'public');
export const verifyEmailCode = (code: string, signal: AbortSignal) => post('/api/auth/email/verify', { code }, signal, 'verification');
export const resendEmailCode = (signal: AbortSignal) => post('/api/auth/email/resend', {}, signal, 'verification');
export const changeVerificationEmail = (signal: AbortSignal) => post('/api/auth/email/change', {}, signal, 'verification');
export const startPasswordLink = (password: string, signal: AbortSignal) => post('/api/auth/email/link/start', { password }, signal, 'session');

export function navigateToEmailVerification() {
  window.history.pushState({}, '', '/verify-email');
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function useEmailAuthRequest() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const [retryAt, setRetryAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const active = useRef(false);
  const current = useRef<AbortController | null>(null);
  const lock = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; current.current?.abort(); };
  }, []);
  useEffect(() => {
    if (retryAt <= Date.now()) return;
    setNow(Date.now());
    const timer = window.setInterval(() => { setNow(Date.now()); if (Date.now() >= retryAt) window.clearInterval(timer); }, 1000);
    return () => window.clearInterval(timer);
  }, [retryAt]);
  const run = useCallback(async <T,>(operation: (signal: AbortSignal) => Promise<T>, options?: { allowDuringCooldown: boolean }): Promise<T | null> => {
    if (lock.current || (!options?.allowDuringCooldown && retryAt > Date.now())) return null;
    lock.current = true;
    const controller = new AbortController();
    current.current = controller;
    setPending(true); setError(''); setErrorCode('');
    try {
      const result = await operation(controller.signal);
      return active.current && !controller.signal.aborted ? result : null;
    } catch (failure) {
      if (active.current && !controller.signal.aborted) {
        setError(failure instanceof EmailAuthError ? failure.message : 'This request could not be completed. Please try again.');
        setErrorCode(failure instanceof EmailAuthError ? failure.code : 'unavailable');
        if (failure instanceof EmailAuthError && failure.retryAt) { setRetryAt(failure.retryAt); setNow(Date.now()); }
      }
      return null;
    } finally {
      lock.current = false;
      if (active.current && !controller.signal.aborted) setPending(false);
    }
  }, [retryAt]);
  return { pending, error, errorCode, retrySeconds: Math.max(0, Math.ceil((retryAt - now) / 1000)), clearError: () => { setError(''); setErrorCode(''); }, run };
}
