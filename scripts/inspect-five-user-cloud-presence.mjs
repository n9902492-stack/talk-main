// Read-only inspection of this isolated meeting only. Never creates a room/token.
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { RoomServiceClient } from 'livekit-server-sdk';
import { fiveUserConfiguration } from '../backend/src/five-user-test.mjs';
const launch = JSON.parse(fs.readFileSync('artifacts/qa/five-user-public-launch.json')), state = JSON.parse(fs.readFileSync(launch.serverState));
const config = fiveUserConfiguration(launch.root, state.origin, launch.directory), db = new DatabaseSync(launch.databasePath, { readOnly: true });
const report = { checkedAt: new Date().toISOString(), cloudAuthenticatedApi: 'NOT_TESTED', actualExternalMedia: 'NOT_TESTED', screenSharing: 'NOT_TESTED', deviceObservations: [], roomsCreated: 0, tokensIssuedByThisCheck: 0 };
try {
  const meeting = db.prepare('SELECT room_name,status,approval_required FROM talk_meetings WHERE id=?').get(launch.meetingId);
  const admin = new RoomServiceClient(config.environment.LIVEKIT_URL.replace('wss:', 'https:'), config.environment.LIVEKIT_API_KEY, config.environment.LIVEKIT_API_SECRET, { requestTimeout: 8, failover: false });
  const rooms = await admin.listRooms([meeting.room_name]); report.cloudAuthenticatedApi = 'PASS'; report.meetingActive = meeting.status === 'active'; report.admissionRequired = Boolean(meeting.approval_required); report.sfuRoomExists = rooms.length === 1;
  const participants = rooms.length ? await admin.listParticipants(meeting.room_name) : [];
  report.connectedParticipantCount = participants.length;
  report.publishedTracks = participants.reduce((r, p) => { for (const track of p.tracks) { if (track.source === 1 && !track.muted) r.camera++; if (track.source === 2 && !track.muted) r.microphone++; if (track.source === 3 && !track.muted) r.screen++; } return r; }, { camera: 0, microphone: 0, screen: 0 });
  report.note = 'Server presence/track counts do not prove device reception, playback or external-device interoperability. Record those manually.';
} catch { report.cloudAuthenticatedApi = 'FAIL'; process.exitCode = 1; }
finally { db.close(); fs.writeFileSync('artifacts/qa/five-user-real-cloud-presence.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); }
