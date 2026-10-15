import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, LoaderCircle, ShieldCheck, UserRound } from 'lucide-react';
import GoogleSignIn from '../components/GoogleSignIn';
import { useAuth } from '../lib/auth';

export default function ChooseAccount() {
  const { user, status, completeSignIn, refresh, signOut } = useAuth();
  const [pictureFailed, setPictureFailed] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { setPictureFailed(false); }, [user?.picture]);
  const useEmail = async () => {
    setSigningOut(true); setError('');
    try { await signOut(); }
    catch { setError('Could not switch accounts. Please try again.'); }
    finally { setSigningOut(false); }
  };

  return <main className="account-chooser-page">
    <div className="account-chooser-shell">
      <a className="account-chooser-back" href="/"><ArrowLeft size={16} />Back to Talk</a>
      <section className="account-chooser-card" aria-labelledby="account-chooser-heading">
        <header className="account-chooser-header"><span>Talk account selection</span><span><ShieldCheck size={17} />Secure sign-in</span></header>
        <div className="account-chooser-body">
          <div className="account-chooser-intro">
            <a href="/" className="account-chooser-logo" aria-label="Talk home">Talk</a>
            <h1 id="account-chooser-heading">Choose an account</h1>
            <p>to continue to <strong>Talk</strong></p>
          </div>
          <div className="account-chooser-options">
            {status === 'loading' ? <p className="account-chooser-status" role="status"><LoaderCircle size={18} className="auth-loading-icon" />Checking your Talk account...</p>
              : user ? <a className="account-chooser-profile" href={user.provider === 'google' ? '/confirm-sign-in' : '/dashboard'} aria-label={`Continue as ${user.name || user.email}`}>
                <span className="account-chooser-avatar">{user.picture && !pictureFailed ? <img src={user.picture} alt="" referrerPolicy="no-referrer" onError={() => setPictureFailed(true)} /> : (user.name || user.email).slice(0, 1).toUpperCase()}</span>
                <span className="account-chooser-profile-copy"><strong>{user.name}</strong><span>{user.email || user.phoneNumber}</span><small>{user.provider === 'google' ? 'Review your account before continuing' : 'Continue with your Talk account'}</small></span>
                <ArrowRight size={19} />
              </a>
                : status === 'error' ? <div className="account-chooser-session-error"><p role="alert">We couldn’t check your current Talk account.</p><button className="signin-text-button" onClick={() => void refresh()}>Try again</button></div> : null}
            <div className="account-chooser-google">
              <h2><UserRound size={20} />{user ? 'Use another Google account' : 'Continue with Google'}</h2>
              <GoogleSignIn onAuthenticated={completeSignIn} showChooserLink={false} />
              <p className="account-chooser-google-help">Choose your Google account in the secure window that opens.</p>
            </div>
            <div className="account-chooser-email">{user ? <button type="button" disabled={signingOut} onClick={() => void useEmail()}>{signingOut ? 'Switching accounts...' : 'Sign in with email'}<ArrowRight size={16} /></button> : <a href="/sign-in">Sign in with email<ArrowRight size={16} /></a>}{!user && <a href="/sign-up">Create a Talk account<ArrowRight size={16} /></a>}</div>
            {error && <p className="auth-email-error" role="alert">{error}</p>}
            <p className="account-chooser-policy">You can review Talk’s <a href="/#security">privacy and security information</a> before continuing.</p>
          </div>
        </div>
      </section>
      <footer className="account-chooser-footer"><span>© 2026 Talk</span><a href="/#security">Privacy &amp; security</a></footer>
    </div>
  </main>;
}
