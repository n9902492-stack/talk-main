import { ArrowLeft, type LucideIcon } from 'lucide-react';
import type { ReactNode, Ref } from 'react';
import HeroGlobe from './HeroGlobe';

type AuthLayoutProps = {
  page: 'signin' | 'signup' | 'verify';
  title: string;
  description: string;
  Icon: LucideIcon;
  children: ReactNode;
  footer: ReactNode;
  formOnly?: boolean;
};

export function AuthBranding({ page, panelRef, offerSignIn = false, reserveReturnSpace = false }: { page: string; panelRef?: Ref<HTMLElement>; offerSignIn?: boolean; reserveReturnSpace?: boolean }) {
  return <section ref={panelRef} className="signin-visual" aria-labelledby={`${page}-visual-heading`}>
      <div className="signin-cloud" aria-hidden="true" />
      <a href="/" className="signin-brand" aria-label="Talk home">Talk</a>
      <div className="signin-visual-copy">
        <span className="signin-eyebrow">YOUR SPACE. YOUR STAGE.</span>
        <h2 id={`${page}-visual-heading`}>Great conversations<br />start here.</h2>
        <p>Your meetings, webinars and workspaces.<br />All connected with Talk.</p>
      </div>
      <div className="signin-globe"><HeroGlobe /></div>
      <div className="signin-visual-proof">
        <div className="signin-proof-portraits" aria-hidden="true">
          {[5, 7, 14].map(index => <img key={index} src={`/assets/stitch/image-${String(index).padStart(2, '0')}.jpg`} alt="" />)}
        </div>
        <p>Join over 32,000 teams and creators.</p>
      </div>
      {(offerSignIn || reserveReturnSpace) && <div className="signin-visual-return" aria-hidden={!offerSignIn} inert={!offerSignIn}><a href="/sign-in" className="secondary-button">Sign in</a></div>}
    </section>;
}

export default function AuthLayout({ page, title, description, Icon, children, footer, formOnly = false }: AuthLayoutProps) {
  const form = <section className="signin-form-side" aria-labelledby={`${page}-heading`}>
      <div className="signin-form-nav">
        <a href="/" className="signin-mobile-brand" aria-label="Talk home">Talk</a>
        <a href="/" className="signin-back"><ArrowLeft size={16} />Back to Talk</a>
      </div>
      <div className="signin-card">
        <div className="signin-card-icon" aria-hidden="true"><Icon size={22} /></div>
        <h1 id={`${page}-heading`}>{title}</h1>
        <p className="signin-card-description">{description}</p>
        {children}
        <div className="signin-card-divider" />
        <p className="signin-new-account">{footer}</p>
      </div>
      <div className="signin-page-footer"><span>© 2026 Talk</span><a href="/#security">Privacy &amp; security</a></div>
    </section>;
  if (formOnly) return form;
  return <main className={`signin-page ${page === 'signup' ? 'signup-page' : ''}`}><AuthBranding page={page} />{form}</main>;
}
