import { useLayoutEffect, useRef, useState } from 'react';
import { AuthBranding } from './AuthLayout';
import { AuthDrafts } from './AuthDrafts';
import SignIn from '../pages/SignIn';
import SignUp from '../pages/SignUp';
import '../styles/auth-transition.css';
import '../styles/auth-viewport.css';

const DURATION = 840;
type AuthPage = 'signin' | 'signup';

/** Only the form changes; this shell and its single Earth scene stay mounted. */
export default function AuthTransition({ page }: { page: AuthPage }) {
  const shell = useRef<HTMLElement>(null);
  const branding = useRef<HTMLElement>(null);
  const forms = useRef<HTMLDivElement>(null);
  const drafts = useRef<Record<string, unknown>>({});
  const previousPage = useRef(page);
  const initial = useRef(true);
  const [displayedPage, setDisplayedPage] = useState(page);
  const changing = displayedPage !== page;

  useLayoutEffect(() => {
    const root = shell.current!;
    const visual = branding.current!;
    const slot = forms.current!;
    let frame = 0;
    let lastWidth = root.getBoundingClientRect().width;
    const measure = () => {
      const style = getComputedStyle(root);
      const brandShift = slot.getBoundingClientRect().width + parseFloat(style.columnGap);
      const formShift = visual.getBoundingClientRect().width + parseFloat(style.columnGap);
      // Finish all layout reads before writing styles. Unchanged measurements
      // must not invalidate layout while the compositor is sliding the panels.
      for (const [property, value] of Object.entries({ '--auth-brand-shift': brandShift, '--auth-form-shift': formShift })) {
        const next = `${value}px`;
        if (root.style.getPropertyValue(property) !== next) root.style.setProperty(property, next);
      }
    };
    measure();
    const observer = new ResizeObserver(entries => {
      const changed = entries.some(entry => {
        if (entry.target !== root) return true;
        const width = entry.borderBoxSize[0]?.inlineSize ?? root.clientWidth;
        if (Math.abs(width - lastWidth) < .5) return false;
        lastWidth = width;
        return true;
      });
      // Ignore the root's height-only notifications during the transition.
      if (changed && !frame) frame = requestAnimationFrame(() => { frame = 0; measure(); });
    });
    observer.observe(root);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [displayedPage]);

  useLayoutEffect(() => {
    const root = shell.current!;
    if (initial.current) {
      initial.current = false;
      const frame = requestAnimationFrame(() => root.classList.add('auth-transition-ready'));
      return () => cancelAnimationFrame(frame);
    }
    if (previousPage.current === page) return;
    previousPage.current = page;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let blur: Animation | undefined;
    if (!reduced) blur = branding.current!.animate([{ filter: 'blur(0px)' }, { filter: 'blur(2px)', offset: .45 }, { filter: 'blur(0px)' }], { duration: DURATION, easing: 'ease-in-out' });
    // The existing form cleanup cancels its requests and Google callbacks.
    if (reduced) setDisplayedPage(page);
    const timer = reduced ? undefined : window.setTimeout(() => setDisplayedPage(page), 200);
    return () => { window.clearTimeout(timer); blur?.cancel(); };
  }, [page]);

  useLayoutEffect(() => {
    if (changing || !shell.current?.classList.contains('auth-transition-ready')) return;
    const heading = forms.current?.querySelector<HTMLElement>('h1');
    heading?.setAttribute('tabindex', '-1');
    heading?.focus({ preventScroll: true });
  }, [changing, displayedPage]);

  return <AuthDrafts.Provider value={drafts.current}>
    <main ref={shell} className="signin-page auth-transition" data-auth-view={page}>
      <AuthBranding page="auth" panelRef={branding} offerSignIn={page === 'signup'} reserveReturnSpace />
      <div ref={forms} className="auth-transition-forms" data-changing={changing} inert={changing} aria-hidden={changing}>
        <div className={`auth-transition-view${displayedPage === 'signup' ? ' signup-page' : ''}`}>
          {displayedPage === 'signup' ? <SignUp formOnly /> : <SignIn formOnly />}
        </div>
      </div>
    </main>
  </AuthDrafts.Provider>;
}
