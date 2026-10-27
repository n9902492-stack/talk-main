import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';

// Phase 1 has one explicitly authorized, signed-in workspace meeting.
// Arbitrary room names from browser requests never become LiveKit grants.
export const workspaceMeeting = Object.freeze({
  id: 'talk-workshop',
  title: 'Social Media Marketing Workshop',
  roomName: 'talk-workshop',
  access: 'authenticated',
});

export function validMeetingName(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 80
    && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
}

export function createMeetingService(env = {}) {
  let configuration = { url: env.LIVEKIT_URL, apiKey: env.LIVEKIT_API_KEY, apiSecret: env.LIVEKIT_API_SECRET };
  // The local helper writes random credentials to ignored data/, never to Vite.
  // Explicit environment configuration takes precedence; production never reads it.
  if (env.NODE_ENV !== 'production' && !Object.values(configuration).some(Boolean)) {
    try { configuration = JSON.parse(readFileSync(new URL('../../data/livekit-local.json', import.meta.url), 'utf8')); }
    catch { /* A missing local server is reported as unavailable, without breaking auth. */ }
  }
  let configured = false, signalUrl = null;
  try {
    const url = new URL(configuration.url);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    configured = !url.username && !url.password && !url.search && !url.hash && (url.pathname === '/' || !url.pathname)
      && (url.protocol === 'wss:' || env.NODE_ENV !== 'production' && local && url.protocol === 'ws:')
      && typeof configuration.apiKey === 'string' && configuration.apiKey.length >= 6
      && typeof configuration.apiSecret === 'string' && configuration.apiSecret.length >= 32;
  } catch { /* Do not expose URLs or credentials in configuration errors. */ }
  if (env.MEETING_SIGNAL_URL) {
    try {
      const gateway = new URL(env.MEETING_SIGNAL_URL);
      if (gateway.username || gateway.password || gateway.search || gateway.hash || gateway.pathname !== '/api/auth/meeting-signal'
        || !(gateway.protocol === 'wss:' || env.NODE_ENV !== 'production' && gateway.protocol === 'ws:' && ['localhost', '127.0.0.1', '[::1]'].includes(gateway.hostname))) throw new Error('Invalid gateway');
      signalUrl = gateway.toString();
    } catch { configured = false; }
  }
  if (env.NODE_ENV === 'production' && !signalUrl) configured = false;
  return {
    configured,
    signalUrl,
    meeting: workspaceMeeting,
    admin: configured ? new RoomServiceClient(configuration.url.replace(/^ws/, 'http'), configuration.apiKey, configuration.apiSecret, { requestTimeout: 5 }) : null,
    upstreamUrl: configured ? configuration.url : null,
    async issueRecordingToken(identity, roomName) {
      if (!configured || !/^rec_[a-f\d-]{36}$/.test(identity) || !/^talk-[a-f\d-]{36}$/.test(roomName)) throw new Error('Recording access unavailable.');
      const access = new AccessToken(configuration.apiKey, configuration.apiSecret, { identity, name: 'Talk Recording', ttl: '5m' });
      access.addGrant({ roomJoin: true, room: roomName, canSubscribe: true, canPublish: false, canPublishData: false, canUpdateOwnMetadata: false, roomAdmin: false, roomRecord: false });
      return { token: await access.toJwt(), serverUrl: configuration.url };
    },
    async issueToken(accountId, displayName, options = {}) {
      if (!configured || !accountId || !validMeetingName(displayName)) throw new Error('Meeting access is unavailable.');
      const account = createHash('sha256').update(accountId).digest('hex').slice(0, 24);
      const identity = options.identity || `talk_${account}_${randomUUID()}`;
      const access = new AccessToken(configuration.apiKey, configuration.apiSecret, {
        identity, name: displayName.trim(), ttl: '5m',
      });
      const sources = [options.canAudio !== false && TrackSource.MICROPHONE, options.canVideo !== false && TrackSource.CAMERA,
        options.canVideo !== false && TrackSource.SCREEN_SHARE, options.canAudio !== false && options.canVideo !== false && TrackSource.SCREEN_SHARE_AUDIO].filter(Boolean);
      access.addGrant({ roomJoin: true, room: options.roomName || workspaceMeeting.roomName, canSubscribe: true,
        canPublish: sources.length > 0, canPublishSources: sources, canPublishData: true,
        canUpdateOwnMetadata: false, roomAdmin: false, roomCreate: false, roomList: false, roomRecord: false });
      return { token: await access.toJwt(), serverUrl: configuration.url, identity,
        meeting: { id: workspaceMeeting.id, title: workspaceMeeting.title }, expiresIn: 300 };
    },
  };
}
