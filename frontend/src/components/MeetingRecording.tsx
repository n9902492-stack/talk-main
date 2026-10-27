import { useEffect, useRef, useState } from 'react';
import { Circle, FileText, Mic, ShieldCheck, Square, Video } from 'lucide-react';
import { useMeetingRecording, type MeetingRecording, type RecordingMode } from '../hooks/useMeetingRecording';
import '../styles/recordings.css';

const collecting = (status?: string) => status === 'awaiting_consent' || status === 'consenting';

export function RecordingControls({ recording, connected, meetingId }: { recording: MeetingRecording; connected: boolean; meetingId: string }) {
  const [mode, setMode] = useState<RecordingMode>('audio');
  const [language, setLanguage] = useState('auto');
  const [retention, setRetention] = useState(30);
  const data = recording.data;
  if (!data?.canManage) return null;
  const active = data.active, awaiting = collecting(active?.status);
  const pending = data.consent.pending || [];
  return <section className="talk-recording-controls" aria-label="Recording controls"><h3><Circle size={16} />Recording &amp; transcription</h3>
    {data.lastFailure && <p className="talk-recording-warning" role="alert">{data.lastFailure.error} You can request a new segment.</p>}
    {!active && data.latest?.status === 'processing' && <p role="status">Processing recording: finalizing the private media file. It is not ready for playback yet.</p>}
    {!active && data.latest?.status === 'completed' && <p role="status">Recording ready. The media file and metadata have been saved. Open Meeting recordings &amp; transcript to play or download it.</p>}
    {recording.statusError && <p className="talk-recording-warning" role="status">{recording.statusError}</p>}
    {!data.provider.configured && <p className="talk-recording-warning" role="status">{data.provider.reason || 'Recording is not configured. A private recording provider and storage must be configured on the backend.'}</p>}
    {!active ? <><label>Recording mode<select aria-label="Recording mode" value={mode} onChange={event => setMode(event.target.value as RecordingMode)}><option value="audio">Audio only</option><option value="video">Screen, cameras &amp; audio</option></select></label><label>Speech language<select aria-label="Speech language" value={language} onChange={event => setLanguage(event.target.value)}><option value="auto">Detect English / Hindi</option><option value="en">English</option><option value="hi">Hindi</option></select></label><label>Delete recording after<select aria-label="Delete recording after" value={retention} onChange={event => setRetention(Number(event.target.value))}><option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option></select></label>
      {mode === 'video' && <p className="live-panel-caption">Records shared screens, participant cameras and meeting audio together. Share your screen in the meeting to include it in the recording.</p>}<p className="live-panel-caption">Everyone must explicitly consent before a host starts capture. New participants must consent before joining. Recording and transcription are private to authorized hosts and co-hosts.</p><button className="secondary-button" disabled={!connected || recording.busy || !data.provider.configured} onClick={() => void recording.request(mode, language, retention)}><Circle size={15} />Request recording consent</button></> : <>
      <p role="status">{awaiting ? 'Waiting for recording consent' : active.status === 'starting' ? 'Starting recording…' : active.status === 'stopping' ? 'Stopping recording…' : 'Recording in progress'} · {active.mode === 'audio' ? 'Audio only' : 'Screen, cameras & audio'}</p>
      {awaiting && <><p className="live-panel-caption">{pending.length ? `Waiting for ${pending.length} ${pending.length === 1 ? 'person' : 'people'} to accept.` : 'All required responses have been received. Start checks consent again on the server.'}</p>{pending.length > 0 && <ul className="talk-recording-pending">{pending.map(person => <li key={person.accountId}>{person.name}</li>)}</ul>}<button className="primary-button" disabled={!connected || recording.busy || pending.length > 0 || data.consent.decision !== 'accepted'} onClick={() => void recording.start()}><Circle size={15} />Start Recording</button></>}
      <button className="secondary-button" disabled={recording.busy || active.status === 'stopping'} onClick={() => void recording.stop()}><Square size={15} />{awaiting ? 'Cancel recording request' : 'Stop Recording'}</button>
      {active.status === 'stopping' && <p className="live-panel-caption">Stopping capture and saving this segment in the background. You can continue your meeting; its recording and transcript status will update in Meeting details.</p>}
      <p className="live-panel-caption">Pause is not supported by this provider. Stop this segment, then request a new segment when ready to continue. Each segment has its own consent and transcript.</p>
    </>}
    {recording.error && <p className="inline-error" role="alert">{recording.error}</p>}
    <a className="signin-text-button" href={`/meeting-history/${encodeURIComponent(meetingId)}`}><FileText size={15} />Meeting recordings &amp; transcript</a>
  </section>;
}

