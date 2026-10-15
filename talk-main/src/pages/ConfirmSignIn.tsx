import { useEffect, useState } from 'react';
import { ArrowLeft, ChevronDown, LoaderCircle, Mail, ShieldCheck, UserRound } from 'lucide-react';
import { useAuth } from '../lib/auth';

export default function ConfirmSignIn() {
  const { user, status, refresh, confirmGoogleSignIn, cancelGoogleSignIn } = useAuth();
  const [pictureFailed, setPictureFailed] = useState(false);
  const [action, setAction] = useState<'continue' | 'cancel' | null>(null);
  const [error, setError] = useState('');

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { setPictureFailed(false); }, [user?.picture]);

  const googleUser = status === 'ready' && user?.provider === 'google' ? user : null;
  const displayName = googleUser?.name || 'Google account';
  const initial = (googleUser?.name || googleUser?.email || 'T').slice(0, 1).toUpperCase();

  const handleAction = async (nextAction: 'continue' | 'cancel') => {
    if (action) return;
    setAction(nextAction);
    setError('');
    try {
      if (nextAction === 'continue') await confirmGoogleSignIn();
      else await cancelGoogleSignIn();
    } catch {
      setError(nextAction === 'continue'
        ? 'We couldn’t complete your Talk sign-in. Please try again.'
        : 'We couldn’t cancel your Talk sign-in. Please try again.');
    } finally {
      setAction(null);
    }
  };

  return <main className="account-chooser-page signin-confirmation-page">
    <div className="account-chooser-shell">
      <a className="account-chooser-back" href="/"><ArrowLeft size={16} />Back to Talk</a>
      <section className="account-chooser-card signin-confirmation-card" aria-labelledby="signin-confirmation-heading" aria-busy={status === 'loading' || action !== null}>
        <header className="account-chooser-header"><span>Talk sign-in review</span><span><ShieldCheck size={17} />Secure sign-in</span></header>
        <div className="account-chooser-body signin-confirmation-body">
          <div className="account-chooser-intro signin-confirmation-intro">
            <a href="/" className="account-chooser-logo" aria-label="Talk home">Talk</a>
            <h1 id="signin-confirmation-heading">Sign in to Talk</h1>
            {googleUser ? <a className="signin-confirmation-account" href="/choose-account" aria-label={`Choose a different account. Current account: ${googleUser.email}`}>
              <span className="signin-confirmation-avatar">{googleUser.picture && !pictureFailed ? <img src={googleUser.picture} alt="" referrerPolicy="no-referrer" onError={() => setPictureFailed(true)} /> : initial}</span>
              <span>{googleUser.email}</span><ChevronDown size={16} />
            </a> : <p className="signin-confirmation-intro-copy">Continue securely with your Google account.</p>}
          </div>
          <div className="signin-confirmation-details">
            {status === 'loading' ? <p className="account-chooser-status" role="status"><LoaderCircle size={18} className="auth-loading-icon" />Checking your Talk account...</p>
              : status === 'error' ? <div className="signin-confirmation-empty">
                <h2>We couldn’t check your account.</h2>
                <p role="alert">Please try again before continuing to Talk.</p>
                <button type="button" className="signin-confirmation-button" onClick={() => void refresh()}>Try again</button>
              </div> : !googleUser ? <div className="signin-confirmation-empty">
                <h2>Choose your Google account</h2>
                <p>Sign in with Google to review the information shared with Talk. Your Google password stays with Google.</p>
                <a className="signin-confirmation-button signin-confirmation-primary" href="/choose-account">Continue with Google</a>
                <a className="signin-confirmation-email" href="/sign-in">Sign in with email instead</a>
              </div> : <>
                <h2>Review information shared with <strong>Talk</strong></h2>
                <p className="signin-confirmation-explanation">Google has securely shared your basic profile with Talk. Review it before opening your workspace.</p>
                <dl className="signin-confirmation-profile">
                  <div><UserRound size={24} aria-hidden="true" /><div><dt>{displayName}</dt><dd>Name and profile picture</dd></div></div>
                  <div><Mail size={24} aria-hidden="true" /><div><dt>{googleUser.email}</dt><dd>Email address</dd></div></div>
                </dl>
                <div className="signin-confirmation-policy">
                  <p>Review Talk’s <a href="/#security">privacy and security information</a> to learn how your account is protected.</p>
                  <p>You can manage your connection to Talk in your <a href="https://myaccount.google.com/connections" target="_blank" rel="noopener noreferrer">Google Account</a>.</p>
                  <p>Learn more about <a href="https://support.google.com/accounts/answer/12849458" target="_blank" rel="noopener noreferrer">Sign in with Google</a>.</p>
                </div>
                {error && <p className="signin-confirmation-error" role="alert">{error}</p>}
                <div className="signin-confirmation-actions">
                  <button type="button" className="signin-confirmation-button" disabled={action !== null} onClick={() => void handleAction('cancel')}>{action === 'cancel' && <LoaderCircle size={17} className="auth-loading-icon" />}{action === 'cancel' ? 'Cancelling...' : 'Cancel'}</button>
                  <button type="button" className="signin-confirmation-button signin-confirmation-primary" disabled={action !== null} onClick={() => void handleAction('continue')}>{action === 'continue' && <LoaderCircle size={17} className="auth-loading-icon" />}{action === 'continue' ? 'Continuing...' : 'Continue'}</button>
                </div>
                <p className="signin-confirmation-cancel-help">Cancel signs you out of Talk.</p>
              </>}
          </div>
        </div>
      </section>
      <footer className="account-chooser-footer"><span>© 2026 Talk</span><a href="/#security">Privacy &amp; security</a></footer>
    </div>
  </main>;
}
