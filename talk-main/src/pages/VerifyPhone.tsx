import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, Clock3, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import AuthLayout from '../components/AuthLayout';
import OtpCodeInput from '../components/OtpCodeInput';
import { navigateToDashboard, useAuth } from '../lib/auth';
import { cancelPhoneCode, getPhoneFlow, readPhoneChallenge, sendPhoneCode, usePhoneAuthRequest, usePhoneRecaptcha, verifyPhoneCode, type PhoneChallenge } from '../lib/phoneAuth';
import { isPhoneTestMode } from '../lib/firebase';
import '../styles/phone-auth.css';

function navigate(path: string) {
  window.history.replaceState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export default function VerifyPhone() {
  const { completeSignIn } = useAuth();
  const initial = getPhoneFlow();
  const [challenge, setChallenge] = useState<PhoneChallenge | null>(initial?.challenge || null);
  const [serverOffset, setServerOffset] = useState(initial?.serverOffset || 0);
  const [loading, setLoading] = useState(!initial);
  const [loadError, setLoadError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [digits, setDigits] = useState<string[]>(Array(6).fill(''));
  const [verified, setVerified] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [notice, setNotice] = useState('');
  const [action, setAction] = useState<'verify' | 'resend' | 'change'>('verify');
  const { pending, error, errorCode, retrySeconds, clearError, run } = usePhoneAuthRequest();
  const captcha = usePhoneRecaptcha(Boolean(challenge) && !verified);

  useEffect(() => {
    const current = getPhoneFlow();
    if (current) { setChallenge(current.challenge); setServerOffset(current.serverOffset); setLoading(false); return; }
    const controller = new AbortController(); let active = true;
    setLoading(true); setLoadError('');
    void readPhoneChallenge(controller.signal).then(result => { if (active) { setChallenge(result.challenge); setServerOffset(result.serverOffset); setLoading(false); } }).catch(() => { if (active) { setLoadError('Could not load your phone verification. Please try again.'); setLoading(false); } });
    return () => { active = false; controller.abort(); };
  }, [loadAttempt]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { if (!verified) return; const timer = window.setTimeout(navigateToDashboard, 1200); return () => window.clearTimeout(timer); }, [verified]);

  const current = getPhoneFlow();
  const canVerify = current?.canVerify && current.challenge.phoneNumber === challenge?.phoneNumber;
  const canRetry = current?.canRetry && current.challenge.phoneNumber === challenge?.phoneNumber;
  const expires = challenge ? Math.max(0, Math.ceil((Date.parse(challenge.expiresAt) - now - serverOffset) / 1000)) : 0;
  const expired = !!challenge && expires === 0;
  const resendSeconds = Math.max(retrySeconds, challenge ? Math.max(0, Math.ceil((Date.parse(challenge.resendAt) - now - serverOffset) / 1000)) : 0);

  const verify = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!challenge || expired || (!canRetry && (!canVerify || !digits.every(value => /^\d$/.test(value))))) return;
    setAction('verify'); setNotice('');
    const result = await run(signal => verifyPhoneCode(digits.join(''), signal));
    if (result) {
      setDigits(Array(6).fill('')); setVerified(true);
      completeSignIn(result.user, result.csrfToken, false, { redirect: false });
    }
  };
  const resend = async () => {
    if (!challenge || !captcha.verifierRef.current || !captcha.ready || resendSeconds > 0) return;
    setAction('resend'); setNotice('');
    const result = await run(signal => sendPhoneCode(challenge.phoneNumber, challenge.intent, captcha.verifierRef.current!, signal));
    const updated = getPhoneFlow();
    if (updated) { setChallenge(updated.challenge); setServerOffset(updated.serverOffset); setNow(Date.now()); }
    setDigits(Array(6).fill(''));
    if (result) setNotice('A new SMS code has been sent. Use the latest code.');
    captcha.reset();
  };
  const changeNumber = async () => {
    setAction('change'); setNotice('');
    const result = await run(async signal => { await cancelPhoneCode(signal); return true; }, true);
    if (result) navigate(challenge?.intent === 'link' ? '/phone-sign-in?mode=link' : '/phone-sign-in');
  };

  return <AuthLayout page="verify" title="Verify your mobile." description={challenge?.intent === 'link' ? 'Confirm your phone to securely add phone sign-in.' : 'One last step before your Talk workspace.'} Icon={ShieldCheck} footer={<>Prefer email or Google? <a href="/sign-in">Sign in<ArrowRight size={14} /></a></>}>
    {verified ? <div className="auth-verification-success" role="status" aria-live="polite"><CheckCircle2 size={36} aria-hidden="true" /><h2>Phone Verified Successfully</h2><p>Taking you to your Talk dashboard...</p></div>
      : loading ? <div className="auth-verification-loading" role="status"><LoaderCircle size={18} className="auth-loading-icon" />Loading phone verification...</div>
        : loadError ? <><div className="auth-email-error" role="alert">{loadError}</div><button type="button" className="secondary-button auth-verification-retry" onClick={() => setLoadAttempt(value => value + 1)}><RefreshCw size={16} />Try again</button></>
          : !challenge ? <div className="signin-notice" role="status"><p>Request an SMS code to start phone verification.</p><a href="/phone-sign-in">Continue with Phone Number<ArrowRight size={14} /></a></div>
            : <>
              {isPhoneTestMode() && <div className="signin-notice" role="status">Firebase test phone numbers only. No SMS is sent.</div>}
              <p className="auth-verification-intro">Enter the 6-digit verification code sent to:</p>
              <p className="auth-verification-email">{challenge.phoneNumber}</p>
              {!canVerify && !canRetry && <div className="signin-notice" role="status">Your SMS verification could not be restored in this tab. Request a new OTP below after the cooldown.</div>}
              {canRetry && <div className="signin-notice" role="status">Your phone was verified. Retry completing your secure Talk sign-in.</div>}
              <form method="post" onSubmit={verify} aria-busy={pending}>
                <OtpCodeInput digits={digits} onChange={value => { setDigits(value); clearError(); setNotice(''); }} disabled={pending || expired || !canVerify || Boolean(canRetry)} invalid={errorCode === 'auth/invalid-verification-code'} />
                <p id="verification-expiry" className={`auth-verification-expiry${expired ? ' is-expired' : ''}`}><Clock3 size={14} />{expired ? 'Verification session expired. Request a new OTP.' : <>Complete verification in {Math.floor(expires / 60)}:{String(expires % 60).padStart(2, '0')}. SMS codes can expire sooner.</>}</p>
                {error && <div className="auth-email-error" role="alert">{error}{retrySeconds > 0 && <span> Try again in {retrySeconds}s.</span>}</div>}
                {notice && <div className="signin-notice" role="status" aria-live="polite">{notice}</div>}
                <button type="submit" className="primary-button signin-submit" disabled={pending || expired || (!canVerify && !canRetry) || retrySeconds > 0}>{pending && action === 'verify' ? <><LoaderCircle size={18} className="auth-loading-icon" />Verifying...</> : <>{canRetry ? 'Complete sign-in' : 'Verify OTP'}<ArrowRight size={18} /></>}</button>
              </form>
              <p className="auth-email-help phone-resend-help">Need another SMS? Complete the security check before resending.</p>
              <div className="phone-recaptcha" ref={captcha.containerRef} />
              {captcha.error && <p className="auth-email-help" role="status">{captcha.error} <button type="button" className="signin-text-button" disabled={pending} onClick={captcha.reset}>Reload security check</button></p>}
              <div className="auth-verification-actions">
                <button type="button" className="signin-text-button" disabled={pending || !captcha.ready || resendSeconds > 0} onClick={() => void resend()}>{pending && action === 'resend' ? <><LoaderCircle size={15} className="auth-loading-icon" />Sending OTP...</> : resendSeconds > 0 ? `Resend OTP in ${resendSeconds}s` : <><RefreshCw size={15} />Resend OTP</>}</button>
                <button type="button" className="signin-text-button" disabled={pending} onClick={() => void changeNumber()}><ArrowLeft size={14} />{pending && action === 'change' ? 'Please wait...' : 'Change Number'}</button>
              </div>
            </>}
  </AuthLayout>;
}
