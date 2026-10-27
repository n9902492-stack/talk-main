import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Crown, Hand, Mic, MicOff, MonitorUp, Pin, PinOff } from 'lucide-react';
import { Track, type Participant } from 'livekit-client';
import { meetingGridColumns } from '../lib/meetingExperience';
import Avatar from './Avatar';
import type { AvatarSelection } from '../lib/avatars';
import type { MeetingManagementState } from '../hooks/useMeetingManagement';
import { participantTheme } from '../lib/participantTheme';
import '../styles/participant-theme.css';

function VideoSurface({ participant, local, screen = false, host, cohost, hand, pinned, onPin, avatar, reactions = [] }: {
  participant: Participant; local: boolean; screen?: boolean; host?: boolean; cohost?: boolean; hand?: boolean; pinned?: boolean; onPin?: () => void;
  avatar?: AvatarSelection; reactions?: MeetingManagementState['reactions'];
}) {
  const video = useRef<HTMLVideoElement>(null);
  const publication = participant.getTrackPublication(screen ? Track.Source.ScreenShare : Track.Source.Camera);
  const videoTrack = !publication?.isMuted ? publication?.videoTrack : undefined;
  useEffect(() => {
    const element = video.current;
    if (!element || !videoTrack) return;
    videoTrack.attach(element); if (local) element.muted = true;
    return () => { videoTrack.detach(element); element.srcObject = null; };
  }, [videoTrack, local]);
  const name = participant.name || 'Talk member';
  const theme = participantTheme(name);
  return <article className={`${screen ? 'live-presentation-tile' : 'live-participant-tile'}${!screen && participant.isSpeaking ? ' is-speaking' : ''}${pinned ? ' is-pinned' : ''}`}
    data-identity={participant.identity} data-local={local} data-speaking={participant.isSpeaking}>
    <video ref={video} autoPlay playsInline muted={local} className={videoTrack ? '' : 'is-hidden'} aria-label={`${name}${screen ? ' presentation' : `${local ? ' (You)' : ''} video`}`} />
    {!videoTrack && <div className="live-participant-placeholder" data-avatar-theme={screen ? undefined : theme.key} style={screen ? undefined : { '--participant-hue': theme.hue } as CSSProperties}><Avatar avatar={avatar} name={name} /><p>{screen ? 'Connecting presentation…' : participant.isCameraEnabled ? 'Connecting video…' : 'Camera off'}</p></div>}
    {!screen && <div className="live-tile-reactions" aria-live="polite">{reactions.slice(-3).map(reaction => <span key={reaction.id} className="live-tile-reaction" role="img" aria-label={`${name} tile reaction ${reaction.emoji}`}><span aria-hidden="true">{reaction.emoji}</span><small>{name}</small></span>)}</div>}
    <div className="live-participant-name"><strong>{name}{local ? ' · You' : ''}</strong>{(host || cohost) && <Crown size={14} aria-label={host ? 'Host' : 'Co-host'} />}{hand && <Hand size={15} className="live-hand-indicator" aria-label="Hand raised" />}{screen ? <MonitorUp size={15} aria-label="Presenting" /> : participant.isMicrophoneEnabled ? <Mic size={15} aria-label="Microphone on" /> : <MicOff size={15} aria-label="Microphone off" />}</div>
    {!screen && <span className={`studio-tile-muted${participant.isMicrophoneEnabled?' is-live':''}`} aria-hidden="true">{participant.isMicrophoneEnabled?<Mic size={14}/>:<MicOff size={14}/>}</span>}{!screen&&participant.isSpeaking&&<span className="call-speaking-label">Speaking</span>}
    {onPin && <button type="button" className={`live-tile-pin${pinned ? ' is-selected' : ''}`} aria-label={`${pinned ? 'Unpin' : 'Pin'} ${name}`} aria-pressed={pinned} onClick={onPin}>{pinned ? <PinOff size={16} /> : <Pin size={16} />}</button>}
  </article>;
}

