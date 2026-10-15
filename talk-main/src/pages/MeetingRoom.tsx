import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Mic, MicOff, Video, VideoOff, MonitorUp, Smile, MessageSquare, FileText, Users, Settings, PhoneOff, ChevronDown, LayoutGrid, Play, Pause, ListChecks, X, Send, Hand, Pencil, Maximize2 } from 'lucide-react';
import { useMediaPreview } from '../hooks/useMediaPreview';
import MeetingWhiteboard from '../components/MeetingWhiteboard';
import { useEmbeddedParticipant } from '../hooks/useEmbeddedParticipant';

const agenda = [
  ['Introduction to Social Media Marketing', 'Overview of the importance and benefits of social media marketing.', '05:00'],
  ['Choosing the Right Social Media Platforms', 'Tips for selecting the most suitable social media platforms for your business.', '10:00'],
  ['Creating Engaging Content', 'Strategies for developing captivating content that drives audience engagement.', '05:00'],
  ['Effective Social Media Advertising', 'Insights into creating impactful social media advertisements.', '10:00'],
  ['Measuring Social Media Success', 'Methods for tracking and analyzing key metrics to evaluate your marketing efforts.', '05:00'],
];
const participants = [['Carla Kargaard', '/reference/carla.jpg'], ['Savian Boroanca', '/reference/savian.jpg'], ['Alex Gavril', '/reference/alex.jpg']];
const transcript = [
  ['Carla Kargaard', 'Okay, that looks fine. All good. Whiteboard worked. Have a nice day. It’s good. It worked. Sorry for the wait.'],
  ['Adriana Virlan', 'And the recording is good, or should we see it after the call?'],
  ['Carla Kargaard', 'Let me just save it before I go back to you. Okay. Save. Done. Brilliant. Thank you so much.'],
];

