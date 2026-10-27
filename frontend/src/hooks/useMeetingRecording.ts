import { useCallback, useEffect, useRef, useState } from 'react';
import type { Room, RemoteParticipant } from 'livekit-client';

export type RecordingMode = 'audio' | 'video';
export type RecordingStatus = 'awaiting_consent' | 'consenting' | 'starting' | 'recording' | 'stopping' | 'processing' | 'completed' | 'failed' | 'deleted';
export type RecordingState = {
  csrfToken: string;
  canManage: boolean;
  latest?: { id: string; status: RecordingStatus; error?: string } | null;
  lastFailure?: { id: string; error: string } | null;
  provider: { configured: boolean; name: string; pauseSupported: boolean; reason?: string };
  active: { id: string; mode: RecordingMode; language: string; status: RecordingStatus; createdAt: number; startedAt?: number; error?: string } | null;
  consent: { required: boolean; decision: 'pending' | 'accepted' | 'declined'; pending?: { accountId: string; name: string }[] };
};

export function useMeetingRecording(meetingId: string, room: Room | null = null) {
  const [data, setData] = useState<RecordingState | null>(null);
  const [error, setError] = useState('');
  const [statusError, setStatusError] = useState('');
  const [busy, setBusy] = useState(false);
  const current = useRef(data); current.current = data;
  const mounted = useRef(true), loading = useRef(false), writing = useRef(false);
  const refresh = useCallback(async () => {
    if (loading.current || !mounted.current) return;
    loading.current = true;
    try {
      const response = await fetch(`/api/auth/meetings/${encodeURIComponent(meetingId)}/recording-state`, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if ([401, 403, 404].includes(response.status)) {
        if (mounted.current) setStatusError(response.status === 401 ? 'Your session expired. Sign in again to manage recording.' : 'Recording status is unavailable for this meeting.');
        return;
      }
      const value = await response.json();
      if (!response.ok) throw new Error(value.message || 'Recording status is temporarily unavailable.');
      if (mounted.current) { setData(value); setStatusError(''); }
    } catch { if (mounted.current) setStatusError('Recording status could not update. Talk is retrying; any recording notice remains in effect.'); }
    finally { loading.current = false; }
  }, [meetingId]);
  useEffect(() => {
    mounted.current = true; void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => { mounted.current = false; window.clearInterval(timer); };
  }, [refresh]);
  useEffect(() => {
    if (!room) return;
    const notice = (_bytes: Uint8Array, sender?: RemoteParticipant, _kind?: unknown, topic?: string) => { if (!sender && ['talk.recording.v1', 'talk.moderation.v1'].includes(topic || '')) void refresh(); };
    let disposed = false, cleanup: (() => void) | undefined;
    void import('livekit-client').then(({ RoomEvent }) => {
      if (disposed) return;
      room.on(RoomEvent.DataReceived, notice).on(RoomEvent.ParticipantConnected, refresh).on(RoomEvent.ParticipantDisconnected, refresh);
      cleanup = () => { room.off(RoomEvent.DataReceived, notice).off(RoomEvent.ParticipantConnected, refresh).off(RoomEvent.ParticipantDisconnected, refresh); };
    });
    return () => { disposed = true; cleanup?.(); };
  }, [room, refresh]);
  const write = async (path: string, body: object = {}) => {
    if (writing.current) return false;
    writing.current = true; setBusy(true); setError('');
    try {
      const csrf = current.current?.csrfToken;
      if (!csrf) throw new Error('Recording controls are loading. Please try again.');
      const response = await fetch(`/api/auth/meetings/${encodeURIComponent(meetingId)}/recordings${path}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.message || 'The recording action could not be completed.');
      await refresh(); return true;
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : 'The recording action could not be completed.'); return false; }
    finally { writing.current = false; if (mounted.current) setBusy(false); }
  };
  return { data, error, statusError, busy, refresh, clearError: () => setError(''),
    request: (mode: RecordingMode, language: string, retentionDays: number) => write('/request', { mode, language, retentionDays }),
    consent: (accept: boolean) => current.current?.active ? write(`/${encodeURIComponent(current.current.active.id)}/consent`, { accept }) : Promise.resolve(false),
    start: () => current.current?.active ? write(`/${encodeURIComponent(current.current.active.id)}/start`) : Promise.resolve(false),
    stop: () => current.current?.active ? write(`/${encodeURIComponent(current.current.active.id)}/stop`) : Promise.resolve(false),
  };
}
export type MeetingRecording = ReturnType<typeof useMeetingRecording>;
