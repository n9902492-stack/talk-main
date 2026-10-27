import { useEffect, useRef, useState, type RefObject } from 'react';
import { Copy, Crown, MessageSquare, Users, Settings2, Smile, Pencil, ChevronsRight, Mic, MicOff, Pin, Send, Video, VideoOff, X } from 'lucide-react';
import type { Participant } from 'livekit-client';
import { chatMaxLength } from '../lib/meetingExperience';
import type { useMeetingChat } from '../hooks/useMeetingChat';
import type { MeetingManagement } from '../hooks/useMeetingManagement';
import BackgroundSettings, { videoSettingsSections, type VideoSettingsSection } from './BackgroundSettings';
import type { useMeetingBackground } from '../hooks/useMeetingBackground';
import AvatarPicker from './AvatarPicker';
import Avatar from './Avatar';
import ReactionPicker from './ReactionPicker';
import { MeetingOptions, ParticipantActions, RaisedHands, WaitingRequests } from './MeetingModeration';
import type { MeetingRecording } from '../hooks/useMeetingRecording';

export type MeetingPanel = 'participants' | 'chat' | 'info' | 'settings' | 'more' | 'reactions' | null;
export type MeetingDeviceState = { devices: MediaDeviceInfo[]; cameraId: string; micId: string; speakerId: string; speakerSupported: boolean; busy: boolean; onChange: (kind: MediaDeviceKind, id: string) => void };