function ConsentContent({ recording, prejoin, onLeave }: { recording: MeetingRecording; prejoin?: boolean; onLeave?: () => void }) {
  const active = recording.data?.active;
  return <><h2 id={prejoin ? 'recording-prejoin-heading' : 'recording-consent-heading'}>This meeting requests recording</h2><p>{active?.mode === 'audio' ? 'Meeting audio' : 'Meeting audio, camera video and shared content'} and speech may be captured, stored privately, and used to create a transcript. Authorized hosts and co-hosts can access the recording and transcript.</p><p>Choose freely. Without consent, recording cannot start while you are in the meeting. If recording is already active, you must consent before joining. You can withdraw consent later; Talk will stop the active recording.</p>
    <div className="talk-recording-consent-actions"><button className="primary-button" disabled={recording.busy} onClick={() => void recording.consent(true)}><ShieldCheck size={16} />I consent to recording</button><button className="secondary-button" disabled={recording.busy} onClick={() => void recording.consent(false)}>I do not consent</button>{onLeave && <button className="signin-text-button" onClick={onLeave}>Leave meeting</button>}</div>{recording.error && <p role="alert" className="inline-error">{recording.error}</p>}</>;
}

export function RecordingNotice({ recording, onLeave, connected }: { recording: MeetingRecording; onLeave: () => void; connected: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const data = recording.data, active = data?.active;
  const needsDecision = Boolean(active && data?.consent.required && data.consent.decision === 'pending');
  useEffect(() => { const element = dialog.current; if (!element) return; if (needsDecision && !element.open) element.showModal(); else if (!needsDecision && element.open) element.close(); }, [needsDecision]);
  if (!active) {
    if (data?.lastFailure) return <div className="talk-recording-warning" role="alert">{data.lastFailure.error} Open More options for recording controls.</div>;
    if (data?.latest?.status === 'processing') return <div className="talk-recording-notice" role="status">Processing recording: saving and checking the private file. This recording is not ready yet.</div>;
    return null;
  }
  const awaiting = collecting(active.status);
  const readyToStart = awaiting && data?.canManage && data.consent.decision === 'accepted' && data.consent.pending?.length === 0;
  return <><div className={`talk-recording-notice${active.status === 'recording' ? ' is-recording' : ''}`} role="status" aria-live="polite"><span className="talk-recording-dot" /><strong>{awaiting ? 'Recording requested' : active.status === 'starting' ? 'Recording starting' : active.status === 'stopping' ? 'Recording stopping' : 'Recording on'}</strong><span>{active.mode === 'audio' ? <Mic size={15} /> : <Video size={15} />}{active.mode === 'audio' ? 'Audio & speech transcription' : 'Audio, cameras, shared screen & speech transcription'}</span>
    {readyToStart && <><span>Consent received. Capture has not started.</span><button className="talk-recording-start" disabled={!connected || recording.busy || !!recording.statusError || !data.provider.configured} onClick={() => void recording.start()}><Circle size={14} />Start Recording</button></>}
    {data?.consent.decision === 'accepted' ? <button disabled={recording.busy} onClick={() => void recording.consent(false)}>Withdraw consent</button> : <button onClick={() => dialog.current?.showModal()}>Review recording consent</button>}
    {data?.consent.decision === 'declined' && <small>You declined. Capture is blocked until consent is resolved.</small>}
    {recording.statusError && <small>{recording.statusError}</small>}
    {recording.error && <small role="alert">{recording.error}</small>}
  </div><dialog ref={dialog} className="talk-recording-dialog" aria-labelledby="recording-consent-heading" onCancel={event => event.preventDefault()}><ConsentContent recording={recording} onLeave={onLeave} /></dialog></>;
}

export function PrejoinRecordingConsent({ meetingId }: { meetingId: string }) {
  const recording = useMeetingRecording(meetingId);
  const data = recording.data;
  if (!data?.active) return null;
  return <section className="talk-prejoin-recording" aria-labelledby="recording-prejoin-heading">{data.consent.decision === 'accepted' ? <><h2 id="recording-prejoin-heading">Recording consent accepted</h2><p>This meeting may capture {data.active.mode === 'audio' ? 'audio' : 'audio and video'} and create a speech transcript. You can withdraw consent at any time.</p><button className="signin-text-button" disabled={recording.busy} onClick={() => void recording.consent(false)}>Withdraw recording consent</button></> : <><ConsentContent recording={recording} prejoin />{data.consent.decision === 'declined' && <p className="talk-recording-warning" role="status">You declined recording. You cannot join while capture is active. Ask the host to stop recording.</p>}</>}</section>;
}
