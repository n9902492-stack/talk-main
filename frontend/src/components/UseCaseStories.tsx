import { CalendarPlus, PencilRuler, Building2, UserCheck, Video } from 'lucide-react';

// Add each matching video URL (and optional poster) here when the clips are ready.
const stories = [
  {
    id: 'interactive-demos',
    title: 'Interactive Demos',
    description: 'Accelerate deal velocity with custom agendas, shared click-through collateral, and instant calendar booking.',
    icon: CalendarPlus,
    videoSrc: '/reference/interactive-demos-uploaded.mp4',
    poster: '',
  },
  {
    id: 'collaborative-workshops',
    title: 'Collaborative Workshops',
    description: 'Keep cohorts deeply engaged with real-time whiteboards, targeted breakout pods, and shared sticky canvases.',
    icon: PencilRuler,
    videoSrc: '/reference/collaborative-workshops-screen.mp4',
    poster: '',
    aspectRatio: '1036 / 500',
  },
  {
    id: 'town-halls',
    title: 'All-Hands & Town Halls',
    description: 'Align hundreds with upvoted Q&A, live synced agenda checkpoints, and clutter-free multi-speaker stages.',
    icon: Building2,
    videoSrc: '/reference/town-halls-screen.mp4',
    poster: '',
    aspectRatio: '1036 / 500',
  },
  {
    id: 'executive-discovery',
    title: 'Executive Discovery Calls',
    description: 'Frictionless browser-based rooms. Zero downloads or barriers, with automated AI briefing notes sent instantly.',
    icon: UserCheck,
    videoSrc: '/reference/executive-discovery-uploaded.mp4',
    poster: '',
  },
];

export default function UseCaseStories() {
  return <div className="usecase-stories">
    {stories.map(({ id, title, description, icon: Icon, videoSrc, poster, aspectRatio }) => (
      <article key={id} className="usecase-story" aria-labelledby={`${id}-title`}>
        <div className="usecase-story-copy">
          <span className="usecase-story-icon" aria-hidden="true"><Icon size={25} strokeWidth={1.8} /></span>
          <h3 id={`${id}-title`}>{title}</h3>
          <p>{description}</p>
        </div>
        <div className="usecase-story-media" style={aspectRatio ? { aspectRatio } : undefined}>
          {videoSrc ? <video src={videoSrc} poster={poster || undefined} controls autoPlay muted loop playsInline preload="metadata" aria-label={`${title} video`} /> : (
            <div className="usecase-video-placeholder" role="img" aria-label={`${title} video coming soon`}>
              <span className="usecase-placeholder-icon" aria-hidden="true"><Video size={30} strokeWidth={1.5} /></span>
              <span className="usecase-placeholder-title">{title}</span>
              <span className="usecase-placeholder-caption">Video coming soon</span>
            </div>
          )}
        </div>
      </article>
    ))}
  </div>;
}
