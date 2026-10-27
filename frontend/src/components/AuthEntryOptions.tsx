import type { ReactNode } from 'react';
import '../styles/auth-entry-options.css';

/** Presentation only: the original forms and Google SDK control own sign-in. */
export default function AuthEntryOptions({ children, google, phone }: { children: ReactNode; google?: ReactNode; phone?: ReactNode }) {
  return <div className={`auth-entry-layout${google ? ' has-provider' : ''}`}>
    {google && <>
      <aside className="auth-entry-providers" aria-label="Google sign-in">
        {google}
      </aside>
      <div className="auth-entry-or" aria-hidden="true"><span>OR</span></div>
    </>}
    <div className="auth-entry-fields">{phone && <div className="auth-entry-phone">{phone}</div>}{children}</div>
  </div>;
}
