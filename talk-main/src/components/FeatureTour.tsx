import { CheckCircle2, ArrowRight } from 'lucide-react';

export type FeatureKey = 'bookings' | 'meetings' | 'webinars' | 'agendas' | 'transcripts' | 'storage';
export const features: { key: FeatureKey; short: string; title: string; description: string; bullets: string[]; href: string; cta: string }[] = [
  { key: 'bookings', short: 'Bookings', title: 'Bookings', description: 'Share your schedule and let customers book a time that suits you both.', bullets: ['Sync your calendars and create custom booking links.', 'Pre-load agendas and presentation materials for each meeting.', 'Add your booking page to your website.', 'Invite your team to help you take bookings.'], href: '/bookings', cta: 'Book a session' },
  { key: 'meetings', short: 'Live Meetings', title: 'Meetings', description: 'Everything you need for memorable, collaborative meetings — in one space.', bullets: ['Bring your whiteboards, documents and tools into the session.', 'Keep everyone on track with an interactive agenda.', 'Switch between gallery, spotlight and audience views.', 'Test your camera and microphone before you join.'], href: '/device-test', cta: 'Test audio & video' },
  { key: 'webinars', short: 'Webinars', title: 'Webinars', description: 'Create professional events that bring your audience closer.', bullets: ['Build a branded event page with speaker profiles.', 'Make registration simple for your audience.', 'Share an agenda and keep the conversation moving.', 'Engage your audience with chat, Q&A and live offers.'], href: '/webinars', cta: 'Explore the webinar' },
  { key: 'agendas', short: 'Agendas', title: 'Interactive agendas', description: 'Bring structure to every session without losing the flow.', bullets: ['Prepare topics, timings and materials in advance.', 'Embed your favorite tools directly into your agenda.', 'Move through the session together, step by step.', 'Save and reuse your best agendas.'], href: '/meeting', cta: 'Open the meeting room' },
  { key: 'transcripts', short: 'AI Transcripts', title: 'Transcripts', description: 'Stay in the conversation. Keep the details for later.', bullets: ['Follow along with your session transcript.', 'Revisit the topics and decisions after your meeting.', 'Keep notes alongside your agenda.', 'Watch the original session recording.'], href: '/meeting?panel=transcript', cta: 'View the session' },
  { key: 'storage', short: 'Cloud Storage', title: 'Cloud storage', description: 'Your session materials, together in one place.', bullets: ['Keep your recordings, documents and agendas organized.', 'Use shared resources across your workspaces.', 'Access your materials whenever you need them.', 'Replay or download the supplied session recording.'], href: '/reference/session-recording.mp4', cta: 'Watch the recording' },
];
export default function FeatureTour({ active, onSelect }: { active: FeatureKey; onSelect: (key: FeatureKey) => void }) {
  const current = features.find(feature => feature.key === active)!;
  const previewVideos: Record<FeatureKey, string> = {
    bookings: '/reference/bookings-showcase.mp4',
    meetings: '/reference/meetings-showcase.mp4',
    webinars: '/reference/webinars-uploaded.mp4',
    agendas: '/reference/agendas-uploaded.mp4',
    transcripts: '/reference/transcripts-uploaded.mp4',
    storage: '/reference/storage-uploaded.mp4',
  };
  const previewSrc = previewVideos[active];
  const previewLabel = `${current.title} video demonstration`;
  return <section id="platform" className="py-20 bg-surface"><div className="page-width"><h2 className="font-headline-lg text-headline-lg font-bold text-center tracking-tight">Manage and host it all on a single platform</h2><div className="tour-tabs" role="tablist" aria-label="Platform features">{features.map(feature => <button key={feature.key} role="tab" id={`tab-${feature.key}`} aria-controls="tour-panel" aria-selected={active === feature.key} onClick={() => onSelect(feature.key)}>{feature.key === 'meetings' ? 'Meetings' : feature.key === 'transcripts' ? 'Transcripts' : feature.short}</button>)}</div><div id="tour-panel" role="tabpanel" aria-labelledby={`tab-${active}`} className="tour-grid"><div><h3 className="font-headline-md text-headline-md font-bold mb-3">{current.title}</h3><p className="text-body-lg text-on-surface-variant mb-6">{current.description}</p><ul className="space-y-4 mb-8">{current.bullets.map(bullet => <li key={bullet} className="flex gap-3 text-sm text-on-surface-variant"><CheckCircle2 size={17} className="text-primary shrink-0 mt-0.5" />{bullet}</li>)}</ul><a href={current.href} className="primary-button">{current.cta}<ArrowRight size={16} /></a></div><video key={active} className="tour-video uploaded-tour-video" controls muted playsInline loop autoPlay preload="metadata" src={previewSrc} aria-label={previewLabel} /></div></div></section>;
}