function ParticipantAudio({ participant, source }: { participant: Participant; source: Track.Source.Microphone | Track.Source.ScreenShareAudio }) {
  const audio = useRef<HTMLAudioElement>(null);
  const track = participant.getTrackPublication(source)?.audioTrack;
  useEffect(() => {
    const element = audio.current;
    if (!track || !element) return;
    track.attach(element);
    return () => { track.detach(element); element.srcObject = null; };
  }, [track]);
  return <audio ref={audio} autoPlay className="live-remote-audio" data-audio-participant={participant.identity} data-audio-source={source} aria-label={`${participant.name || 'Talk member'} ${source === Track.Source.Microphone ? 'audio' : 'presentation audio'}`} />;
}

export default function MeetingCanvas({ participants, localIdentity, hostIdentity, cohostIdentities = [], raisedHands = [], pinnedIdentity, activeSpeakerIdentity, layout, presentationIdentity, onPin, onShowPresentation, members = [], reactions = [] }: {
  participants: Participant[]; localIdentity: string; hostIdentity: string; pinnedIdentity: string | null; activeSpeakerIdentity: string;
  layout: 'grid' | 'speaker'; presentationIdentity: string | null; onPin: (identity: string) => void; onShowPresentation: () => void;
  cohostIdentities?: string[]; raisedHands?: string[];
  members?: MeetingManagementState['members']; reactions?: MeetingManagementState['reactions'];
}) {
  const canvas = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1200, height: 700 });
  useEffect(() => {
    const element = canvas.current; if (!element) return;
    const observer = new ResizeObserver(entries => { const box = entries[0].contentRect; setSize({ width: box.width, height: box.height }); });
    observer.observe(element); return () => observer.disconnect();
  }, []);
  const presentation = participants.find(participant => participant.identity === presentationIdentity && participant.isScreenShareEnabled);
  const focus = participants.find(participant => participant.identity === pinnedIdentity)
    || (layout === 'speaker' ? participants.find(participant => participant.identity === activeSpeakerIdentity) || participants.find(participant => participant.identity === hostIdentity) || participants[0] : undefined);
  const showPresentation = Boolean(presentation && !pinnedIdentity);
  const spotlight = showPresentation ? presentation : focus;
  const columns = meetingGridColumns(participants.length, size.width, size.height);
  const tile = (participant: Participant) => { const member = members.find(item => item.identity === participant.identity); return <VideoSurface key={participant.identity} participant={participant} avatar={member?.avatar} reactions={reactions.filter(item => item.accountId === member?.accountId)} local={participant.identity === localIdentity} host={participant.identity === hostIdentity} cohost={cohostIdentities.includes(participant.identity)} hand={raisedHands.includes(participant.identity)} pinned={participant.identity === pinnedIdentity} onPin={() => onPin(participant.identity)} />; };
  return <div className="live-meeting-canvas" ref={canvas}>
    <div className="live-audio-layer">{participants.filter(participant => participant.identity !== localIdentity).map(participant => <div key={participant.identity}>
      <ParticipantAudio participant={participant} source={Track.Source.Microphone} /><ParticipantAudio participant={participant} source={Track.Source.ScreenShareAudio} />
    </div>)}</div>
    {spotlight ? <div className="live-focus-layout" data-layout={showPresentation ? 'presentation' : 'speaker'}>
      <div className="live-focus-stage">{showPresentation && presentation ? <VideoSurface participant={presentation} local={presentation.identity === localIdentity} screen /> : focus && tile(focus)}</div>
      <div className="live-filmstrip" aria-label="Participant videos">{participants.filter(participant => showPresentation || participant.identity !== spotlight.identity).map(tile)}</div>
      {presentation && pinnedIdentity && <button className="secondary-button live-return-presentation" onClick={onShowPresentation}><MonitorUp size={15} />Show presentation</button>}
    </div> : <div className="live-meeting-grid" data-layout="grid" data-participants={participants.length} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${Math.ceil(participants.length / columns)}, minmax(120px, 1fr))` }}>{participants.map(tile)}</div>}
  </div>;
}