export default function MeetingPanels({ panel, onClose, onPanelChange, onOpenWhiteboard, participants, localIdentity, hostIdentity, management, recording, onNewMeeting, pinnedIdentity, onPin, title, roomId, link, duration, copyStatus, onCopy, devices, chat, connected, trigger, floatingReactions, onFloatingReactions, background, cameraEnabled }: {
  panel: Exclude<MeetingPanel, null>; onClose: () => void; participants: Participant[]; localIdentity: string; hostIdentity: string; pinnedIdentity: string | null;
  onPanelChange?: (panel: Exclude<MeetingPanel,null>) => void;
  onOpenWhiteboard?:()=>void;
  onPin: (identity: string) => void; title: string; roomId: string; link: string; duration: string; copyStatus: string; onCopy: () => void;
  devices: MeetingDeviceState; chat: ReturnType<typeof useMeetingChat>; connected: boolean; trigger: RefObject<HTMLButtonElement | null>;
  background: ReturnType<typeof useMeetingBackground>; cameraEnabled: boolean;
  floatingReactions: boolean; onFloatingReactions: (enabled: boolean) => void;
  management: MeetingManagement; onNewMeeting: () => Promise<void>;
  recording: MeetingRecording;
}) {
  const [settingsTab, setSettingsTab] = useState<'devices' | VideoSettingsSection>('devices');
  const heading = useRef<HTMLHeadingElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const body = useRef<HTMLElement>(null);
  const chatList = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 700px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 700px)');
    const change = () => setMobile(media.matches); media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    if (panel === 'chat') input.current?.focus(); else heading.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); trigger.current?.focus(); }
      if (event.key !== 'Tab' || !window.matchMedia('(max-width: 700px)').matches) return;
      const items = Array.from(body.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input, select:not(:disabled), textarea, [tabindex="0"]') || []);
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && (document.activeElement === first || !items.includes(document.activeElement as HTMLElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key);
  }, [panel]);
  useEffect(() => {
    if (!mobile) return;
    const outside = Array.from(document.querySelectorAll<HTMLElement>('.live-meeting > header, .live-meeting > footer, .studio-session-footer, .live-meeting-stage, .live-meeting-status, .live-meeting-notice, .live-enable-audio'));
    const previous = outside.map(element => element.inert);
    outside.forEach(element => { element.inert = true; });
    return () => {
      outside.forEach((element, index) => { element.inert = previous[index]; });
      queueMicrotask(() => trigger.current?.focus());
    };
  }, [mobile]);
  useEffect(() => { if (nearBottom.current && chatList.current) chatList.current.scrollTop = chatList.current.scrollHeight; }, [chat.messages, panel]);
  const labels = { participants: `Participants (${participants.length})`, chat: 'In-meeting chat', info: 'Meeting information', settings: 'Audio & video settings', more: 'More options', reactions: 'Reactions' };
  const deviceSelect = (kind: MediaDeviceKind, label: string, current: string) => {
    const available = devices.devices.filter(device => device.kind === kind);
    const missing = current && !available.some(device => device.deviceId === current);
    return <div className="live-settings-field"><label htmlFor={`live-${kind}`}>{label}</label><select id={`live-${kind}`} disabled={!connected || devices.busy || kind === 'audiooutput' && !devices.speakerSupported} value={current} onChange={event => devices.onChange(kind, event.target.value)}>
      <option value="">System default</option>{missing && <option value={current} disabled>Selected device unavailable</option>}{available.filter(device => device.deviceId).map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `${label} ${index + 1}`}</option>)}
    </select></div>;
  };
  return <aside ref={body} id="live-meeting-panel" className={`live-meeting-panel panel-${panel}`} role={mobile ? 'dialog' : 'complementary'} aria-modal={mobile || undefined} aria-labelledby="live-panel-heading">
    <header><h2 ref={heading} id="live-panel-heading" tabIndex={-1}>{labels[panel]}</h2><button onClick={() => { onClose(); trigger.current?.focus(); }} aria-label="Close meeting panel">{panel==='chat'||panel==='participants'?<ChevronsRight size={16}/>:<X size={19}/>}</button></header>
    {onPanelChange && (panel === 'chat' || panel === 'participants') && <nav className="studio-side-tabs" aria-label="Meeting sidebar sections"><button type="button" aria-label="Show chat" aria-pressed={panel === 'chat'} onClick={() => onPanelChange('chat')}><MessageSquare size={13}/>Chat</button><button type="button" aria-label="Show people" aria-pressed={panel === 'participants'} onClick={() => onPanelChange('participants')}><Users size={13}/>People<span className="call-people-count">{participants.length}</span></button></nav>}
    {panel === 'participants' && <div className="live-panel-body"><button className="secondary-button live-copy-link" onClick={onCopy}><Copy size={16} />Copy Meeting Link</button><p role="status" className="live-panel-caption">{copyStatus}</p><WaitingRequests management={management} /><RaisedHands management={management} /><ul className="live-people-list">{participants.map(participant => <li key={participant.identity}>
      <span className="live-person-avatar"><Avatar name={participant.name || 'Talk member'} avatar={management.data?.members.find(member => member.identity === participant.identity)?.avatar} /></span><div><strong>{participant.name || 'Talk member'}{participant.identity === localIdentity ? ' (You)' : ''}</strong><span>{management.data?.members.find(member => member.identity === participant.identity)?.role !== 'member' && management.data?.members.some(member => member.identity === participant.identity) && <><Crown size={12} />{participant.identity === hostIdentity ? 'Host' : 'Co-host'} · </>}{participant.isScreenShareEnabled ? 'Presenting' : participant.isSpeaking ? 'Speaking' : 'In the meeting'}</span></div>
      <div className="live-person-status">{participant.isMicrophoneEnabled ? <Mic size={15} aria-label="Microphone on" /> : <MicOff size={15} aria-label="Microphone off" />}{participant.isCameraEnabled ? <Video size={15} aria-label="Camera on" /> : <VideoOff size={15} aria-label="Camera off" />}</div><button className="live-person-pin" onClick={() => onPin(participant.identity)} aria-pressed={pinnedIdentity === participant.identity} aria-label={`${pinnedIdentity === participant.identity ? 'Unpin' : 'Pin'} ${participant.name || 'Talk member'} video`}><Pin size={15} /></button>
      {management.data?.members.find(member => member.identity === participant.identity) && <ParticipantActions member={management.data.members.find(member => member.identity === participant.identity)!} management={management} />}
    </li>)}</ul><p className="live-panel-caption">The creator owns this meeting. Host and co-host permissions are verified by Talk. Only you can activate your camera or microphone.</p></div>}
    {panel === 'reactions' && <div className="live-panel-body"><ReactionPicker management={management} connected={connected} /><label className="talk-floating-toggle"><input type="checkbox" checked={floatingReactions} onChange={event => onFloatingReactions(event.target.checked)} />Show floating reactions</label></div>}
    {panel === 'more' && <><div className="live-panel-body call-more-body"><nav className="call-more-shortcuts" aria-label="Meeting tools"><button aria-label="Settings" onClick={()=>onPanelChange?.('settings')}><Settings2 size={17}/>Audio &amp; video settings</button><button aria-label="Reactions" onClick={()=>onPanelChange?.('reactions')}><Smile size={17}/>Reactions</button>{onOpenWhiteboard&&<button aria-label="Whiteboard" disabled={!connected} onClick={onOpenWhiteboard}><Pencil size={17}/>Whiteboard</button>}</nav></div><MeetingOptions management={management} recording={recording} meetingId={roomId} connected={connected} onNewMeeting={onNewMeeting} /></>}
    {panel === 'info' && <div className="live-panel-body"><p className="live-panel-caption">Share this link with someone who has a verified Talk account.</p><dl className="live-meeting-details"><dt>Meeting title</dt><dd>{title}</dd><dt>Meeting ID</dt><dd>{roomId}</dd><dt>Duration</dt><dd>{duration}</dd><dt>Participants</dt><dd>{participants.length}</dd></dl><label className="field-label" htmlFor="live-meeting-link">Meeting link</label><input className="form-input" id="live-meeting-link" readOnly value={link} onFocus={event => event.currentTarget.select()} /><button className="primary-button live-copy-link" onClick={onCopy}><Copy size={16} />Copy link</button><p className="live-panel-caption" role="status">{copyStatus}</p></div>}
    {panel === 'settings' && <div className="live-panel-body"><div className="talk-settings-tabs" role="group" aria-label="Video settings sections"><button aria-pressed={settingsTab==='devices'} onClick={()=>setSettingsTab('devices')}>Audio &amp; video</button>{videoSettingsSections.map(section=><button key={section.id} aria-pressed={settingsTab===section.id} onClick={()=>setSettingsTab(section.id)}>{section.name}</button>)}</div>{settingsTab!=='devices'?<BackgroundSettings enabled={cameraEnabled} track={background.track} status={background.status} section={settingsTab} showTabs={false}/>:<><AvatarPicker /><hr className="talk-avatar-divider" /><p className="live-panel-caption">Device changes keep your camera and microphone on/off choices.</p>{deviceSelect('videoinput', 'Camera', devices.cameraId)}{deviceSelect('audioinput', 'Microphone', devices.micId)}{deviceSelect('audiooutput', 'Speaker output', devices.speakerId)}{!devices.speakerSupported && <p className="live-panel-caption">This browser uses your system’s speaker output. Output selection is unavailable here.</p>}<p className="live-panel-caption" role="status">{devices.busy ? 'Switching device…' : 'Missing a device? Connect it, then choose it from the list. Your browser may need permission to show device names.'}</p></>}</div>}
    {panel === 'chat' && <><p className="live-chat-privacy">Session-only chat. Messages aren’t saved or replayed to people who join later.</p><div className="live-chat-list" ref={chatList} role="log" aria-live="polite" aria-relevant="additions" aria-label="Meeting messages" onScroll={event => { const element = event.currentTarget; nearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 70; }}>
      {!chat.messages.length && <div className="live-chat-empty"><p>Start the conversation</p><span>Send a message to everyone in this meeting.</span></div>}
      {chat.messages.map(message => <article key={`${message.senderIdentity}:${message.id}`} className={`live-chat-message${message.local ? ' is-local' : ''}`} data-message-id={message.id}><span className="live-chat-avatar"><Avatar name={message.senderName} avatar={management.data?.members.find(m=>m.identity===message.senderIdentity)?.avatar}/></span><div><strong>{message.senderName}{message.local ? ' (You)' : ''}</strong><time dateTime={new Date(message.sentAt).toISOString()}>{new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(message.sentAt)}</time></div><p>{message.text}</p>{message.status === 'sending' && <small>Sending…</small>}{message.status === 'failed' && <button disabled={!connected} onClick={() => void chat.send(message)}>Send again</button>}</article>)}
    </div><form className="live-chat-compose" onSubmit={event => { event.preventDefault(); nearBottom.current = true; void chat.send(); }}>{chat.error && <p role="alert">{chat.error}</p>}{!connected && <p role="status">Reconnect to send. Your draft is kept.</p>}<label className="sr-only" htmlFor="live-chat-message">Message everyone</label><button type="button" className="call-chat-emoji" aria-label="Add emoji" onClick={()=>{chat.setDraft(chat.draft+' \u{1F642}');input.current?.focus();}}><Smile size={16}/></button><textarea ref={input} id="live-chat-message" value={chat.draft} maxLength={chatMaxLength} rows={3} placeholder="Message everyone" onChange={event => chat.setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); nearBottom.current = true; void chat.send(); } }} /><div><span>{chat.draft.length}/{chatMaxLength}</span><button type="submit" className="primary-button" disabled={!connected || !chat.draft.trim()} aria-label="Send message"><Send size={16} />Send</button></div></form></>}
  </aside>;
}
