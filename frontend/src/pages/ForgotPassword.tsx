import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, KeyRound, LoaderCircle } from 'lucide-react';
import AuthLayout from '../components/AuthLayout';
import OtpCodeInput from '../components/OtpCodeInput';
import { passwordResetAction, readPasswordReset, useEmailAuthRequest, type PasswordResetState } from '../lib/emailAuth';

export default function ForgotPassword() {
  const [step, setStep] = useState<'request' | 'verify' | 'password' | 'done'>('request');
  const [email, setEmail] = useState('');
  const [state, setState] = useState<PasswordResetState | null>(null);
  const [digits, setDigits] = useState<string[]>(Array(6).fill(''));
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [clock, setClock] = useState(Date.now());
  const [offset, setOffset] = useState(0);
  const [loadError, setLoadError] = useState('');
  const { pending, error, errorCode, clearError, retrySeconds, run } = useEmailAuthRequest();

  const accept = (value: PasswordResetState) => {
    setState(value);
    setOffset(value.serverTime - Date.now());
    if (value.reset) {
      setEmail(value.reset.email);
      setStep(value.reset.verified && value.reset.expiresAt > value.serverTime ? 'password' : 'verify');
    }
  };
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void readPasswordReset(controller.signal)
      .then(value => { if (active) accept(value); })
      .catch(() => { if (active) setLoadError('Could not load password recovery. You can request a fresh code below.'); })
      .finally(() => { if (active) setLoading(false); });
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => { active = false; controller.abort(); window.clearInterval(timer); };
  }, []);

  const remaining = Math.max(0, Math.ceil(((state?.reset?.expiresAt || 0) - clock - offset) / 1000));
  const cooldown = Math.max(retrySeconds, Math.ceil(((state?.reset?.resendAt || 0) - clock - offset) / 1000));
  const locked = state?.reset?.attemptsRemaining === 0 || errorCode === 'attempt_limit';
  const mismatch = confirm.length > 0 && confirm !== password;

  async function submit(event: FormEvent) {
    event.preventDefault(); setNotice(''); setLoadError('');
    const result = await run(signal => passwordResetAction(
      step === 'request' ? 'request' : step === 'verify' ? 'verify' : 'complete',
      step === 'request' ? { email } : step === 'verify' ? { code: digits.join('') } : { password, confirmPassword: confirm }, signal,
    ), { allowDuringCooldown: step !== 'request' });
    if (!result) return;
    if (result.completed) {
      setPassword(''); setConfirm(''); setDigits(Array(6).fill('')); setStep('done'); setState(null);
      return;
    }
    accept(result); setDigits(Array(6).fill(''));
    if (step === 'request') setNotice('If this email has a verified Talk password account, we will email a code shortly. Check spam or junk too.');
  }
  async function resend() {
    const result = await run(signal => passwordResetAction('resend', {}, signal));
    if (result) {
      accept(result); setDigits(Array(6).fill('')); setPassword(''); setConfirm('');
      setNotice('If this account is eligible, a new code will arrive shortly. Only the latest code will work.');
    }
  }
  function changeEmail() {
    setStep('request'); setDigits(Array(6).fill('')); setPassword(''); setConfirm(''); setNotice(''); clearError();
  }

  return <AuthLayout page="verify"
    title={step === 'done' ? 'Password changed.' : step === 'password' ? 'Create a new password.' : step === 'verify' ? 'Check your email.' : 'Forgot your password?'}
    description={step === 'password' ? 'Choose a password for your Talk account.' : step === 'verify' ? 'Enter the six-digit password reset code.' : step === 'done' ? 'Your account is ready for a fresh start.' : 'We will help you securely get back to Talk.'}
    Icon={KeyRound} footer={<a href="/sign-in"><ArrowLeft size={14} />Back to sign in</a>}>
    {loading ? <p role="status">Loading password recovery...</p>
      : step === 'done' ? <div className="auth-verification-success" role="status">
        <CheckCircle2 size={36} aria-hidden="true" />
        <p>Your password was changed successfully. Existing sessions have been signed out.</p>
        <a href="/sign-in" className="primary-button signin-submit">Sign in with your new password<ArrowRight size={16} /></a>
      </div>
        : <form className="password-reset-form" onSubmit={submit} aria-busy={pending}>
          {step === 'request' ? <>
            <label className="field-label" htmlFor="reset-email">Email address</label>
            <input id="reset-email" className="form-input" type="email" name="email" autoComplete="username" maxLength={254} required autoFocus disabled={pending}
              value={email} onChange={e => { setEmail(e.target.value); clearError(); }} />
            <p className="auth-email-help">Use the email for your verified email/password account. If you signed up only with Google, continue with Google on the sign-in page.</p>
          </> : <>
            <p className="auth-verification-intro">Password recovery for:</p>
            <p className="auth-verification-email">{state?.reset?.email}</p>
            {step === 'verify' ? <>
              <OtpCodeInput digits={digits} onChange={next => { setDigits(next); clearError(); }} disabled={pending || remaining === 0 || locked} invalid={!!error} />
              <p id="verification-expiry" className="auth-verification-expiry">
                {remaining ? `Code expires in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}.` : 'This code has expired. Request a new code.'} Codes are single-use.
              </p>
            </> : <>
              <div className="form-field"><label className="field-label" htmlFor="reset-password">New password</label>
                <input id="reset-password" className="form-input" type="password" name="new-password" autoComplete="new-password" minLength={8} maxLength={128} required disabled={pending}
                  value={password} onChange={e => setPassword(e.target.value)} />
              </div>
              <div className="form-field"><label className="field-label" htmlFor="reset-confirm">Confirm new password</label>
                <input id="reset-confirm" className="form-input" type="password" name="confirm-password" autoComplete="new-password" minLength={8} maxLength={128} required disabled={pending}
                  value={confirm} onChange={e => setConfirm(e.target.value)} aria-invalid={mismatch || undefined} />
              </div>
              <p className="auth-email-help">8 to 128 characters. Your other sessions will be signed out.</p>
              {mismatch && <p className="auth-email-error">Passwords must match.</p>}
              {remaining === 0 && <p className="auth-email-error">This reset session expired. Request a new code.</p>}
            </>}
          </>}
          {(notice || loadError) && <p className="signin-notice" role="status">{notice || loadError}</p>}
          {error && <p className="auth-email-error" role="alert">{error}{retrySeconds > 0 && ` Try again in ${retrySeconds}s.`}</p>}
          <button className="primary-button signin-submit" type="submit" disabled={pending
            || step === 'request' && retrySeconds > 0
            || step === 'verify' && (!digits.every(d => /^\d$/.test(d)) || remaining === 0 || locked)
            || step === 'password' && (remaining === 0 || password !== confirm)}>
            {pending ? <><LoaderCircle size={18} className="auth-loading-icon" />Please wait...</> : step === 'request' ? 'Send reset code' : step === 'verify' ? 'Verify code' : 'Change password'}<ArrowRight size={17} />
          </button>
          {step !== 'request' && <div className="auth-verification-actions">
            <button className="signin-text-button" type="button" disabled={pending || cooldown > 0} onClick={() => void resend()}>{cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}</button>
            <button className="signin-text-button" type="button" disabled={pending} onClick={changeEmail}>Change email</button>
          </div>}
        </form>}
  </AuthLayout>;
}
