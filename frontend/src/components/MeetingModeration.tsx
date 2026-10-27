import { useState } from 'react';
import { Hand, Lock, ShieldCheck, Unlock, UserMinus } from 'lucide-react';
import ReactionPicker from './ReactionPicker';
import { RecordingControls } from './MeetingRecording';
import type { MeetingRecording } from '../hooks/useMeetingRecording';
import { type ManagedParticipant, type MeetingManagement } from '../hooks/useMeetingManagement';

export function ParticipantActions({ member, management }: { member: ManagedParticipant; management: MeetingManagement }) {
  const [confirm, setConfirm] = useState(false);
  const host = management.data?.role === 'host';
  const moderator = host || management.data?.role === 'cohost';
  const allowed = moderator && member.role !== 'host' && (host || member.role !== 'cohost');
  if (!allowed) return null;
  return <details className="live-participant-actions"><summary aria-label={`Manage ${member.name}`}>Manage participant</summary><div>
    <button disabled={management.busy} onClick={() => void management.action('request_mute', member.accountId)}>Request microphone mute</button>
    <button disabled={management.busy} onClick={() => void management.action(member.canAudio ? 'restrict_audio' : 'restore_audio', member.accountId)}>{member.canAudio ? 'Disable microphone publishing' : 'Restore microphone permission'}</button>
    <button disabled={management.busy} onClick={() => void management.action(member.canVideo ? 'restrict_video' : 'restore_video', member.accountId)}>{member.canVideo ? 'Disable camera & screen publishing' : 'Restore camera & screen permission'}</button>
    {host && <button disabled={management.busy} onClick={() => void management.action(member.role === 'cohost' ? 'cohost_remove' : 'cohost_add', member.accountId)}>{member.role === 'cohost' ? 'Remove co-host role' : 'Make co-host'}</button>}
    {member.handAt && <button disabled={management.busy} onClick={() => void management.action('lower_hand', member.accountId)}>Lower raised hand</button>}
    {confirm ? <div className="live-confirm-action"><p>Remove {member.name}? Their account stays blocked until the creator authorizes it again.</p><button className="live-danger-text" disabled={management.busy} onClick={() => void management.action('remove', member.accountId)}>Confirm removal</button><button onClick={() => setConfirm(false)}>Cancel</button></div> : <button className="live-danger-text" onClick={() => setConfirm(true)}><UserMinus size={14} />Remove participant</button>}
  </div></details>;
}

export function WaitingRequests({ management }: { management: MeetingManagement }) {
  const data = management.data;
  if (!data || data.role === 'member') return null;
  const waiting = data.pending.filter(person => person.admission === 'pending');
  return <section className="live-admission-list" aria-label="Waiting room requests"><div><h3>Waiting room ({waiting.length})</h3>{waiting.length > 0 && <button disabled={management.busy} onClick={() => void management.action('admit_all')}>Admit All</button>}</div>
    {!waiting.length && <p className="live-panel-caption">No one is waiting.</p>}
    {waiting.sort((a, b) => a.requestedAt - b.requestedAt).map(person => <article key={person.accountId}><strong>{person.name}</strong><div><button disabled={management.busy} onClick={() => void management.action('admit', person.accountId)} aria-label={`Admit ${person.name}`}>Admit</button><button disabled={management.busy} onClick={() => void management.action('deny', person.accountId)} aria-label={`Deny ${person.name}`}>Deny</button></div></article>)}
    {data.role === 'host' && data.pending.some(person => person.admission !== 'pending') && <details><summary>Denied or removed accounts</summary>{data.pending.filter(person => person.admission !== 'pending').map(person => <article key={person.accountId}><strong>{person.name}<small>{person.admission}</small></strong><button disabled={management.busy} onClick={() => void management.action('reauthorize', person.accountId)} aria-label={`Authorize ${person.name} again`}>Authorize again</button></article>)}</details>}
  </section>;
}

export function RaisedHands({ management }: { management: MeetingManagement }) {
  const data = management.data;
  const hands = [...new Map(data?.members.filter(person => person.handAt).map(person => [person.accountId, person])).values()].sort((a, b) => a.handAt! - b.handAt! || a.accountId.localeCompare(b.accountId));
  if (!data || !hands.length) return null;
  return <section className="live-hand-queue" aria-label="Raised hands"><h3><Hand size={15} />Raised hands ({hands.length})</h3><ol>{hands.map(person => <li key={person.accountId}><span>{person.name}</span>{data?.role !== 'member' && (person.role !== 'host' || data.role === 'host') && (person.role !== 'cohost' || data.role === 'host') && <button disabled={management.busy} onClick={() => void management.action('lower_hand', person.accountId)} aria-label={`Lower ${person.name}'s hand`}>Lower hand</button>}</li>)}</ol></section>;
}

export function MeetingOptions({ management, recording, meetingId, connected, onNewMeeting }: { management: MeetingManagement; recording: MeetingRecording; meetingId: string; connected: boolean; onNewMeeting: () => Promise<void> }) {
  const [endConfirm, setEndConfirm] = useState(false);
  const data = management.data;
  return <div className="live-panel-body live-more-options"><h3>Reactions</h3><ReactionPicker management={management} connected={connected} />
    <p className="live-panel-caption">Reactions appear briefly for everyone. Up to five reactions every ten seconds.</p>
    <RecordingControls recording={recording} connected={connected} meetingId={meetingId} />
    {data?.role === 'host' && data.status === 'active' && <section aria-label="Host controls"><h3><ShieldCheck size={16} />Host controls</h3>
      <button className="secondary-button" disabled={management.busy} onClick={() => void management.action(data.locked ? 'unlock' : 'lock')}>{data.locked ? <Unlock size={16} /> : <Lock size={16} />}{data.locked ? 'Unlock meeting' : 'Lock meeting'}</button>
      <label className="live-approval-toggle"><input type="checkbox" checked={data.approvalRequired} disabled={management.busy} onChange={event => void management.action(event.target.checked ? 'approval_on' : 'approval_off')} />Require host approval for new participants</label>
      <p className="live-panel-caption">Lock blocks new accounts. Already admitted accounts can reconnect. Co-hosts can admit and manage participants; only you can change roles, access settings, or end the meeting.</p>
      {endConfirm ? <div className="live-confirm-action" role="group" aria-label="Confirm end meeting"><p>End this meeting for everyone? This link cannot be used to rejoin.</p><button className="leave-button" disabled={management.busy} onClick={() => void management.action('end')}>Confirm end for everyone</button><button className="secondary-button" onClick={() => setEndConfirm(false)}>Cancel</button></div> : <button className="leave-button" disabled={management.busy} onClick={() => setEndConfirm(true)}>End meeting for everyone</button>}
    </section>}
    <button className="secondary-button" disabled={!data || management.busy} onClick={() => void onNewMeeting()}>Create another meeting</button><p className="live-panel-caption">This creates a separate meeting owned by your Talk account and opens its existing pre-join screen.</p>
  </div>;
}
