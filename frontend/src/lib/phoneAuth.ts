import { useCallback, useEffect, useRef, useState } from 'react';
import { RecaptchaVerifier, signInWithPhoneNumber, signOut, type ConfirmationResult, type User } from 'firebase/auth';
import { getPhoneFirebaseAuth, isFirebasePhoneConfigured, peekPhoneFirebaseAuth } from './firebase';
import type { AuthUser } from './auth';

export type PhoneIntent = 'signin' | 'link';
export type PhoneChallenge = { phoneNumber: string; intent: PhoneIntent; expiresAt: string; resendAt: string };
type PhoneFlow = { challenge: PhoneChallenge; csrfToken: string; serverOffset: number; confirmation: ConfirmationResult | null; verifiedUser: User | null; generation: number };
type PhoneResult = { user: AuthUser; csrfToken: string };
let flow: PhoneFlow | null = null;
let generation = 0;

export class PhoneAuthError extends Error {
  constructor(public code: string, message: string, public retryAt = 0) { super(message); this.name = 'PhoneAuthError'; }
}

export function phoneError(failure: unknown): PhoneAuthError {
  if (failure instanceof PhoneAuthError) return failure;
  const code = failure && typeof failure === 'object' && 'code' in failure && typeof failure.code === 'string' ? failure.code : '';
  const message = code === 'auth/invalid-verification-code' ? 'That code is incorrect. Please check the SMS and try again.'
    : ['auth/code-expired', 'auth/session-expired', 'auth/invalid-verification-id'].includes(code) ? 'This SMS code has expired. Request a new OTP.'
      : ['auth/too-many-requests', 'auth/quota-exceeded'].includes(code) ? 'Too many SMS requests. Please wait and try again later.'
        : code === 'auth/invalid-phone-number' ? 'Enter a valid mobile number with its country code.'
          : ['auth/captcha-check-failed', 'auth/invalid-app-credential', 'auth/missing-app-credential'].includes(code) ? 'The security check expired or could not be completed. Please try the reCAPTCHA again.'
            : ['auth/unauthorized-domain', 'auth/app-not-authorized'].includes(code) ? 'Phone verification is not allowed on this website address. Please contact Talk support.'
              : ['auth/operation-not-allowed', 'auth/billing-not-enabled', 'auth/invalid-api-key', 'auth/configuration-not-found'].includes(code) ? 'SMS sign-in is unavailable right now. Please use email or Google sign-in.'
                : ['auth/network-request-failed', 'auth/internal-error'].includes(code) ? 'Could not contact the SMS service. Check your connection and try again.'
                  : 'Phone verification could not be completed. Please try again.';
  return new PhoneAuthError(code || 'unavailable', message, code === 'auth/too-many-requests' ? Date.now() + 60000 : 0);
}

function validChallenge(value: unknown): value is PhoneChallenge {
  if (!value || typeof value !== 'object') return false;
  const item = value as PhoneChallenge;
  return /^\+[1-9]\d{7,14}$/.test(item.phoneNumber) && ['signin', 'link'].includes(item.intent) && Number.isFinite(Date.parse(item.expiresAt)) && Number.isFinite(Date.parse(item.resendAt));
}

