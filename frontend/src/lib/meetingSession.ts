import {meetingEndpoint} from './scheduling';
export const defaultMeetingId = 'talk-workshop';
export type MeetingPreferences = { roomId: string; displayName: string; cameraId: string; micId: string; speakerId?: string; cameraOn: boolean; micOn: boolean };
export type MeetingAccess = { token?: string; serverUrl?: string; identity?: string; meeting: { id: string; title: string }; expiresIn?: number; joinState?: 'waiting' | 'not_created'; canAudio?: boolean; canVideo?: boolean };
type PendingJoin = { access: MeetingAccess; preferences: MeetingPreferences; stream: MediaStream | null; createdAt: number };
const preferencesKey = 'talk-meeting-preferences';
let pendingJoin: PendingJoin | null = null;
let pendingTimer: number | undefined;

export function clearPendingMeetingJoin() {
  if (pendingTimer) window.clearTimeout(pendingTimer);
  pendingTimer = undefined;
  pendingJoin?.stream?.getTracks().forEach(track => track.stop());
  pendingJoin = null;
}

export class MeetingAccessError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export function meetingIdFromUrl() {
  return new URLSearchParams(window.location.search).get('room') || defaultMeetingId;
}

export function saveMeetingPreferences(preferences: MeetingPreferences) {
  try { sessionStorage.setItem(preferencesKey, JSON.stringify(preferences)); } catch { /* Joining still works with in-memory preferences. */ }
}

export function readMeetingPreferences(roomId: string): MeetingPreferences | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(preferencesKey) || 'null');
    return value?.roomId === roomId && typeof value.displayName === 'string' && value.displayName.trim().length > 0 && value.displayName.length <= 80
      && typeof value.cameraId === 'string' && typeof value.micId === 'string' && typeof value.cameraOn === 'boolean' && typeof value.micOn === 'boolean' ? value : null;
  } catch { return null; }
}

export function stageMeetingJoin(access: MeetingAccess, preferences: MeetingPreferences, stream: MediaStream | null) {
  clearPendingMeetingJoin();
  pendingJoin = { access, preferences, stream, createdAt: Date.now() };
  pendingTimer = window.setTimeout(clearPendingMeetingJoin, 30000);
  saveMeetingPreferences(preferences);
}

export function takeMeetingJoin(roomId: string) {
  if (pendingTimer) window.clearTimeout(pendingTimer);
  pendingTimer = undefined;
  const value = pendingJoin;
  pendingJoin = null;
  if (!value) return null;
  if (value.preferences.roomId === roomId && Date.now() - value.createdAt < 30000) return value;
  value.stream?.getTracks().forEach(track => track.stop());
  return null;
}

export function navigateToMeeting(path: string) {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export async function createTalkMeeting(settings?: { title?: string; approvalRequired?: boolean }) {
  const sessionResponse = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(10000) });
  const session = await sessionResponse.json();
  if (!sessionResponse.ok || !session.user || session.requiresConfirmation || !session.csrfToken) throw new Error('Sign in to Talk before creating a meeting.');
  const response = await fetch('/api/auth/meetings', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken }, body: JSON.stringify(settings || {}), signal: AbortSignal.timeout(15000) });
  const result = await response.json();
  if (!response.ok || typeof result.meeting?.id !== 'string') throw new Error(result.message || 'Could not create the meeting. Please try again.');
  return result.meeting as { id: string; title: string };
}

export async function requestMeetingAccess(roomId: string, displayName: string, signal?: AbortSignal): Promise<MeetingAccess> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = window.setTimeout(abort, 15000);
  async function readResponse(response: Response) {
    let data;
    try { data = await response.json(); } catch { throw new MeetingAccessError('unavailable', 'Talk could not reach the meeting service. Please try again.'); }
    if (!response.ok) throw new MeetingAccessError(data.error || 'unavailable', data.message || 'Talk could not join this meeting. Please try again.');
    return data;
  }
  try {
    const endpoint = meetingEndpoint(roomId);
    const details = await readResponse(await fetch(endpoint, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal }));
    if (!details.configured) throw new MeetingAccessError('meeting_not_configured', 'The meeting server is not configured yet. Please try again later.');
    const access = await readResponse(await fetch(`${endpoint}/token`, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': details.csrfToken }, body: JSON.stringify({ displayName }),
    }));
    if (access.meeting?.id !== roomId || (!['waiting', 'not_created'].includes(access.joinState) && (typeof access.token !== 'string' || !access.token || typeof access.serverUrl !== 'string' || !access.identity))) throw new MeetingAccessError('unavailable', 'Talk could not prepare a secure meeting connection. Please try again.');
    return access;
  } catch (error) {
    if (error instanceof MeetingAccessError) throw error;
    throw new MeetingAccessError('connection_failed', 'Could not connect to Talk. Check your connection and try again.');
  } finally { window.clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
}
