import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, LoaderCircle, Phone, RefreshCw } from 'lucide-react';
import AuthLayout from '../components/AuthLayout';
import { navigateToDashboard, navigateToSignInConfirmation, useAuth } from '../lib/auth';
import { getPhoneFlow, readPhoneSetup, sendPhoneCode, usePhoneAuthRequest, usePhoneRecaptcha } from '../lib/phoneAuth';
import { isPhoneTestMode } from '../lib/firebase';
import '../styles/phone-auth.css';

function navigateToVerification() {
  window.history.pushState({}, '', '/verify-phone');
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export default function PhoneSignIn() {
  const { user, status, requiresConfirmation } = useAuth();
  const linking = new URLSearchParams(window.location.search).get('mode') === 'link';
  const [countryCode, setCountryCode] = useState('+91');
  const [mobile, setMobile] = useState('');
  const [consent, setConsent] = useState(false);
  const [setup, setSetup] = useState<'loading' | 'ready' | 'unavailable' | 'error'>('loading');
  const [setupAttempt, setSetupAttempt] = useState(0);
  const [validation, setValidation] = useState('');
  const [now, setNow] = useState(Date.now());
  const { pending, error, retrySeconds, clearError, run } = usePhoneAuthRequest();
  const captcha = usePhoneRecaptcha(setup === 'ready');

  useEffect(() => {
    if (status !== 'ready' || !user) return;
    if (requiresConfirmation) navigateToSignInConfirmation();
    else if (!linking || user.hasPhone) navigateToDashboard();
  }, [user, status, requiresConfirmation, linking]);
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    setSetup('loading');
    void readPhoneSetup(controller.signal).then(result => { if (active) setSetup(result.configured ? 'ready' : 'unavailable'); }).catch(() => { if (active) setSetup('error'); });
    return () => { active = false; controller.abort(); };
  }, [setupAttempt]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);

  const current = getPhoneFlow();
  const resendSeconds = Math.max(retrySeconds, current ? Math.max(0, Math.ceil((Date.parse(current.challenge.resendAt) - now - current.serverOffset) / 1000)) : 0);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setValidation('');
    const prefix = countryCode.replace(/\s/g, '');
    const national = mobile.replace(/[\s()-]/g, '');
    if (!/^\+[1-9]\d{0,3}$/.test(prefix) || !/^\d+$/.test(national) || !/^\+[1-9]\d{7,14}$/.test(prefix + national) || (prefix === '+91' && !/^[6-9]\d{9}$/.test(national))) {
      setValidation('Enter a valid mobile number and country code. For India, enter a 10-digit mobile number.'); return;
    }
    if (!consent) { setValidation('Please agree to receive a verification SMS to continue.'); return; }
    if (!captcha.verifierRef.current || !captcha.ready) { setValidation('Please wait for the security check to load.'); return; }
    const result = await run(signal => sendPhoneCode(prefix + national, linking ? 'link' : 'signin', captcha.verifierRef.current!, signal));
    if (result) navigateToVerification();
    else captcha.reset();
  };

  return <AuthLayout page="signin" title={linking ? 'Add your phone number.' : 'Continue with phone.'} description={linking ? 'Verify a mobile number to securely add phone sign-in.' : 'Sign in or create your Talk account with an SMS code.'} Icon={Phone} footer={<>Prefer another way? <a href={linking ? '/dashboard' : '/sign-in'}>{linking ? 'Back to dashboard' : 'Sign in'}<ArrowRight size={14} /></a></>}>
    {linking && !user && status !== 'loading' ? <div className="signin-notice" role="status">Sign in to your Talk account before adding a mobile number. <a href="/sign-in">Sign in<ArrowRight size={14} /></a></div>
      : <>
        {isPhoneTestMode() && <div className="signin-notice" role="status">Firebase test phone numbers only. No SMS is sent.</div>}
        {setup === 'loading' && <div className="auth-verification-loading" role="status"><LoaderCircle size={18} className="auth-loading-icon" />Loading phone sign-in...</div>}
        {setup === 'unavailable' && <div className="auth-email-error" role="alert">Phone sign-in is unavailable right now. You can still <a href="/sign-in">continue with email or Google</a>.</div>}
        {setup === 'error' && <><div className="auth-email-error" role="alert">Could not connect to Talk. Check your connection and try again.</div><button type="button" className="secondary-button auth-verification-retry" onClick={() => setSetupAttempt(value => value + 1)}><RefreshCw size={16} />Try again</button></>}
        <form method="post" onSubmit={submit} aria-busy={pending}>
          <label htmlFor="phone-number" className="field-label">Mobile number</label>
          <div className="phone-number-fields">
            <input className="form-input phone-country-code" aria-label="Country code" name="countryCode" type="tel" autoComplete="tel-country-code" placeholder="+91" required maxLength={5} disabled={pending || setup !== 'ready'} value={countryCode} onChange={event => { setCountryCode(event.target.value); setValidation(''); clearError(); }} />
            <input id="phone-number" className="form-input" name="mobileNumber" type="tel" inputMode="tel" autoComplete="tel-national" placeholder="Enter mobile number" required maxLength={20} disabled={pending || setup !== 'ready'} value={mobile} onChange={event => { setMobile(event.target.value); setValidation(''); clearError(); }} />
          </div>
          <p className="auth-email-help phone-number-help">We will send a 6-digit verification code by SMS. No password needed.</p>
          <label className="phone-sms-consent"><input type="checkbox" checked={consent} required disabled={pending || setup !== 'ready'} onChange={event => setConsent(event.target.checked)} /><span>I agree to receive a verification SMS. Standard SMS rates may apply. My phone number will be sent to and stored by Google for spam and abuse prevention.</span></label>
          <div className="phone-recaptcha" ref={captcha.containerRef} />
          {captcha.error && <p className="auth-email-help" role="status">{captcha.error} <button type="button" className="signin-text-button" disabled={pending} onClick={captcha.reset}>Reload security check</button></p>}
          {(validation || error) && <div className="auth-email-error" role="alert">{validation || error}{retrySeconds > 0 && <span> Try again in {retrySeconds}s.</span>}</div>}
          <button type="submit" className="primary-button signin-submit" disabled={pending || setup !== 'ready' || !captcha.ready || resendSeconds > 0 || status === 'loading'}>{pending ? <><LoaderCircle size={18} className="auth-loading-icon" />Sending OTP...</> : resendSeconds > 0 ? `Send OTP in ${resendSeconds}s` : <>Send OTP<ArrowRight size={18} /></>}</button>
        </form>
      </>}
  </AuthLayout>;
}