async function request(path: string, signal: AbortSignal, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  let timedOut = false;
  const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 25000);
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) controller.abort();
  try {
    const response = await fetch(path, { ...init, credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
    let data: Record<string, unknown>;
    try { data = await response.json(); } catch { throw new PhoneAuthError('unavailable', 'Talk authentication is unavailable. Please try again.'); }
    if (!response.ok) {
      const code = typeof data.error === 'string' ? data.error : 'unavailable';
      const retryAfter = Number(data.retryAfter ?? response.headers.get('Retry-After'));
      const retryAt = Number.isFinite(retryAfter) && retryAfter > 0 ? Date.now() + Math.min(86400, retryAfter) * 1000 : 0;
      const message = code === 'resend_cooldown' ? 'Please wait before requesting another SMS.'
        : response.status === 429 ? 'Too many attempts. Please wait before trying again.'
          : ['challenge_expired', 'phone_challenge_expired', 'expired_challenge', 'expired_session'].includes(code) ? 'Your phone verification session expired. Change the number or request a new OTP.'
            : ['link_session_expired', 'recent_sign_in_required', 'reauthentication_required'].includes(code) ? 'Please sign in again before securely adding a phone number.'
              : response.status === 409 ? 'This phone number cannot be linked to this account. Use its existing sign-in method or change the number.'
                : response.status === 401 ? 'Your phone could not be verified. Request a new OTP and try again.'
                  : response.status >= 500 ? 'Phone authentication is unavailable right now. Please use email or Google sign-in.'
                    : typeof data.message === 'string' ? data.message : 'This phone verification request could not be completed.';
      throw new PhoneAuthError(code, message, retryAt);
    }
    return data;
  } catch (failure) {
    if (signal.aborted) throw new DOMException('Phone verification cancelled.', 'AbortError');
    if (failure instanceof PhoneAuthError) throw failure;
    throw new PhoneAuthError('connection', timedOut ? 'Talk took too long to respond. Please try again.' : 'Could not connect to Talk. Check your connection and try again.');
  } finally {
    window.clearTimeout(timeout); signal.removeEventListener('abort', cancel);
  }
}

function offset(serverTime: unknown) {
  const time = typeof serverTime === 'number' ? serverTime : typeof serverTime === 'string' ? Date.parse(serverTime) : NaN;
  return Number.isFinite(time) ? time - Date.now() : 0;
}

export async function readPhoneSetup(signal: AbortSignal) {
  const result = await request('/api/auth/phone/config', signal);
  return { configured: result.configured === true && isFirebasePhoneConfigured() };
}

export function getPhoneFlow() {
  if (!flow) return null;
  return { challenge: flow.challenge, serverOffset: flow.serverOffset, canVerify: Boolean(flow.confirmation), canRetry: Boolean(flow.verifiedUser) };
}

export async function readPhoneChallenge(signal: AbortSignal) {
  const data = await request('/api/auth/phone/challenge', signal);
  // The server can recover cooldown metadata after a refresh. Firebase's SMS
  // confirmation is deliberately memory-only, so a refresh requires a new SMS.
  return { challenge: validChallenge(data.challenge) ? data.challenge : null, serverOffset: offset(data.serverTime) };
}

export function createPhoneRecaptcha(container: HTMLElement, expired: () => void) {
  return new RecaptchaVerifier(getPhoneFirebaseAuth(), container, { size: 'normal', 'expired-callback': expired });
}

export function usePhoneRecaptcha(enabled: boolean) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const verifierRef = useRef<RecaptchaVerifier | null>(null);
  const [version, setVersion] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!enabled || !containerRef.current) return;
    let active = true;
    let verifier: RecaptchaVerifier | null = null;
    setReady(false); setError('');
    try {
      verifier = new RecaptchaVerifier(getPhoneFirebaseAuth(), containerRef.current, {
        size: 'normal',
        callback: () => { if (active) setError(''); },
        'expired-callback': () => { if (active) setError('The security check expired. Please complete reCAPTCHA again.'); },
      });
      verifierRef.current = verifier;
      void verifier.render().then(() => { if (active) setReady(true); }).catch(failure => {
        if (active) { setReady(false); setError(phoneError(failure).message); }
      });
    } catch (failure) { setError(phoneError(failure).message); }
    return () => {
      active = false;
      if (verifierRef.current === verifier) verifierRef.current = null;
      try { verifier?.clear(); } catch { /* A failed widget may already be cleared. */ }
    };
  }, [enabled, version]);
  return { containerRef, verifierRef, ready, error, reset: () => setVersion(value => value + 1) };
}

