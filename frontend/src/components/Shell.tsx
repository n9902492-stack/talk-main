import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Menu, X, UserRound, Video, Radio, Calendar, Mic, FileText, Users } from 'lucide-react';
import footer from '../design/footer.html?raw';

const menus = {
  Features: [['Live meetings', '/device-test', Video], ['Webinars', '/webinars', Radio], ['Bookings', '/bookings', Calendar], ['Test audio & video', '/device-test', Mic], ['Interactive agendas', '/#platform', FileText]],
  'Use Cases': [['Product onboarding', '/#features-overview', Users], ['Webinars & workshops', '/webinars', Radio], ['Sales demos', '/bookings', Video]],
  Resources: [['Watch the recording', '/#meeting-showcase', Video], ['Wall of Love', '/#wall-of-love', Users], ['Privacy & security', '/#security', FileText]],
} as const;

export function Header() {
  const [open, setOpen] = useState<string | null>(null);
  const [mobile, setMobile] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!ref.current || !event.composedPath().includes(ref.current)) { setOpen(null); setMobile(false); } };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(null); setMobile(false); } };
    document.addEventListener('click', close); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('click', close); document.removeEventListener('keydown', escape); };
  }, []);
  return <header ref={ref} className="skin-header fixed top-0 left-0 right-0 z-50">
    <div className="h-20 page-width flex items-center justify-between gap-4">
      <div className="flex items-center gap-6">
        <a href="/" className="flex items-center gap-2" onClick={() => { setOpen(null); setMobile(false); }}><span className="font-headline-sm text-headline-sm font-bold tracking-tight">Talk</span></a>
        <nav aria-label="Main navigation" className="hidden xl:flex items-center gap-6">{Object.entries(menus).map(([name, items]) => <div key={name} className="relative"><button className="flex items-center gap-1 text-sm font-semibold text-on-surface-variant" aria-expanded={open === name} aria-controls={`menu-${name}`} onClick={() => setOpen(open === name ? null : name)}>{name}<ChevronDown size={16} /></button>{open === name && <div id={`menu-${name}`} className="nav-dropdown">{items.map(([label, href, Icon]) => <a key={label} href={href} onClick={() => setOpen(null)}><Icon size={18} /><span>{label}</span></a>)}</div>}</div>)}<a href="/#pricing" className="text-sm font-semibold text-on-surface-variant">Pricing</a><a href="/#community" className="text-sm font-semibold text-on-surface-variant">Referral Program</a></nav>
      </div>
      <div className="flex items-center gap-2"><a href="/sign-in" className="hidden sm:inline-flex px-3 py-2 text-sm font-semibold">Log in</a><a href="/bookings" className="hidden lg:inline-flex px-4 py-2 text-sm font-semibold rounded-xl hover:bg-white/50">Get a live demo</a><a href="/sign-up" className="skin-button px-4 py-2 rounded-xl text-sm font-semibold">Sign up for free</a><span className="hidden sm:flex w-8 h-8 rounded-full skin-avatar items-center justify-center ml-1"><UserRound size={18} /></span><button className="xl:hidden p-2" aria-label={mobile ? 'Close navigation' : 'Open navigation'} aria-expanded={mobile} onClick={() => setMobile(!mobile)}>{mobile ? <X size={21} /> : <Menu size={21} />}</button></div>
    </div>
    {mobile && <nav aria-label="Mobile navigation" className="page-width grid pb-6 gap-3 pt-4" onClick={() => setMobile(false)}><a href="/sign-in">Log in</a><a href="/webinars">Webinars</a><a href="/device-test">Test audio & video</a><a href="/bookings">Book a live demo</a><a href="/#features-overview">Use cases</a><a href="/#community">Resources</a></nav>}
  </header>;
}

export default function Shell({ children }: { children: ReactNode }) {
  return <><Header /><main className="pt-20 bg-surface min-h-[calc(100vh-20rem)]">{children}</main><div dangerouslySetInnerHTML={{ __html: footer }} /></>;
}
