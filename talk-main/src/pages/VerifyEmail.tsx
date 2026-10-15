import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, Clock3, LoaderCircle, MailCheck, RefreshCw } from 'lucide-react';
import AuthLayout from '../components/AuthLayout';
import OtpCodeInput from '../components/OtpCodeInput';
import { navigateToDashboard, useAuth } from '../lib/auth';
import { changeVerificationEmail, EmailAuthError, readEmailVerification, resendEmailCode, useEmailAuthRequest, verifyEmailCode, type VerificationDetails } from '../lib/emailAuth';
import { clearPendingPassword, saveVerifiedPassword } from '../lib/browserPasswords';

function navigate(path: string) {
  window.history.replaceState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export default function VerifyEmail() {
  const { completeSignIn, signOut } = useAuth();
  const [details, setDetails] = useState<VerificationDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [digits, setDigits] = useState<string[]>(Array(6).fill(''));
  const [verified, setVerified] = useState(false);
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(Date.now());
  const [clockOffset, setClockOffset] = useState(0);
  const [locked, setLocked] = useState(false);
  const [action, setAction] = useState<'verify' | 'resend' | 'change'>('verify');
  const { pending, error, errorCode, retrySeconds, clearError, run } = useEmailAuthRequest();

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true); setLoadError('');
    void readEmailVerification(controller.signal).then(state => {
      if (!active) return;
      setDetails(state.verification);
      if (!state.verification) clearPendingPassword();
      const serverTime = typeof state.serverTime === 'number' ? state.serverTime : Date.parse(state.serverTime || '');
      if (Number.isFinite(serverTime)) setClockOffset(serverTime - Date.now());
      setNow(Date.now()); setLoading(false);
    }).catch(failure => {
      if (!active) return;
      setLoading(false); setLoadError(failure instanceof EmailAuthError ? failure.message : 'Could not load verification. Please try again.');
    });
    return () => { active = false; controller.abort(); };
  }, [loadAttempt]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => { if (errorCode === 'attempt_limit') setLocked(true); }, [errorCode]);
  useEffect(() => {
    if (!verified) return;
    const timer = window.setTimeout(navigateToDashboard, 1200);
    return () => window.clearTimeout(timer);
  }, [verified]);

  const remaining = details ? Math.max(0, Math.ceil((Date.parse(details.expiresAt) - now - clockOffset) / 1000)) : 0;
  const resendSeconds = details ? Math.max(retrySeconds, Math.max(0, Math.ceil((Date.parse(details.resendAt) - now - clockOffset) / 1000))) : retrySeconds;
  const expired = !!details && remaining === 0;
  const deliveryFailed = details?.deliveryState === 'failed' || errorCode === 'email_delivery_failed';
  const deliverySending = details?.deliveryState === 'sending';
  const attemptLimit = locked || details?.attemptsRemaining === 0;
  const expiryTime = details ? new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(details.expiresAt)) : '';

  const verify = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!details || verified || expired || attemptLimit || deliveryFailed || deliverySending || !digits.every(digit => /^\d$/.test(digit))) return;
    setAction('verify'); setNotice('');
    const result = await run(async signal => {
      const response = await verifyEmailCode(digits.join(''), signal);
      if (!response.user || !response.csrfToken) throw new EmailAuthError('unavailable', 'Talk could not complete verification. Please try again.');
      return response;
    });
    if (result?.user && result.csrfToken) {
      saveVerifiedPassword(result.user, result.verifiedChallengeToken);
      completeSignIn(result.user, result.csrfToken, false, { redirect: false });
      setDigits(Array(6).fill('')); setVerified(true);
    }
  };
  const resend = async () => {
    if (!details || verified || resendSeconds > 0) return;
    setAction('resend'); setNotice('');
    const result = await run(async signal => {
      const response = await resendEmailCode(signal);
      if (!response.verification) throw new EmailAuthError('unavailable', 'Talk could not request a new code. Please try again.');
      return response;
    });
    if (result?.verification) {
      setDetails(result.verification); setDigits(Array(6).fill('')); setLocked(false); setNow(Date.now());
      setNotice(result.verification.deliveryState === 'failed' ? '' : 'A new code has been requested. Check your inbox and use the latest email.');
    }
  };
  const changeEmail = async () => {
    if (verified) return;
    setAction('change'); setNotice('');
    clearPendingPassword();
    const result = await run(signal => changeVerificationEmail(signal), { allowDuringCooldown: true });
    if (result) { setDigits(Array(6).fill('')); navigate(details?.purpose === 'link' ? '/dashboard' : '/sign-up'); }
  };

  return <AuthLayout page="verify" title="Verify Your Email" description={details?.purpose === 'link' ? 'Confirm your email to securely add password sign-in.' : 'One last step before your Talk workspace.'} Icon={MailCheck} footer={<>Already verified? <a href="/sign-in">Sign in<ArrowRight size={14} /></a></>}>
    {verified ? <div className="auth-verification-success" role="status" aria-live="polite"><CheckCircle2 size={36} aria-hidden="true" /><h2>Email Verified Successfully</h2><p>Taking you to your Talk dashboard...</p></div>
      : loading ? <div className="auth-verification-loading" role="status"><LoaderCircle size={18} className="auth-loading-icon" />Loading your verification...</div>
      : loadError ? <><div className="auth-email-error" role="alert">{loadError}</div><button type="button" className="secondary-button auth-verification-retry" onClick={() => setLoadAttempt(value => value + 1)}><RefreshCw size={16} />Try again</button></>
        : !details ? <div className="signin-notice" role="status"><p>Start signup or sign in with an unverified email account in this browser to receive a verification code.</p><a href="/sign-up">Back to Sign Up<ArrowRight size={14} /></a><a href="/sign-in">Resume with email<ArrowRight size={14} /></a></div>
          : <>
            <p className="auth-verification-intro">{deliveryFailed ? 'Request a new verification code for:' : deliverySending ? 'Your verification email is being prepared.' : "We've sent a 6-digit verification code to your email."}</p>
            <p className="auth-verification-email">{details.email}</p>
            <p className="auth-email-help auth-verification-help">{details.purpose === 'link' ? 'Enter the 6-digit OTP to add email and password sign-in.' : 'Enter the code below to finish creating your Talk account.'} Check spam or junk if it has not arrived. Each code is single-use and expires after 5 minutes.</p>
            {details.deliveryState === 'failed' && <div className="auth-email-error" role="alert">We could not deliver your verification email. Resend the code after the cooldown, or change your email.</div>}
            {deliverySending && <button type="button" className="signin-text-button auth-reauthenticate" disabled={pending} onClick={() => setLoadAttempt(value => value + 1)}>Check delivery status<RefreshCw size={14} /></button>}
            {details.attemptsRemaining === 0 && !locked && <div className="auth-email-error" role="alert">This code has reached its limit of 5 incorrect attempts. Request a new code after the cooldown.</div>}
            <form onSubmit={verify} aria-busy={pending}>
              <OtpCodeInput digits={digits} onChange={value => { setDigits(value); clearError(); setNotice(''); }} disabled={pending || expired || attemptLimit || deliveryFailed || deliverySending} invalid={errorCode === 'incorrect_code'} />
              <p id="verification-expiry" className={`auth-verification-expiry${expired ? ' is-expired' : ''}`} aria-live={expired ? 'polite' : 'off'}><Clock3 size={14} />{expired ? 'Code expired. Request a new code below.' : <>Expires in {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')} · {expiryTime}</>}</p>
              {error && <div className="auth-email-error" role="alert">{error}{retrySeconds > 0 && <span> Try again in {retrySeconds}s.</span>}</div>}
              {errorCode === 'link_session_expired' && <button type="button" className="signin-text-button auth-reauthenticate" disabled={pending} onClick={() => void run(() => signOut(), { allowDuringCooldown: true })}>Sign out to reauthenticate with Google<ArrowRight size={14} /></button>}
              {notice && <div className="signin-notice" role="status" aria-live="polite">{notice}</div>}
              <button type="submit" className="primary-button signin-submit" disabled={pending || expired || attemptLimit || deliveryFailed || deliverySending || retrySeconds > 0}>{pending && action === 'verify' ? <><LoaderCircle size={18} className="auth-loading-icon" />Verifying...</> : <>Verify Email<ArrowRight size={18} /></>}</button>
            </form>
            <div className="auth-verification-actions">
              <button type="button" className="signin-text-button" disabled={pending || resendSeconds > 0} onClick={() => void resend()}>{pending && action === 'resend' ? <><LoaderCircle size={15} className="auth-loading-icon" />Sending code...</> : resendSeconds > 0 ? `Resend OTP in ${resendSeconds}s` : <><RefreshCw size={15} />Resend OTP</>}</button>
              <a href={details.purpose === 'link' ? '/dashboard' : '/sign-up'} className="signin-text-button" aria-disabled={pending || undefined} onClick={event => { event.preventDefault(); if (!pending) void changeEmail(); }}><ArrowLeft size={14} />{pending && action === 'change' ? 'Please wait...' : details.purpose === 'link' ? 'Cancel linking' : 'Back to Sign Up'}</a>
            </div>
          </>}
  </AuthLayout>;
}
