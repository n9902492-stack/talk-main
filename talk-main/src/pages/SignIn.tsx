import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, Eye, EyeOff, LoaderCircle, LockKeyhole, Smartphone } from 'lucide-react';
import AuthLayout from '../components/AuthLayout';
import GoogleSignIn from '../components/GoogleSignIn';
import { navigateToDashboard, navigateToSignInConfirmation, useAuth } from '../lib/auth';
import { EmailAuthError, navigateToEmailVerification, signInWithEmail, useEmailAuthRequest } from '../lib/emailAuth';
import { clearPendingPassword, offerToSavePassword, stagePasswordForVerification } from '../lib/browserPasswords';

export default function SignIn() {
  const { user, requiresConfirmation, completeSignIn } = useAuth();
  useEffect(() => { if (user) { if (requiresConfirmation) navigateToSignInConfirmation(); else navigateToDashboard(); } }, [user, requiresConfirmation]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [notice, setNotice] = useState('');
  const { pending, error, errorCode, retrySeconds, clearError, run } = useEmailAuthRequest();

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setNotice('');
    const submittedEmail = email;
    const submittedPassword = password;
    clearPendingPassword();
    const result = await run(async signal => {
      const response = await signInWithEmail(submittedEmail, submittedPassword, signal);
      if (!response.verification && (!response.user || !response.csrfToken)) throw new EmailAuthError('unavailable', 'Talk could not finish signing you in. Please try again.');
      return response;
    });
    if (!result) return;
    if (result.verification) stagePasswordForVerification(submittedEmail, submittedPassword, result, 'login');
    else if (result.user) offerToSavePassword(submittedEmail, submittedPassword, result.user);
    setPassword(''); setShowPassword(false);
    if (result.verification) navigateToEmailVerification();
    else if (result.user && result.csrfToken) completeSignIn(result.user, result.csrfToken);
  };

  return <AuthLayout page="signin" title="Welcome back." description="Sign in to your Talk workspace." Icon={LockKeyhole} footer={<>New to Talk? <a href="/sign-up">Try it for free<ArrowRight size={14} /></a></>}>
        <GoogleSignIn onAuthenticated={completeSignIn} />
        <a href="/phone-sign-in" className="secondary-button auth-phone-option"><Smartphone size={18} />Continue with Phone Number</a>
        <div className="auth-preview-divider"><span>Or continue with email</span></div>
        <form id="talk-signin-form" method="post" autoComplete="on" onSubmit={submit} aria-busy={pending}>
          <label htmlFor="signin-email" className="field-label">Email address</label>
          <input id="signin-email" name="email" className="form-input" type="email" placeholder="you@company.com" autoComplete="username" required maxLength={254} disabled={pending} value={email} onChange={event => { setEmail(event.target.value); setNotice(''); clearError(); }} />

          <div className="signin-password-label">
            <label htmlFor="signin-password" className="field-label">Password</label>
            <button type="button" className="signin-text-button" disabled={pending} onClick={() => setNotice('Password reset is not available yet. If you originally used Google, continue with Google to access that account.')}>Forgot password?</button>
          </div>
          <div className="signin-password-input">
            <input id="signin-password" name="password" className="form-input" type={showPassword ? 'text' : 'password'} placeholder="Enter your password" autoComplete="current-password" required maxLength={128} disabled={pending} value={password} onChange={event => { setPassword(event.target.value); setNotice(''); clearError(); }} />
            <button type="button" className="signin-password-toggle" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} disabled={pending} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={19} /> : <Eye size={19} />}</button>
          </div>

          <p className="auth-email-help">Already received a code? <a href="/verify-email" className="signin-text-button">Enter verification code<ArrowRight size={14} /></a><br />Sign in with your email and password to request or resume verification.</p>
          {notice && <div className="signin-notice" role="status" aria-live="polite">{notice}</div>}
          {error && <div className="auth-email-error" role="alert">{error}{retrySeconds > 0 && <span> Try again in {retrySeconds}s.</span>}</div>}
          {errorCode === 'email_delivery_failed' && <a href="/verify-email" className="signin-text-button auth-reauthenticate">Manage verification<ArrowRight size={14} /></a>}
          <button type="submit" className="primary-button signin-submit" disabled={pending || retrySeconds > 0}>{pending ? <><LoaderCircle size={18} className="auth-loading-icon" />Signing in...</> : <>Sign in<ArrowRight size={18} /></>}</button>
          <a href="/sign-up" className="secondary-button signin-signup-button">Sign up<ArrowRight size={18} /></a>
        </form>
  </AuthLayout>;
}
