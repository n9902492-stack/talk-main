import { useEffect, useRef, useState } from 'react';
import { activateGoogleIdentity, loadGoogleIdentity } from '../lib/googleIdentity';

export type GoogleAuthUser = { id: string; name: string; email: string; picture?: string };

type GoogleSignInProps = {
  onAuthenticated: (user: GoogleAuthUser, csrfToken: string, requiresConfirmation?: boolean) => void;
  showChooserLink?: boolean;
};

type GoogleConfig = { configured: boolean; clientId?: string; csrfToken?: string; nonce?: string };
type Status = 'loading' | 'unconfigured' | 'ready' | 'verifying' | 'error';

async function requestAuth(path: string, options: RequestInit, parentSignal: AbortSignal) {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 15000);
  parentSignal.addEventListener('abort', abort, { once: true });
  if (parentSignal.aborted) controller.abort();
  try {
    return await fetch(path, { ...options, credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
  } catch {
    if (parentSignal.aborted) throw new DOMException('Sign-in cancelled.', 'AbortError');
    throw new Error(timedOut ? 'Google sign-in took too long to respond. Please try again.' : 'Could not connect to Google sign-in. Check your connection and try again.');
  } finally {
    window.clearTimeout(timeout);
    parentSignal.removeEventListener('abort', abort);
  }
}

function GoogleLogo() {
  return <svg aria-hidden="true" width="20" height="20" viewBox="0 0 48 48">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6C44.4 38.04 46.98 31.88 46.98 24.55Z" />
    <path fill="#FBBC05" d="M10.53 28.59A14.41 14.41 0 0 1 9.75 24c0-1.59.27-3.13.78-4.59l-7.98-6.19A23.87 23.87 0 0 0 0 24c0 3.87.93 7.53 2.56 10.78l7.97-6.19Z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.8l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z" />
  </svg>;
}

function validUser(value: unknown): value is GoogleAuthUser {
  if (!value || typeof value !== 'object') return false;
  const user = value as GoogleAuthUser;
  return typeof user.id === 'string' && !!user.id && typeof user.email === 'string' && !!user.email && typeof user.name === 'string'
    && (user.picture === undefined || typeof user.picture === 'string');
}

export default function GoogleSignIn({ onAuthenticated, showChooserLink = true }: GoogleSignInProps) {
  const [status, setStatus] = useState<Status>('loading');
  const [message, setMessage] = useState('Loading secure Google sign-in…');
  const [attempt, setAttempt] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const onSuccess = useRef(onAuthenticated);
  onSuccess.current = onAuthenticated;

  useEffect(() => {
    let active = true;
    let verifying = false;
    let disposeIdentity: (() => void) | undefined;
    let observer: ResizeObserver | undefined;
    const controller = new AbortController();
    const fail = (text: string) => {
      if (!active) return;
      disposeIdentity?.();
      observer?.disconnect();
      setMessage(text);
      setStatus('error');
    };
    setStatus('loading');
    setMessage('Loading secure Google sign-in…');

    const start = async () => {
      try {
        const response = await requestAuth('/api/auth/config', {}, controller.signal);
        if (!response.ok) throw new Error('Google sign-in is unavailable right now. Please try again.');
        const config = await response.json() as GoogleConfig;
        if (!active) return;
        if (!config.configured) {
          setStatus('unconfigured');
          setMessage('Google sign-in setup is required.');
          return;
        }
        if (!config.clientId || !config.csrfToken || !config.nonce) throw new Error('Google sign-in is unavailable right now. Please try again.');
        await loadGoogleIdentity();
        if (!active || !host.current || !root.current) return;

        const identity = activateGoogleIdentity(config.clientId, config.nonce, async credential => {
          if (!active || verifying) return;
          verifying = true;
          setStatus('verifying');
          setMessage('Signing you in securely…');
          try {
            // The ID token goes directly to our server for verification. It is never saved or decoded in the browser.
            const result = await requestAuth('/api/auth/google', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': config.csrfToken! },
              body: JSON.stringify({ credential }),
            }, controller.signal);
            if (!active) return;
            if (!result.ok) {
              const error = result.status === 403 ? 'Your sign-in session expired. Please retry Google sign-in.'
                : result.status === 401 ? 'Google sign-in could not be verified. Please try again.'
                  : result.status === 429 ? 'Too many sign-in attempts. Please wait a moment and retry.'
                    : 'Google sign-in is unavailable right now. Please try again.';
              throw new Error(error);
            }
            const data = await result.json() as { user?: unknown; csrfToken?: unknown; requiresConfirmation?: boolean };
            if (!validUser(data.user) || typeof data.csrfToken !== 'string' || !data.csrfToken) throw new Error('Google sign-in could not be verified. Please try again.');
            if (!active) return;
            onSuccess.current(data.user, data.csrfToken, data.requiresConfirmation !== false);
          } catch (error) {
            if (!active || controller.signal.aborted) return;
            fail(error instanceof Error && !(error instanceof SyntaxError) ? error.message : 'Google sign-in could not finish. Please try again.');
          }
        });
        disposeIdentity = identity.dispose;
        let renderedWidth = 0;
        const render = () => {
          if (!active || verifying || !root.current || !host.current) return false;
          const width = Math.min(400, Math.floor(root.current.getBoundingClientRect().width));
          if (width > 0 && width !== renderedWidth) {
            try {
              identity.render(host.current, width);
              renderedWidth = width;
            } catch {
              fail('Google sign-in could not display. Please try again.');
              return false;
            }
          }
          return true;
        };
        if (!render()) return;
        observer = new ResizeObserver(render);
        observer.observe(root.current);
        setStatus('ready');
        setMessage('Use your Google account to continue to Talk.');
      } catch (error) {
        if (!active || controller.signal.aborted) return;
        fail(error instanceof Error && !(error instanceof SyntaxError) ? error.message : 'Google sign-in could not load. Please try again.');
      }
    };
    void start();
    return () => {
      active = false;
      controller.abort();
      observer?.disconnect();
      disposeIdentity?.();
    };
  }, [attempt]);

  useEffect(() => { if (host.current) host.current.inert = status === 'verifying'; }, [status]);

  const actualButton = status === 'ready' || status === 'verifying';
  return <div className="google-signin" ref={root} aria-busy={status === 'loading' || status === 'verifying'}>
    <div className={`google-signin-host${status === 'verifying' ? ' is-verifying' : ''}`} ref={host} hidden={!actualButton} />
    {!actualButton && <button type="button" className="google-signin-placeholder" disabled><GoogleLogo /><span>Continue with Google</span></button>}
    <p className={`google-signin-status${status === 'error' ? ' is-error' : ''}`} role={status === 'error' ? 'alert' : 'status'} aria-live="polite">{message}</p>
    {(status === 'error' || status === 'unconfigured') && <button type="button" className="google-signin-retry" onClick={() => setAttempt(value => value + 1)}>Retry Google sign-in</button>}
    {showChooserLink && <a href="/choose-account" className="google-account-chooser-link">Choose an account</a>}
  </div>;
}
