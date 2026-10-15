import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, Video, Radio, ListChecks, FileText, Cloud, Check, X } from 'lucide-react';
import markup from '../design/landing.html?raw';
import FeatureTour, { features, type FeatureKey } from '../components/FeatureTour';
import UseCaseStories from '../components/UseCaseStories';
import HeroGlobe from '../components/HeroGlobe';

const icons = { bookings: Calendar, meetings: Video, webinars: Radio, agendas: ListChecks, transcripts: FileText, storage: Cloud };
export default function Landing() {
  const root = useRef<HTMLDivElement>(null);
  const [mounts, setMounts] = useState<{ tabs: Element; tour: Element; stories: Element; globe: Element } | null>(null);
  const [active, setActive] = useState<FeatureKey>('meetings');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const tabs = root.current?.querySelector('#feature-tabs');
    const tour = root.current?.querySelector('#platform-tour');
    const stories = root.current?.querySelector('#usecase-stories');
    const globe = root.current?.querySelector('.hero-globe-background');
    if (tabs && tour && stories && globe) setMounts({ tabs, tour, stories, globe });
    root.current?.querySelectorAll('img').forEach(img => { img.loading = 'lazy'; });
  }, []);
  const click = (event: React.MouseEvent) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button || button.closest('#feature-tabs, #platform-tour')) return;
    const text = button.textContent?.trim() || '';
    const icon = button.querySelector('.material-symbols-outlined')?.textContent?.trim();
    const go = (path: string) => { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')); };
    if (text === 'Claim') { button.textContent = 'Claimed'; button.disabled = true; setNotice('Workshop offer saved in this preview.'); return; }
    if (text.includes('Get started')) { const input = root.current?.querySelector<HTMLInputElement>('input[type="email"]'); if (input && (!input.value || !input.checkValidity())) { input.setCustomValidity(input.value ? '' : 'Enter your work email'); input.reportValidity(); input.setCustomValidity(''); return; } if (input) sessionStorage.setItem('talk-email', input.value); go('/device-test'); return; }
    if (button.title === 'Settings' || button.title === 'Screen share' || icon === 'call_end') { go('/device-test'); return; }
    if (button.title === 'Reactions') { setNotice('👏 Great session!'); return; }
    if (button.title === 'Chat') { setNotice('Open the meeting room to use chat and Q&A.'); return; }
    if (button.title === 'Whiteboard' || ['Draw', 'Note', 'Shapes', 'Select'].includes(button.title) || /Presenter|Audience|Gallery/.test(text)) go('/meeting');
  };
  return <><div ref={root} onClick={click} dangerouslySetInnerHTML={{ __html: markup }} />{mounts && createPortal(<HeroGlobe />, mounts.globe)}{mounts && createPortal(<><p className="font-label-md text-label-md uppercase tracking-wider text-secondary mb-4 font-semibold">One subscription gives your entire team access to</p><div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">{features.map(feature => { const Icon = icons[feature.key]; return <button key={feature.key} aria-pressed={active === feature.key} onClick={() => { setActive(feature.key); mounts.tour.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} className={`feature-tile ${active === feature.key ? 'selected' : ''}`}><span className="feature-icon"><Icon size={20} /></span><span className="font-label-md text-label-md font-semibold">{feature.short}</span></button>; })}</div></>, mounts.tabs)}{mounts && createPortal(<FeatureTour active={active} onSelect={setActive} />, mounts.tour)}{mounts && createPortal(<UseCaseStories />, mounts.stories)}{notice && <div className="toast" role="status"><Check size={18} />{notice}<button aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={16} /></button></div>}</>;
}