export default function MeetingRoom() {
  const media = useMediaPreview();
  const name = sessionStorage.getItem('talk-name')?.trim() || 'You';
  const selfName = name === 'You' ? 'You' : `${name} (You)`;
  const [active, setActive] = useState(1);
  const [paused, setPaused] = useState(false);
  const [view, setView] = useState('Gallery');
  const [viewMenu, setViewMenu] = useState(false);
  const [board, setBoard] = useState(false);
  const [panel, setPanel] = useState(new URLSearchParams(window.location.search).get('panel') || '');
  const [reactions, setReactions] = useState(false);
  const [emoji, setEmoji] = useState('');
  const [raised, setRaised] = useState(false);
  const [text, setText] = useState('');
  const [messages, setMessages] = useState([{ name: 'Carla', text: 'Welcome! Great to have you here 👋' }]);
  const [questions, setQuestions] = useState<{ text: string; votes: number; voted: boolean }[]>([]);
  const [shareError, setShareError] = useState('');
  const [shareBusy, setShareBusy] = useState(false);
  const shareRequest = useRef(0);
  const [shared, setShared] = useState<MediaStream | null>(null);
  const shareRef = useRef<MediaStream | null>(null);
  const sharedVideo = useRef<HTMLVideoElement>(null);
  const recording = useRef<HTMLVideoElement>(null);
  const participantTile = useRef<HTMLDivElement>(null);
  useEmbeddedParticipant(recording, participantTile);
  const reactionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  useEffect(() => () => { shareRequest.current++; shareRef.current?.getTracks().forEach(track => track.stop()); if (reactionTimer.current) clearTimeout(reactionTimer.current); }, []);
  useEffect(() => { if (sharedVideo.current) { sharedVideo.current.srcObject = shared; if (shared) void sharedVideo.current.play().catch(() => {}); } }, [shared]);
  useEffect(() => { if (recording.current) { if (paused || board || shared) recording.current.pause(); else void recording.current.play().catch(() => {}); } }, [paused, board, shared]);
  const selectAgenda = (index: number) => { setActive(index); setBoard(false); };
  const stopSharing = () => { shareRequest.current++; shareRef.current?.getTracks().forEach(track => track.stop()); shareRef.current = null; setShared(null); setShareBusy(false); };
  const toggleBoard = () => { if (!board) stopSharing(); setBoard(!board); };
  const share = async () => {
    setShareError('');
    if (shareRef.current) { stopSharing(); return; }
    if (shareBusy) return;
    const request = ++shareRequest.current; setShareBusy(true);
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      if (request !== shareRequest.current) { stream.getTracks().forEach(track => track.stop()); return; }
      shareRef.current = stream; setBoard(false); setShared(stream);
      stream.getVideoTracks()[0].onended = () => { if (shareRef.current === stream) stopSharing(); };
    } catch (cause) { if (request === shareRequest.current) setShareError(cause instanceof DOMException && cause.name === 'NotAllowedError' ? 'Screen sharing was cancelled or blocked.' : 'Screen sharing is unavailable in this browser.'); }
    finally { if (request === shareRequest.current) setShareBusy(false); }
  };
  const fullscreen = async () => { try { await stage.current?.requestFullscreen(); } catch { setShareError('Full screen is unavailable. You can keep watching in this window.'); } };
  const send = (event: React.FormEvent) => { event.preventDefault(); if (!text.trim()) return; if (panel === 'qa') setQuestions(previous => [...previous, { text: text.trim(), votes: 0, voted: false }]); else setMessages(previous => [...previous, { name, text: text.trim() }]); setText(''); };
  const showReaction = (value: string) => { setEmoji(value); setReactions(false); if (reactionTimer.current) clearTimeout(reactionTimer.current); reactionTimer.current = setTimeout(() => setEmoji(''), 2600); };
  return <div className="meeting-room"><header className="room-header"><a href="/" className="room-brand">talk<span>STUDIO</span></a><div className="room-title"><strong>Social Media Marketing Workshop</strong><span>Session preview</span></div><div className="room-header-actions"><div className="relative"><button className="secondary-button" onClick={() => setViewMenu(!viewMenu)} aria-expanded={viewMenu}><LayoutGrid size={16} />{view}<ChevronDown size={14} /></button>{viewMenu && <div className="view-menu">{['Gallery', 'Spotlight', 'Audience'].map(mode => <button key={mode} onClick={() => { setView(mode); setViewMenu(false); }}>{mode}{view === mode && <span>✓</span>}</button>)}</div>}</div><a className="room-settings" href="/device-test"><Settings size={16} /><span>Settings</span></a><span className="room-user">{name.slice(0, 1).toUpperCase()}</span></div></header>
    <div className={`room-layout ${panel ? 'with-panel' : ''}`}><aside className="room-agenda"><div className="room-agenda-title"><ListChecks size={17} /><h2>Agenda</h2><small>{active + 1} / 5</small></div><div className="agenda-list">{agenda.map(([title, description, duration], index) => <button key={title} className={`agenda-card ${active === index ? 'active' : ''}`} aria-pressed={active === index} onClick={() => selectAgenda(index)}><div><span>{active === index ? 'NOW' : `#${index + 1}`}</span><small>{duration}</small></div><h3>{title}</h3><p>{description}</p></button>)}</div><div className="agenda-navigation"><button aria-label="Previous agenda item" disabled={active === 0} onClick={() => selectAgenda(active - 1)}><ArrowLeft size={14} />Prev</button><button disabled={board || !!shared} onClick={() => setPaused(!paused)}>{paused ? <Play size={14} /> : <Pause size={14} />}{paused ? 'Play' : 'Pause'}</button><button aria-label="Next agenda item" disabled={active === 4} onClick={() => selectAgenda(active + 1)}>Next<ArrowRight size={14} /></button></div></aside>
      <div className="room-main"><div className={`participant-strip recorded-participants ${view === 'Audience' ? 'audience-view' : ''}`}>{participants.map(([participant, image]) => <div className="participant-tile" key={participant}><img src={image} alt={participant} /><span>{participant}<MicOff size={11} /></span></div>)}</div>
      <div ref={stage} className={`room-stage ${view.toLowerCase()}-stage`}>
        <div hidden={board || !!shared} className="session-video-frame stage-content">
        <video ref={recording} src="/reference/meeting-uploaded.mp4" autoPlay loop muted controls controlsList="nofullscreen nodownload noremoteplayback" disablePictureInPicture playsInline preload="metadata" className="session-preview workshop-video" aria-label="Uploaded webinar video" onPlay={() => { if (!board && !shared) setPaused(false); }} onPause={() => { if (!board && !shared) setPaused(true); }} />
        <div ref={participantTile} hidden className={`participant-tile self-tile embedded-self-tile ${raised ? 'hand-raised' : ''}`}>
          <video ref={media.videoRef} playsInline autoPlay muted className={media.cameraOn ? '' : 'hidden'} aria-label="Your live camera" />
          {!media.cameraOn && <span className="self-avatar">{name.slice(0, 1).toUpperCase()}</span>}
          {raised && <div className="raised-hand" aria-label="Your hand is raised"><Hand size={17} /><span>Hand raised</span></div>}
          <span>{selfName}{media.micOn ? <Mic size={11} /> : <MicOff size={11} />}</span>
        </div>
        </div>
        <div hidden={!board || !!shared} className="stage-content whiteboard-layer"><MeetingWhiteboard /></div>
        <video ref={sharedVideo} autoPlay playsInline muted hidden={!shared} className="shared-screen stage-content" aria-label="Your shared screen" />
        <button className="stage-expand" aria-label="Full screen stage" onClick={() => void fullscreen()}><Maximize2 size={17} /></button>{emoji && <div className="floating-reaction" aria-live="polite">{emoji}</div>}
      </div>{(media.error || shareError) && <p role="alert" className="inline-error mt-3">{media.error || shareError}</p>}<div className="stage-caption"><span className="live-dot" /><span className="stage-caption-label">{shared ? 'You are sharing your screen' : board ? 'Interactive whiteboard · Draw on the canvas' : 'Session video'}</span><button onClick={toggleBoard}>{board ? 'Back to video' : 'Open whiteboard'}</button></div><span className="sr-only" role="status">{raised ? 'Your hand is raised' : 'Your hand is lowered'}</span></div>
      {panel && <aside className="room-panel"><div className="room-panel-heading"><h2>{panel === 'chat' ? 'Chat' : panel === 'qa' ? 'Q&A' : panel === 'transcript' ? 'Transcript' : 'Participants'}</h2><button aria-label="Close side panel" onClick={() => setPanel('')}><X size={18} /></button></div>{panel === 'transcript' ? <div className="transcript-list"><span className="text-xs text-secondary">Sample transcript</span>{transcript.map(([speaker, content], index) => <div key={index}><strong>{speaker}</strong><small>13:48</small><p>{content}</p></div>)}<button className="secondary-button" onClick={() => { stopSharing(); setBoard(false); setPanel(''); }}>Watch session video</button></div> : panel === 'participants' ? <div className="participant-list"><span className="text-xs text-secondary">Preview participants</span>{participants.map(([participant]) => <div key={participant}><span>{participant.slice(0, 1)}</span>{participant}<MicOff size={14} /></div>)}<div className="self-participant"><span>{name.slice(0, 1)}</span>{selfName}{raised && <Hand size={14} className="raised-hand" aria-label="Hand raised" />}{media.micOn ? <Mic size={14} aria-label="Microphone on" /> : <MicOff size={14} aria-label="Microphone off" />}</div></div> : <><div className="chat-messages">{panel === 'qa' ? <>{!questions.length && <div className="empty-questions"><MessageSquare size={32} /><h3>Start the conversation</h3><p>Ask a question about today’s session.</p></div>}{questions.map((question, index) => <div key={index} className="question"><strong>{name}</strong><p>{question.text}</p><button onClick={() => setQuestions(previous => previous.map((item, position) => position === index ? { ...item, votes: item.voted ? item.votes - 1 : item.votes + 1, voted: !item.voted } : item))}>↑ {question.votes} {question.voted ? 'Voted' : 'Upvote'}</button></div>)}</> : messages.map((message, index) => <div className="chat-message" key={index}><strong>{message.name}</strong><p>{message.text}</p></div>)}</div><form className="chat-form" onSubmit={send}><input aria-label={panel === 'qa' ? 'Your question' : 'Chat message'} placeholder={panel === 'qa' ? 'Ask a question…' : 'Write a message…'} value={text} maxLength={2000} onChange={event => setText(event.target.value)} /><button type="submit" aria-label={panel === 'qa' ? 'Send question' : 'Send message'} disabled={!text.trim()}><Send size={17} /></button></form><p className="text-[10px] text-secondary px-4 pb-3">Messages stay in this session preview.</p></>}</aside>}
    </div>
    <footer className="room-dock"><div className="room-device-controls"><button className={media.micOn ? 'on' : 'off'} aria-label={media.micOn ? 'Mute microphone' : 'Enable microphone'} aria-pressed={media.micOn} onClick={media.toggleMic} disabled={media.busy}>{media.micOn ? <Mic size={20} /> : <MicOff size={20} />}</button><button className={media.cameraOn ? 'on' : 'off'} aria-label={media.cameraOn ? 'Turn camera off' : 'Enable camera'} aria-pressed={media.cameraOn} onClick={media.toggleCamera} disabled={media.busy}>{media.cameraOn ? <Video size={20} /> : <VideoOff size={20} />}</button></div><div className="room-tools"><button onClick={() => void share()} disabled={shareBusy} aria-pressed={!!shared} className={shared ? 'active' : ''}><MonitorUp size={19} /><span>{shareBusy ? 'Connecting...' : shared ? 'Stop sharing' : 'Share'}</span></button><button className={board ? 'active' : ''} aria-pressed={board} onClick={toggleBoard}><Pencil size={19} /><span>Whiteboard</span></button><button className={raised ? 'active' : ''} aria-pressed={raised} onClick={() => setRaised(!raised)}><Hand size={19} /><span>{raised ? 'Lower hand' : 'Raise hand'}</span></button><div className="relative"><button onClick={() => setReactions(!reactions)} aria-expanded={reactions}><Smile size={19} /><span>Reactions</span></button>{reactions && <div className="reaction-picker">{['👏', '❤️', '🎉', '👍', '🙌'].map(value => <button key={value} aria-label={`React ${value}`} onClick={() => showReaction(value)}>{value}</button>)}</div>}</div>{[['chat', MessageSquare, 'Chat'], ['qa', MessageSquare, 'Q&A'], ['transcript', FileText, 'Transcript'], ['participants', Users, 'Participants']].map(([key, Icon, label]) => { const PanelIcon = Icon as typeof Users; return <button key={String(key)} className={panel === key ? 'active' : ''} aria-pressed={panel === key} onClick={() => { setPanel(panel === key ? '' : String(key)); setText(''); }}><PanelIcon size={19} /><span>{String(label)}</span></button>; })}</div><a href="/device-test" className="leave-button" onClick={() => { media.stop(); stopSharing(); }}><PhoneOff size={18} /><span>Leave</span></a></footer>
  </div>;
}
