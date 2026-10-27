import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createAuthApp } from '../backend/src/auth.mjs';
import { openPostgresDatabase } from '../backend/src/postgres-database.mjs';
import { createMeetingService } from '../backend/src/meetings.mjs';
import { createRecordingStorage } from '../backend/src/recording-storage.mjs';

// This guard accepts only the runner's disposable loopback database. It never
// reads .env, connects to a cloud database, sends email/SMS, or invokes Whisper.
const enabled = process.env.TALK_POSTGRES_TEST === '1' && process.env.PGHOST === '127.0.0.1' && process.env.PGDATABASE === 'talk_auth_test';
const origin = 'https://talk-fc3dc.web.app', clientId = 'talk-recordings-pg-fixture.apps.googleusercontent.com';

test('real PostgreSQL recording persistence, authorization, detached finalization and restart recovery (media/STT fixtures)', { skip: !enabled }, async t => {
  const directory = path.resolve('artifacts/qa/recordings-postgres-' + randomUUID());
  const cookieSecret = randomBytes(32).toString('base64url');
  let database, app, server, base, now = Date.now(), releaseStop;
  const peers = new Map(), captureCalls = [];
  const service = createMeetingService({ NODE_ENV: 'development', LIVEKIT_URL: 'ws://127.0.0.1:7880', LIVEKIT_API_KEY: 'pg-recording-fixture', LIVEKIT_API_SECRET: 'pg-recording-fixture-secret-at-least-32-chars' });
  service.admin = { listParticipants: async room => peers.get(room) || [], sendData: async () => {}, updateParticipant: async () => {}, deleteRoom: async room => peers.delete(room), removeParticipant: async (room, identity) => peers.set(room, (peers.get(room) || []).filter(peer => peer.identity !== identity)) };
  const storage = createRecordingStorage({ RECORDING_LOCAL_PATH: directory });
  let stopBarrier = Promise.resolve();
  const runtime = { configured: true, name: 'PostgreSQL persistence fixture (not real capture)', pauseSupported: false, transcriptionDelayMs: 0, storage,
    recorder: { async start(options) { captureCalls.push(options); await fs.writeFile(options.outputPath, 'POSTGRES-PERSISTENCE-MEDIA-FIXTURE'); return { async setAllowed() {}, async abort() {}, async stop() { await stopBarrier; return { path: options.outputPath, mimeType: 'audio/webm', durationMs: 5000 }; } }; } },
    transcriber: { configured: true, async transcribe() { return { language: 'hi', segments: [{ start: 1, end: 3, text: 'PostgreSQL transcript fixture — नमस्ते', speaker: null }] }; } },
  };
  async function closeBackend() {
    if (app) await app.locals.closeAuthDatabase();
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (database) await database.close();
    app = server = database = undefined;
  }
  async function openBackend() {
    database = await openPostgresDatabase(process.env, { migrate: true });
    app = createAuthApp({ database, clientId, origins: [origin], secureCookies: true, cookieMode: 'hosting', cookieSecret, now: () => now, meetings: service, recordings: runtime, verifyCredential: async value => JSON.parse(value) });
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}/api/auth/`;
  }
  const sql = (query, ...params) => database.withContext(() => database.prepare(query).get(...params));
  const all = (query, ...params) => database.withContext(() => database.prepare(query).all(...params));
  const run = (query, ...params) => database.withContext(() => database.prepare(query).run(...params));
  const tick = () => app.locals.recordings.tick();
  const wait = async predicate => { for (let i = 0; i < 150; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 40)); } assert.fail('PostgreSQL fixture background processing did not finish.'); };
  async function account(name) {
    const jar = new Map(); let csrf = '';
    const raw = async (route, body, extraHeaders = {}) => {
      const response = await fetch(base + route, { signal: AbortSignal.timeout(15000), method: body === undefined ? 'GET' : 'POST', headers: { Cookie: [...jar].map(([key, value]) => key + '=' + value).join('; '), ...(body === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }), ...extraHeaders }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      for (const cookie of response.headers.getSetCookie()) {
        const [key, value] = cookie.split(';')[0].split('=');
        assert.equal(key, '__session'); assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=Lax/);
        if (value) jar.set(key, value); else jar.delete(key);
      }
      return response;
    };
    const request = async (...args) => { const response = await raw(...args); return { status: response.status, body: await response.json() }; };
    const config = (await request('config')).body; csrf = config.csrfToken;
    const seconds = Math.floor(now / 1000), identity = 'pg-recording-' + name.replace(/[^a-z0-9]/gi, '').toLowerCase() + '-' + randomUUID();
    const signed = await request('google', { credential: JSON.stringify({ iss: 'https://accounts.google.com', aud: clientId, sub: identity, name, email: identity + '@example.test', email_verified: true, nonce: config.nonce, iat: seconds, exp: seconds + 3600 }) });
    assert.equal(signed.status, 200); csrf = signed.body.csrfToken;
    assert.equal((await request('google/confirm', {})).status, 200);
    return { id: signed.body.user.id, raw, request };
  }
  await openBackend();
  t.after(async () => { releaseStop?.(); await closeBackend(); if (directory.startsWith(path.resolve('artifacts/qa') + path.sep)) await fs.rm(directory, { recursive: true, force: true }); });
  const host = await account('PG Recording Host'), member = await account('PG Recording Member'), outsider = await account('PG Recording Outsider');
  const created = await host.request('meetings', { title: 'PostgreSQL private recording integration', approvalRequired: false });
  assert.equal(created.status, 201);
  const meetingId = created.body.meeting.id, prefix = `meetings/${meetingId}/recordings`;
  const roomName = (await sql('SELECT room_name FROM talk_meetings WHERE id=?', meetingId)).room_name;
  async function join(person, name) { const result = await person.request(`meetings/${meetingId}/token`, { displayName: name }); assert.equal(result.status, 200); peers.set(roomName, [...(peers.get(roomName) || []), { identity: result.body.identity, permission: { canPublish: true, canSubscribe: true, canPublishData: true, canPublishSources: [1, 2, 3, 4] } }]); }
  await join(host, 'PG Host'); await join(member, 'PG Member');
  let completedId, completedKey;
  await t.test('recording migrations, host authorization and required consent use actual PostgreSQL rows', async () => {
    const migrated = await sql("SELECT version FROM schema_migrations WHERE version='005_meeting_recordings.sql'"); assert.ok(migrated);
    assert.equal((await member.request(prefix + '/request', { mode: 'audio', language: 'hi' })).status, 404);
    const request = await host.request(prefix + '/request', { mode: 'audio', language: 'hi', retentionDays: 7 }); assert.equal(request.status, 202); completedId = request.body.id;
    assert.equal((await host.request(`${prefix}/${completedId}/start`, {})).status, 409); assert.equal(captureCalls.length, 0);
    assert.equal((await host.request(`${prefix}/${completedId}/consent`, { accept: true })).status, 202);
    assert.equal((await member.request(`${prefix}/${completedId}/consent`, { accept: true })).status, 202);
    assert.equal((await sql("SELECT COUNT(*) AS n FROM talk_recording_consents WHERE recording_id=? AND decision='accepted'", completedId)).n, 2);
    assert.equal((await host.request(`${prefix}/${completedId}/start`, {})).status, 202);
    await wait(async () => (await sql('SELECT status FROM talk_recordings WHERE id=?', completedId)).status === 'recording');
    assert.equal(captureCalls[0].allowedIdentities.length, 2);
  });
  await t.test('Stop returns202 before encoder release; completion, transcription and private downloads persist', async () => {
    stopBarrier = new Promise(resolve => { releaseStop = resolve; });
    const response = await host.request(`${prefix}/${completedId}/stop`, {}); assert.equal(response.status, 202);
    assert.equal((await sql('SELECT status FROM talk_recordings WHERE id=?', completedId)).status, 'stopping');
    releaseStop(); stopBarrier = Promise.resolve();
    await wait(async () => (await sql('SELECT status FROM talk_recordings WHERE id=?', completedId)).status === 'completed');
    completedKey = (await sql('SELECT storage_key FROM talk_recordings WHERE id=?', completedId)).storage_key;
    await tick(); await wait(async () => (await sql('SELECT transcript_status FROM talk_recordings WHERE id=?', completedId)).transcript_status === 'completed');
    assert.equal((await sql("SELECT status FROM talk_recording_jobs WHERE recording_id=? AND kind='transcribe'", completedId)).status, 'completed');
    assert.equal((await sql('SELECT COUNT(*) AS n FROM talk_transcript_segments WHERE recording_id=?', completedId)).n, 1);
    const transcript = (await host.request(`recordings/${completedId}/transcript`)).body;
    assert.equal(transcript.language, 'hi'); assert.equal(transcript.segments[0].speaker, null); assert.match(transcript.segments[0].text, /नमस्ते/);
    const range = await host.raw(`recordings/${completedId}/playback`, undefined, { Range: 'bytes=0-7' }); assert.equal(range.status, 206); assert.equal((await range.arrayBuffer()).byteLength, 8); assert.match(range.headers.get('cache-control'), /private, no-store/);
    assert.equal((await member.raw(`recordings/${completedId}/playback`)).status, 404);
    assert.equal((await outsider.raw(`recordings/${completedId}/transcript.txt`)).status, 404);
    const txt = await host.raw(`recordings/${completedId}/transcript.txt`); assert.equal(txt.status, 200); assert.match(await txt.text(), /00:00:01.*00:00:03/);
    assert.equal((await host.request(`meetings/${meetingId}/actions`, { action: 'cohost_add', target: member.id })).status, 200);
    assert.equal((await member.request(`meeting-history/${meetingId}`)).status, 200);
    assert.equal((await host.request(`meetings/${meetingId}/actions`, { action: 'cohost_remove', target: member.id })).status, 200);
    assert.equal((await member.raw(`recordings/${completedId}/playback`)).status, 404);
    assert.equal((await sql("SELECT COUNT(*) AS n FROM talk_recording_events WHERE recording_id=? AND action='capture_completed'", completedId)).n, 1);
  });
  await t.test('fresh app and pool recover existing sessions, private history, unfinished capture and abandoned speech jobs', async () => {
    const capture = (await host.request(prefix + '/request', { mode: 'audio', language: 'en', retentionDays: 7 })).body.id;
    const partial = await storage.allocate(capture); await fs.writeFile(partial, 'UNFINISHED-PG-CAPTURE-FIXTURE');
    await run("UPDATE talk_recordings SET status='processing',worker_id='terminated-backend',lease_expires_at=NULL,output_path=? WHERE id=?", partial, capture);
    const speech = (await host.request(prefix + '/request', { mode: 'audio', language: 'hi', retentionDays: 7 })).body.id;
    const output = await storage.allocate(speech); await fs.writeFile(output, 'SAVED-PG-SPEECH-FIXTURE'); const saved = await storage.commit(speech, { path: output, mimeType: 'audio/webm' });
    await run("UPDATE talk_recordings SET status='completed',storage_key=?,mime_type='audio/webm',duration_ms=5000,transcript_status='processing' WHERE id=?", saved.key, speech);
    await run("INSERT INTO talk_recording_jobs(id,recording_id,kind,status,attempts,next_run_at,lease_owner,lease_expires_at,created_at,updated_at) VALUES (?,?,'transcribe','running',1,1,'terminated-backend',NULL,1,1)", randomUUID(), speech);
    await closeBackend(); await openBackend();
    assert.equal((await host.request('session')).body.user.id, host.id);
    assert.ok((await host.request('meeting-history')).body.meetings.some(meeting => meeting.id === meetingId));
    assert.equal((await host.raw(`recordings/${completedId}/playback`)).status, 200);
    await tick();
    assert.equal((await sql('SELECT status FROM talk_recordings WHERE id=?', capture)).status, 'failed'); await assert.rejects(fs.stat(partial));
    await wait(async () => (await sql("SELECT status FROM talk_recording_jobs WHERE recording_id=? AND kind='delete'", capture))?.status === 'completed');
    await tick(); await wait(async () => (await sql('SELECT transcript_status FROM talk_recordings WHERE id=?', speech)).transcript_status === 'completed');
    assert.equal((await sql('SELECT attempts FROM talk_recording_jobs WHERE recording_id=?', speech)).attempts, 2);
    assert.equal((await sql('SELECT COUNT(*) AS n FROM talk_transcript_segments WHERE recording_id=?', speech)).n, 1);
  });
  await t.test('retention and explicit deletion revoke access immediately and durably clean private media and transcript rows', async () => {
    const toExpire = (await all("SELECT id,storage_key FROM talk_recordings WHERE meeting_id=? AND status='completed' AND id<>?", meetingId, completedId))[0];
    await run('UPDATE talk_recordings SET expires_at=? WHERE id=?', now - 1, toExpire.id);
    assert.equal((await host.raw(`recordings/${toExpire.id}/playback`)).status, 404);
    await tick(); await wait(async () => !await storage.exists(toExpire.storage_key));
    assert.equal((await sql('SELECT status FROM talk_recordings WHERE id=?', toExpire.id)).status, 'deleted');
    assert.equal((await sql("SELECT COUNT(*) AS n FROM talk_recording_events WHERE recording_id=? AND action='retention_expired'", toExpire.id)).n, 1);
    assert.equal((await host.request(`recordings/${completedId}/delete`, {})).status, 202);
    assert.equal((await host.raw(`recordings/${completedId}/transcript.txt`)).status, 404);
    await tick(); await wait(async () => !await storage.exists(completedKey));
    assert.equal((await sql('SELECT COUNT(*) AS n FROM talk_transcript_segments WHERE recording_id=?', completedId)).n, 0);
    assert.equal((await sql("SELECT COUNT(*) AS n FROM talk_recording_events WHERE recording_id=? AND action='deleted'", completedId)).n, 1);
  });
});