export async function sendPhoneCode(phoneNumber: string, intent: PhoneIntent, verifier: RecaptchaVerifier, signal: AbortSignal) {
  const context = await request(intent === 'link' ? '/api/auth/session' : '/api/auth/phone/config', signal);
  if (intent === 'signin' && context.configured !== true) throw new PhoneAuthError('not_configured', 'Phone sign-in is unavailable right now. Please use email or Google.');
  if (typeof context.csrfToken !== 'string' || !context.csrfToken) throw new PhoneAuthError('expired_session', 'Your session expired. Please return to sign in and try again.');
  const data = await request('/api/auth/phone/start', signal, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': context.csrfToken }, body: JSON.stringify({ phoneNumber, intent }) });
  if (!validChallenge(data.challenge) || typeof data.csrfToken !== 'string' || !data.csrfToken) throw new PhoneAuthError('unavailable', 'Talk could not start phone verification. Please try again.');
  const current = ++generation;
  flow = { challenge: data.challenge, csrfToken: data.csrfToken, serverOffset: offset(data.serverTime), confirmation: null, verifiedUser: null, generation: current };
  try {
    const confirmation = await signInWithPhoneNumber(getPhoneFirebaseAuth(), phoneNumber, verifier);
    if (signal.aborted || current !== generation || !flow) throw new DOMException('Phone verification cancelled.', 'AbortError');
    flow.confirmation = confirmation;
    return getPhoneFlow()!;
  } catch (failure) {
    if (signal.aborted || current !== generation) throw new DOMException('Phone verification cancelled.', 'AbortError');
    throw phoneError(failure);
  }
}

export async function verifyPhoneCode(code: string, signal: AbortSignal): Promise<PhoneResult> {
  const current = flow;
  if (!current || (!current.confirmation && !current.verifiedUser)) throw new PhoneAuthError('missing_confirmation', 'Request a new SMS before entering your code.');
  if (!current.verifiedUser) {
    try {
      const result = await current.confirmation!.confirm(code);
      if (signal.aborted || flow !== current || current.generation !== generation) {
        await signOut(getPhoneFirebaseAuth()).catch(() => {});
        throw new DOMException('Phone verification cancelled.', 'AbortError');
      }
      current.verifiedUser = result.user;
      current.confirmation = null;
    } catch (failure) {
      if (signal.aborted || flow !== current) throw new DOMException('Phone verification cancelled.', 'AbortError');
      throw phoneError(failure);
    }
  }
  if (signal.aborted) throw new DOMException('Phone verification cancelled.', 'AbortError');
  // Keep the verified Firebase user only in memory if Talk is temporarily
  // offline: retry the exchange, rather than consuming the SMS code twice.
  const idToken = await current.verifiedUser!.getIdToken(true);
  if (signal.aborted || flow !== current) throw new DOMException('Phone verification cancelled.', 'AbortError');
  const data = await request('/api/auth/phone/verify', signal, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': current.csrfToken }, body: JSON.stringify({ idToken }) });
  if (signal.aborted || flow !== current || current.generation !== generation) throw new DOMException('Phone verification cancelled.', 'AbortError');
  const user = data.user as AuthUser | undefined;
  if (!user || typeof user.id !== 'string' || typeof user.name !== 'string' || typeof user.email !== 'string' || typeof data.csrfToken !== 'string' || !data.csrfToken) throw new PhoneAuthError('unavailable', 'Talk could not finish signing you in. Please try again.');
  await clearPhoneAuth();
  return { user, csrfToken: data.csrfToken };
}

export async function cancelPhoneCode(signal: AbortSignal) {
  const context = await request('/api/auth/phone/challenge', signal);
  if (typeof context.csrfToken === 'string' && context.csrfToken) await request('/api/auth/phone/cancel', signal, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': context.csrfToken }, body: '{}' });
  await clearPhoneAuth();
}

export async function clearPhoneAuth() {
  ++generation; flow = null;
  const auth = peekPhoneFirebaseAuth();
  if (auth) await signOut(auth).catch(() => {});
}

// AuthProvider can discard an in-progress phone proof without importing the
// Firebase SDK on ordinary email/Google pages. Leaving both phone pages also
// drops the confirmation, so another visitor cannot resume it in this tab.
if (typeof window !== 'undefined') {
  const discard = () => { void clearPhoneAuth(); };
  window.addEventListener('talk:auth-session-changed', discard);
  window.addEventListener('talk:phone-auth-leave', discard);
  if (import.meta.hot) import.meta.hot.dispose(() => {
    window.removeEventListener('talk:auth-session-changed', discard);
    window.removeEventListener('talk:phone-auth-leave', discard);
    discard();
  });
}

export function usePhoneAuthRequest() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const [retryAt, setRetryAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const active = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const locked = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; controller.current?.abort(); }; }, []);
  useEffect(() => { if (!retryAt) return; const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, [retryAt]);
  const run = useCallback(async <T,>(operation: (signal: AbortSignal) => Promise<T>, allowCooldown = false): Promise<T | null> => {
    if (locked.current || (!allowCooldown && retryAt > Date.now())) return null;
    locked.current = true;
    const current = new AbortController(); controller.current = current;
    setPending(true); setError(''); setErrorCode('');
    try {
      const value = await operation(current.signal);
      return active.current && !current.signal.aborted ? value : null;
    } catch (failure) {
      if (active.current && !current.signal.aborted) {
        const issue = phoneError(failure); setError(issue.message); setErrorCode(issue.code);
        if (issue.retryAt) { setRetryAt(issue.retryAt); setNow(Date.now()); }
      }
      return null;
    } finally { locked.current = false; if (active.current && !current.signal.aborted) setPending(false); }
  }, [retryAt]);
  return { pending, error, errorCode, retrySeconds: Math.max(0, Math.ceil((retryAt - now) / 1000)), clearError: () => { setError(''); setErrorCode(''); }, run };
}
