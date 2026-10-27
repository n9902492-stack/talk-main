import { useCallback, useEffect, useRef, useState } from 'react';
import { RoomEvent, type Room, type RemoteParticipant } from 'livekit-client';
import type { AvatarSelection } from '../lib/avatars';
import {guestMeeting,meetingEndpoint,schedulingBase} from '../lib/scheduling';
export { reactionChoices } from '../lib/reactionCatalog';

export type MeetingRole = 'host' | 'cohost' | 'member';
export type ManagedParticipant = { identity: string; accountId: string; name: string; avatar?: AvatarSelection; role: MeetingRole; handAt: number | null; canAudio: boolean; canVideo: boolean };
export type MeetingManagementState = {
  serverTime?: number; receivedAt?: number;
  participantSync?: 'live' | 'unavailable';
  meeting: { id: string; title: string }; status: 'active' | 'ended' | 'not_created'; role: MeetingRole;
  admission: 'new' | 'pending' | 'admitted' | 'denied' | 'removed'; locked: boolean; approvalRequired: boolean;
  canAudio: boolean; canVideo: boolean; handAt: number | null; muteRequestedAt: number; csrfToken: string;
  members: ManagedParticipant[];
  pending: { accountId: string; name: string; admission: string; requestedAt: number }[];
  reactions: { id: string; accountId: string; emoji: string; at: number }[];
};

export function useMeetingManagement(roomId: string, room: Room | null) {
  const [data, setData] = useState<MeetingManagementState | null>(null);
  const [error, setError] = useState('');
  const [refreshError, setRefreshError] = useState('');
  const [busy, setBusy] = useState(false);
  const active = useRef(false), generation = useRef(0);
  const currentRoom = useRef(roomId); currentRoom.current = roomId;
  const loading = useRef<{ controller: AbortController; generation: number } | null>(null);
  const writing = useRef<object | null>(null);
  const state = useRef(data); state.current = data;
  const refresh = useCallback(async () => {
    if (!active.current || currentRoom.current !== roomId || loading.current?.generation === generation.current) return;
    const request = { controller: new AbortController(), generation: generation.current };
    loading.current = request;
    const isCurrent = () => active.current && currentRoom.current === roomId && generation.current === request.generation;
    const timeout = window.setTimeout(() => request.controller.abort(), 10000);
    try {
      const response = await fetch(`${meetingEndpoint(roomId)}/state`, { credentials: 'same-origin', cache: 'no-store', signal: request.controller.signal });
      const value = await response.json();
      if (!response.ok || value?.meeting?.id !== roomId) throw new Error('Meeting controls are temporarily unavailable.');
      if (isCurrent()) { setData({ ...value, receivedAt: Date.now() }); setRefreshError(''); }
    } catch {
      // Keep the last trusted snapshot, but make stale admission information visible.
      // A successful refresh must not dismiss an unrelated moderation-action error.
      if (isCurrent()) setRefreshError('Meeting controls could not refresh. Waiting-room and participant status may be out of date. Please retry.');
    } finally {
      window.clearTimeout(timeout);
      if (loading.current === request) loading.current = null;
    }
  }, [roomId]);
  useEffect(() => {
    const currentGeneration = ++generation.current;
    active.current = true; state.current = null; writing.current = null;
    setData(null); setError(''); setRefreshError(''); setBusy(false);
    void refresh();
    const interval = window.setInterval(() => { void refresh(); }, 2000);
    return () => {
      if (generation.current === currentGeneration) active.current = false;
      if (loading.current?.generation === currentGeneration) loading.current.controller.abort();
      window.clearInterval(interval);
    };
  }, [refresh]);
  useEffect(() => {
    if (!room) return;
    const notice = (_bytes: Uint8Array, sender?: RemoteParticipant, _kind?: unknown, topic?: string) => { if (!sender && topic === 'talk.moderation.v1') void refresh(); };
    room.on(RoomEvent.DataReceived, notice).on(RoomEvent.ParticipantConnected, refresh).on(RoomEvent.ParticipantDisconnected, refresh);
    return () => { room.off(RoomEvent.DataReceived, notice).off(RoomEvent.ParticipantConnected, refresh).off(RoomEvent.ParticipantDisconnected, refresh); };
  }, [room, refresh]);
  const write = async (path: string, body: object) => {
    if (writing.current || !active.current || currentRoom.current !== roomId) return null;
    const request = {}, currentGeneration = generation.current;
    const isCurrent = () => active.current && currentRoom.current === roomId && generation.current === currentGeneration;
    writing.current = request; setBusy(true); setError('');
    try {
      const csrf = state.current?.csrfToken;
      if (!csrf) throw new Error('Meeting controls are loading. Try again in a moment.');
      const response = await fetch(`${guestMeeting()?schedulingBase+'/guest/meetings':'/api/auth/meetings'}${path}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.message || 'The meeting action could not be completed.');
      if (!isCurrent()) return null;
      await refresh(); return isCurrent() ? value : null;
    } catch (failure) { if (isCurrent()) setError(failure instanceof Error ? failure.message : 'The action could not be completed. Try again.'); return null; }
    finally { if (writing.current === request) { writing.current = null; if (isCurrent()) setBusy(false); } }
  };
  return { data, error, refreshError, busy, refresh, action: (action: string, target?: string, extra: object = {}) => write(`/${encodeURIComponent(roomId)}/actions`, { action, ...(target ? { target } : {}), ...extra }),
    create: () => write(`/${encodeURIComponent(roomId)}/create`, {}), newMeeting: () => write('', {}), clearError: () => setError('') };
}
export type MeetingManagement = ReturnType<typeof useMeetingManagement>;
