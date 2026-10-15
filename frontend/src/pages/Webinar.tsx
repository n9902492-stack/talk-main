import { useState } from 'react';
import { ArrowRight, ArrowLeft, Clock, Video, ChevronLeft, ChevronRight, Play } from 'lucide-react';
import CameraPreview from '../components/CameraPreview';

const speakers = [
  { name: 'Carla Kargaard', role: 'UX Copywriter', image: '/reference/speaker-illustrations/carla.png', bio: 'Carla helps turn complex ideas into clear, engaging experiences. She hosts the conversation and brings a practical perspective on building products people love.' },
  { name: 'Savian Boroanca', role: 'Head of Community', image: '/reference/speaker-illustrations/savian.png', bio: 'Savian brings a community-first perspective to the conversation, sharing how customer relationships and interactive sessions help a product grow.' },
  { name: 'Jarrett Pflieger', role: 'Sales & Partnerships Manager · AppSumo', image: '/reference/speaker-illustrations/jarrett.png', bio: 'Jarrett shares his experience supporting software founders and product launches at AppSumo, with a focus on products that solve real business problems.' },
  { name: 'Alex Gavril', role: 'Head of Growth & Co-Founder · Promocrat', image: '/reference/speaker-illustrations/alex.png', bio: 'Alex brings a data-driven approach to growth, drawing on experience with SaaS campaigns, AppSumo launches, and community marketing.' },
];
const agenda = [
  ['🎶', 'Starting soon', '2 minutes', 'Turn up the volume and settle in while we wait for everyone to join.'],
  ['👋', 'Welcome', '2 minutes', 'Meet your host, Carla Kargaard, and find out what’s ahead.'],
  ['🎙️', 'Speakers intro', '5 minutes', 'Get to know the people behind the product and the community.'],
  ['🚀', 'From launch to $1M', '20 minutes', 'The lessons, experiments, and customer conversations behind the AppSumo launch.'],
  ['💬', 'Questions & answers', '10 minutes', 'Bring your questions and join the conversation.'],
];

export default function Webinar() {
  const [speaker, setSpeaker] = useState(0);
  return <div className="webinar-page page-width py-10 md:py-14">
    <a href="/" className="back-link"><ArrowLeft size={16} />Back to Talk</a>
    <section className="speakers-section"><div className="section-heading"><span className="heading-line" /><h1>The speakers</h1><p>This event is powered by some great professionals.</p></div><div className="speaker-grid"><div className="speaker-copy"><h3>{speakers[speaker].name}</h3><p className="speaker-role">{speakers[speaker].role}<br />Talk</p><p>{speakers[speaker].bio}</p><div className="speaker-controls"><button className="round-button" aria-label="Previous speaker" onClick={() => setSpeaker((speaker + speakers.length - 1) % speakers.length)}><ChevronLeft size={18} /></button><span>{speaker + 1} / {speakers.length}</span><button className="round-button" aria-label="Next speaker" onClick={() => setSpeaker((speaker + 1) % speakers.length)}><ChevronRight size={18} /></button></div></div><div className="speaker-photos"><img className="speaker-main" src={speakers[speaker].image} alt={`${speakers[speaker].name} illustration`} /><button className="speaker-next" onClick={() => setSpeaker((speaker + 1) % speakers.length)}><img src={speakers[(speaker + 1) % speakers.length].image} alt="" /><span>{speakers[(speaker + 1) % speakers.length].name}<ArrowRight size={14} /></span></button></div></div></section>
    <section className="webinar-session-preview" aria-label="Session access and camera preview">
      <aside className="event-access"><span className="access-tag">AVAILABLE TO WATCH</span><h3>Your front-row seat,<br />wherever you are.</h3><p>Meet the speakers, explore the agenda, and get ready for your next great session.</p><a href="/device-test" className="secondary-button w-full justify-center"><Video size={17} />Test audio & video</a><a href="/meeting" className="primary-button w-full justify-center mt-3"><Play size={16} />Open session preview</a></aside>
      <CameraPreview />
    </section>
    <section className="event-agenda"><span className="heading-line" /><h2>Agenda</h2><p className="text-secondary mb-8">You can look forward to the following topics.</p>{agenda.map(([emoji, title, duration, description]) => <div className="event-agenda-row" key={title}><div><h3><span>{emoji}</span>{title}</h3><small>Carla Kargaard</small></div><span className="agenda-duration"><Clock size={15} />{duration}</span><p>{description}</p></div>)}</section>
  </div>;
}

