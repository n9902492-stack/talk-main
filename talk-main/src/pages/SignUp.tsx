import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Eye, EyeOff, LoaderCircle, Smartphone, UserRoundPlus } from 'lucide-react';
import AuthLayout from '../components/AuthLayout';
import GoogleSignIn from '../components/GoogleSignIn';
import { navigateToDashboard, navigateToSignInConfirmation, useAuth } from '../lib/auth';
import { EmailAuthError, navigateToEmailVerification, signUpWithEmail, startPasswordLink, useEmailAuthRequest } from '../lib/emailAuth';
import { clearPendingPassword, stagePasswordForVerification } from '../lib/browserPasswords';

export default function SignUp() {
  const { user, status, requiresConfirmation, completeSignIn, signOut } = useAuth();
  const linking = new URLSearchParams(window.location.search).get('mode') === 'link';
  const eligibleForLink = linking && user?.provider === 'google' && !requiresConfirmation && !user.hasPassword;
  useEffect(() => { if (user && (requiresConfirmation || !linking)) { if (requiresConfirmation) navigateToSignInConfirmation(); else navigateToDashboard(); } }, [user, linking, requiresConfirmation]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const confirmationInput = useRef<HTMLInputElement>(null);
  const mismatch = confirmation.length > 0 && password !== confirmation;
  const { pending, error, errorCode, retrySeconds, clearError, run } = useEmailAuthRequest();
  useEffect(() => { if (eligibleForLink && user) { setName(user.name); setEmail(user.email); } }, [eligibleForLink, user]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) { nameInput.current?.setCustomValidity('Enter your full name.'); nameInput.current?.reportValidity(); return; }
    if (password !== confirmation) { confirmationInput.current?.setCustomValidity('Passwords must match.'); confirmationInput.current?.reportValidity(); return; }
    const submittedEmail = email;
    const submittedPassword = password;
    clearPendingPassword();
    const result = await run(async signal => {
      const response = eligibleForLink ? await startPasswordLink(submittedPassword, signal) : await signUpWithEmail(name, submittedEmail, submittedPassword, signal);
      if (!response.verification) throw new EmailAuthError('unavailable', 'Talk could not start verification. Please try again.');
      return response;
    });
    if (!result) return;
    stagePasswordForVerification(submittedEmail, submittedPassword, result, eligibleForLink ? 'link' : 'signup');
    setPassword(''); setConfirmation(''); setShowPassword(false); setShowConfirmation(false);
    navigateToEmailVerification();
  };

  return <AuthLayout page="signup" title={linking ? 'Add email sign-in.' : 'Create your account.'} description={linking ? 'Securely add a password to your Google account.' : 'A better way to meet starts with Talk.'} Icon={UserRoundPlus} footer={linking ? <a href="/dashboard">Back to dashboard<ArrowRight size={14} /></a> : <>Already have an account? <a href="/sign-in">Sign in<ArrowRight size={14} /></a></>}>
    {linking && !eligibleForLink ? <div className="signin-notice" role="status">{status === 'loading' ? 'Checking your account...' : user?.hasPassword ? 'Your account already supports email and password sign-in.' : <>Sign in with Google to securely add email sign-in. <a href="/sign-in">Sign in<ArrowRight size={14} /></a></>}</div> : <>
    {!linking && <><GoogleSignIn onAuthenticated={completeSignIn} /><a href="/phone-sign-in" className="secondary-button auth-phone-option"><Smartphone size={18} />Continue with Phone Number</a><div className="auth-preview-divider"><span>Or continue with email</span></div></>}
    {linking && <p className="auth-email-help auth-link-help">We will email a verification code to your Google account address. Your current Google sign-in will remain available.</p>}
    <form id="talk-signup-form" method="post" autoComplete="on" onSubmit={submit} aria-busy={pending}>
      <div className="signup-field"><label htmlFor="signup-name" className="field-label">Full name</label><input ref={nameInput} id="signup-name" name="name" className="form-input" placeholder="Enter your full name" autoComplete="name" required maxLength={80} readOnly={linking} disabled={pending} value={name} onChange={event => { setName(event.target.value); event.currentTarget.setCustomValidity(event.target.value.trim() ? '' : 'Enter your full name.'); clearError(); }} /></div>
      <div className="signup-field"><label htmlFor="signup-email" className="field-label">Email address</label><input id="signup-email" name="email" className="form-input" type="email" placeholder="you@company.com" autoComplete="username" required maxLength={254} readOnly={linking} disabled={pending} value={email} onChange={event => { setEmail(event.target.value); clearError(); }} /></div>
      <div className="signup-field">
        <label htmlFor="signup-password" className="field-label">Password</label>
        <div className="signin-password-input"><input id="signup-password" name="password" className="form-input" type={showPassword ? 'text' : 'password'} placeholder="Create a password" autoComplete="new-password" required minLength={8} maxLength={128} disabled={pending} aria-describedby="signup-password-hint" value={password} onChange={event => { const value = event.target.value; setPassword(value); confirmationInput.current?.setCustomValidity(confirmation && confirmation !== value ? 'Passwords must match.' : ''); clearError(); }} /><button type="button" className="signin-password-toggle" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} disabled={pending} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={19} /> : <Eye size={19} />}</button></div>
        <p className="signup-field-hint" id="signup-password-hint">Use 8–128 characters. A longer, unique password is best.</p>
      </div>
      <div className="signup-field">
        <label htmlFor="signup-confirmation" className="field-label">Confirm password</label>
        <div className="signin-password-input"><input ref={confirmationInput} id="signup-confirmation" name="passwordConfirmation" className="form-input" type={showConfirmation ? 'text' : 'password'} placeholder="Enter your password again" autoComplete="new-password" required maxLength={128} disabled={pending} aria-invalid={mismatch || undefined} aria-describedby={mismatch ? 'signup-confirmation-error' : undefined} value={confirmation} onChange={event => { const value = event.target.value; setConfirmation(value); event.currentTarget.setCustomValidity(value && value !== password ? 'Passwords must match.' : ''); clearError(); }} /><button type="button" className="signin-password-toggle" aria-label={showConfirmation ? 'Hide confirmation password' : 'Show confirmation password'} aria-pressed={showConfirmation} disabled={pending} onClick={() => setShowConfirmation(!showConfirmation)}>{showConfirmation ? <EyeOff size={19} /> : <Eye size={19} />}</button></div>
        {mismatch && <p className="signup-field-error" id="signup-confirmation-error" role="alert">Passwords do not match.</p>}
      </div>
      {error && <div className="auth-email-error" role="alert">{error}{retrySeconds > 0 && <span> Try again in {retrySeconds}s.</span>}</div>}
      {errorCode === 'email_delivery_failed' && <a href="/verify-email" className="signin-text-button auth-reauthenticate">Manage verification<ArrowRight size={14} /></a>}
      {errorCode === 'link_session_expired' && <button type="button" className="signin-text-button auth-reauthenticate" disabled={pending} onClick={() => void run(() => signOut(), { allowDuringCooldown: true })}>Sign out to reauthenticate with Google<ArrowRight size={14} /></button>}
      <button type="submit" className="primary-button signin-submit" disabled={pending || retrySeconds > 0}>{pending ? <><LoaderCircle size={18} className="auth-loading-icon" />Sending verification...</> : <>{linking ? 'Send verification code' : 'Sign Up'}<ArrowRight size={18} /></>}</button>
      {!linking && <p className="auth-email-help">Next, enter the 6-digit OTP sent to your email on the verification page. Your account will be signed in only after verification.</p>}
    </form>
    </>}
  </AuthLayout>;
}
