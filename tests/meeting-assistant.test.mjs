import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createAuthApp } from '../backend/src/auth.mjs';
import { openAuthDatabase } from '../backend/src/database.mjs';
import { createMeetingService } from '../backend/src/meetings.mjs';
import { asyncDatabase } from '../backend/src/async-database.mjs';
import { createMeetingManagement } from '../backend/src/meeting-management.mjs';
import { createMeetingAssistant } from '../backend/src/meeting-assistant.mjs';

const reportContent = sources => ({
  schemaVersion: 1, summary: [], topics: [], employeeUpdates: [], completedWork: [], workInProgress: [],
  blockers: [{ id: 'migration-blocked', text: 'The migration is blocked.', speaker: null, owner: null, deadline: null, uncertainty: [], evidence: [{ recordingId: sources[0].recordingId, revisionId: sources[0].id ?? sources[0].revisionId, segmentId: '0', startMs: 0, endMs: 4000, quote: 'The migration is blocked.' }] }],
  risks: [], decisions: [], actionItems: [], followUpNotes: [],
});
const fixtureProvider = generate => ({ configured: true, modelDigest: 'fixture-local-model', generate });

// Every identity, transcript and provider in these tests is an isolated fixture.
// No private environment, real email, Ollama or external provider is used.
async function harness({ provider, assistant, persistent = false, ...workerOptions } = {}) {
  const directory = path.resolve('artifacts/qa', `assistant-unit-${randomUUID()}`);
  await fs.mkdir(directory, { recursive: true });
  const databasePath = path.join(directory, 'auth.sqlite');
  const database = openAuthDatabase(persistent ? databasePath : ':memory:');
  const adapter = asyncDatabase(database);
  let timestamp = Date.now();
  const now = () => timestamp;
  const service = createMeetingService({ NODE_ENV: 'development', LIVEKIT_URL: 'ws://127.0.0.1:7880', LIVEKIT_API_KEY: 'assistant-test-key', LIVEKIT_API_SECRET: 'assistant-unit-secret-not-real-at-least-32' });
  service.admin = { listParticipants: async () => [], sendData: async () => {}, removeParticipant: async () => {}, updateParticipant: async () => {}, deleteRoom: async () => {} };
  const origin = 'http://localhost:3001';
  const app = createAuthApp({ clientId: 'assistant-test.apps.googleusercontent.com', origins: [origin], database, now, meetings: service, assistant: assistant === false ? false : { provider, ...workerOptions }, verifyCredential: async value => JSON.parse(value) });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/auth/`;
  async function account(name) {
    const jar = new Map(); let csrf = '';
    async function raw(route, body, headers = {}) {
      const response = await fetch(base + route, { signal: AbortSignal.timeout(10000), method: body === undefined ? 'GET' : 'POST', headers: { Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join('; '), ...(body === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      for (const cookie of response.headers.getSetCookie()) { const [key, value] = cookie.split(';')[0].split('='); jar.set(key, value); }
      return response;
    }
    async function request(...args) { const response = await raw(...args); return { status: response.status, body: await response.json() }; }
    const config = (await request('config')).body, seconds = Math.floor(now() / 1000);
    csrf = config.csrfToken;
    const login = await request('google', { credential: JSON.stringify({ iss: 'https://accounts.google.com', aud: 'assistant-test.apps.googleusercontent.com', sub: name, name, email: `${name.toLowerCase()}@example.test`, email_verified: true, nonce: config.nonce, iat: seconds, exp: seconds + 3600 }) });
    assert.equal(login.status, 200);
    csrf = login.body.csrfToken;
    assert.equal((await request('google/confirm', {})).status, 200);
    return { id: login.body.user.id, raw, request };
  }
  async function setup({ recordingConsents = true } = {}) {
    const host = await account('Host'), member = await account('Member'), outsider = await account('Outsider');
    assert.equal((await host.request('meetings/talk-workshop/create', { approvalRequired: false })).status, 201);
    assert.equal((await member.request('meetings/talk-workshop/token', { displayName: 'Member' })).status, 200);
    const recordingId = randomUUID();
    database.prepare("INSERT INTO talk_recordings(id,meeting_id,requested_by,mode,language,status,created_at,recorder_identity,expires_at,duration_ms,transcript_status,transcript_language) VALUES (?,'talk-workshop',?,'audio','en','completed',?,?,?,10000,'completed','en')").run(recordingId, host.id, now(), `rec_${recordingId}`, now() + 86400000);
    database.prepare('INSERT INTO talk_transcript_segments(recording_id,segment_index,start_ms,end_ms,text,speaker,language) VALUES (?,0,0,4000,?,NULL,?)').run(recordingId, 'The migration is blocked. We need a follow-up review.', 'en');
    if (recordingConsents) for (const person of [host, member]) database.prepare("INSERT INTO talk_recording_consents(recording_id,account_id,decision,decided_at,notice_version) VALUES (?,?,'accepted',?,'talk-recording-v1')").run(recordingId, person.id, now());
    const transcript = await host.request(`recordings/${recordingId}/transcript`);
    assert.equal(transcript.status, 200);
    assert.ok(transcript.body.revision?.id);
    return { host, member, outsider, recordingId, revision: transcript.body.revision, transcript: transcript.body };
  }
  async function consent(person, recordingId, revisionId, decision = 'accepted', extra = {}) { return person.request(`recordings/${recordingId}/ai-consent`, { revisionId, noticeVersion: 'talk-ai-v1', decision, ...extra }); }
  async function ready(fixture) { for (const person of [fixture.host, fixture.member]) assert.equal((await consent(person, fixture.recordingId, fixture.revision.id)).status, 200); }
  async function create(fixture) { const result = await fixture.host.request('meetings/talk-workshop/ai-reports', { recordingIds: [fixture.recordingId] }); assert.equal(result.status, 201, JSON.stringify(result.body)); return result.body.report; }
  return { account, setup, ready, create, consent, database, databasePath, adapter, app, service, now, anonymous: route => fetch(base + route), advance: milliseconds => { timestamp += milliseconds; }, tick: () => app.locals.assistant.tick(), close: async () => { await app.locals.closeAuthDatabase(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); database.close(); await fs.rm(directory, { recursive: true, force: true }); } };
}

test('AI foundation is opt-out without exposing routes in the separate temporary runtime', async t => {
  const h = await harness({ assistant: false }); t.after(h.close);
  const host = await h.account('Host');
  const response = await host.raw('meetings/talk-workshop/ai-reports');
  assert.equal(response.status, 404);
  assert.equal(h.app.locals.assistant, null);
});

test('recording permission never implies AI permission and missing historical consent fails closed', async t => {
  const h = await harness(); t.after(h.close);
  const f = await h.setup();
  assert.equal(h.database.prepare('SELECT COUNT(*) AS n FROM talk_ai_consents').get().n, 0);
  const eligibility = await f.host.request('meetings/talk-workshop/ai-eligibility');
  assert.equal(eligibility.status, 200);
  assert.equal(eligibility.body.eligible, false);
  assert.equal((await f.host.request('meetings/talk-workshop/ai-reports', { recordingIds: [f.recordingId] })).status, 409);
  h.database.prepare('DELETE FROM talk_recording_consents WHERE recording_id=?').run(f.recordingId);
  assert.equal((await h.consent(f.host, f.recordingId, f.revision.id)).status, 404);
  assert.equal((await f.host.request('meetings/talk-workshop/ai-reports', { recordingIds: [f.recordingId] })).status, 409);
});

test('AI consent is explicit, version-specific and self-only while participants cannot inspect reports', async t => {
  const h = await harness(); t.after(h.close); const f = await h.setup();
  const unversioned = await f.host.request(`recordings/${f.recordingId}/ai-consent`, { revisionId: f.revision.id, decision: 'accepted' });
  assert.equal(unversioned.status, 400);
  assert.equal((await h.consent(f.outsider, f.recordingId, f.revision.id)).status, 404);
  assert.equal((await h.consent(f.host, f.recordingId, f.revision.id, 'accepted', { accountId: f.member.id })).status, 200);
  assert.equal(h.database.prepare('SELECT account_id FROM talk_ai_consents').get().account_id, f.host.id);
  assert.equal((await f.member.request('meetings/talk-workshop/ai-reports')).status, 404);
  assert.equal((await f.member.request('meetings/talk-workshop/ai-reports', { recordingIds: [f.recordingId], role: 'host' })).status, 404);
  assert.equal((await h.consent(f.member, f.recordingId, f.revision.id, 'declined')).status, 200);
  assert.equal((await f.host.request('meetings/talk-workshop/ai-eligibility')).body.eligible, false);
  await h.ready(f);
  assert.equal((await f.host.request('meetings/talk-workshop/ai-eligibility')).body.eligible, true);
});

test('report writes require existing authenticated session, CSRF and trusted origin', async t => {
  const h = await harness(); t.after(h.close); const f = await h.setup(); await h.ready(f);
  assert.equal((await h.anonymous('meetings/talk-workshop/ai-reports')).status, 401);
  assert.equal((await f.host.raw('meetings/talk-workshop/ai-reports', { recordingIds: [f.recordingId] }, { 'X-CSRF-Token': 'wrong' })).status, 403);
  assert.equal((await f.host.raw('meetings/talk-workshop/ai-reports', { recordingIds: [f.recordingId] }, { Origin: 'https://untrusted.example' })).status, 403);
  assert.equal(h.database.prepare('SELECT COUNT(*) AS n FROM talk_ai_reports').get().n, 0);
});

test('a draft is private and generation remains disabled without contacting an AI service', async t => {
  const h = await harness(); t.after(h.close); const f = await h.setup(); await h.ready(f);
  const report = await h.create(f);
  assert.equal(report.status, 'draft'); assert.equal(report.currentRevision, 1); assert.equal(report.approvedRevision, null);
  const read = await f.host.request(`ai-reports/${report.id}`);
  assert.equal(read.status, 200); assert.equal(read.body.report.meetingId, 'talk-workshop');
  for (const person of [f.member, f.outsider]) {
    assert.equal((await person.request(`ai-reports/${report.id}`)).status, 404);
    for (const action of ['generate', 'approve', 'cancel', 'delete']) assert.equal((await person.request(`ai-reports/${report.id}/${action}`, { expectedRevision: 1 })).status, 404);
  }
  assert.equal((await f.host.request(`ai-reports/${report.id}/generate`, { expectedRevision: 1 })).status, 503);
  assert.equal(h.database.prepare('SELECT COUNT(*) AS n FROM talk_ai_jobs').get().n, 0);
});

test('changed transcripts allocate immutable revisions and require fresh AI consent', async t => {
  const h = await harness(); t.after(h.close); const f = await h.setup(); await h.ready(f);
  const report = await h.create(f);
  const first = h.database.prepare('SELECT * FROM talk_transcript_revisions WHERE id=?').get(f.revision.id);
  h.database.prepare('UPDATE talk_transcript_segments SET text=? WHERE recording_id=?').run('Correction: the migration is complete.', f.recordingId);
  const next = (await f.host.request(`recordings/${f.recordingId}/transcript`)).body.revision;
  assert.equal(next.number, 2); assert.notEqual(next.id, first.id); assert.notEqual(next.contentHash, first.content_hash);
  assert.equal(h.database.prepare('SELECT segments_json FROM talk_transcript_revisions WHERE id=?').get(first.id).segments_json, first.segments_json);
  assert.throws(() => h.database.prepare('UPDATE talk_transcript_revisions SET language=? WHERE id=?').run('hi', first.id), /immutable/i);
  assert.equal((await f.host.request('meetings/talk-workshop/ai-eligibility')).body.eligible, false);
  assert.equal((await h.consent(f.host, f.recordingId, first.id)).status, 409);
  assert.equal(h.database.prepare('SELECT transcript_revision_id FROM talk_ai_report_sources WHERE report_id=?').get(report.id).transcript_revision_id, first.id);
});

test('manager edits create immutable revisions and reject stale revisions or fabricated evidence', async t => {
  const h = await harness(); t.after(h.close); const f = await h.setup(); await h.ready(f); const report = await h.create(f);
  const content = reportContent([{ recordingId: f.recordingId, id: f.revision.id }]);
  const edited = await f.host.request(`ai-reports/${report.id}/revisions`, { expectedRevision: 1, content });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(edited.body.report.currentRevision, 2);
  assert.equal(edited.body.report.content.blockers[0].owner, null);
  assert.equal(edited.body.report.content.blockers[0].deadline, null);
  assert.equal(edited.body.report.content.blockers[0].speaker, null);
  assert.ok(edited.body.report.content.blockers[0].uncertainty.length > 0);
  assert.equal((await f.host.request(`ai-reports/${report.id}/revisions`, { expectedRevision: 1, content })).status, 409);
  const fabricated = structuredClone(content); fabricated.blockers[0].evidence[0].quote = 'Employee Alice will complete everything tomorrow.';
  assert.equal((await f.host.request(`ai-reports/${report.id}/revisions`, { expectedRevision: 2, content: fabricated })).status, 400);
  assert.throws(() => h.database.prepare("UPDATE talk_ai_report_revisions SET content_json='{}' WHERE report_id=?").run(report.id), /immutable/i);
  assert.equal(h.database.prepare('SELECT COUNT(*) AS n FROM talk_ai_report_revisions WHERE report_id=?').get(report.id).n, 2);
});

test('co-hosts can review but only the meeting owner approves and approved reports stay immutable', async t => {
  const h = await harness(); t.after(h.close); const f = await h.setup(); await h.ready(f); const report = await h.create(f);
  h.database.prepare("UPDATE talk_meeting_members SET role='cohost' WHERE meeting_id='talk-workshop' AND account_id=?").run(f.member.id);
  assert.equal((await f.member.request(`ai-reports/${report.id}`)).status, 200);
  const content = reportContent([{ recordingId: f.recordingId, id: f.revision.id }]);
  assert.equal((await f.member.request(`ai-reports/${report.id}/revisions`, { expectedRevision: 1, content })).status, 200);
  assert.equal((await f.member.request(`ai-reports/${report.id}/approve`, { expectedRevision: 2 })).status, 403);
  const approved = await f.host.request(`ai-reports/${report.id}/approve`, { expectedRevision: 2 });
  assert.equal(approved.status, 200, JSON.stringify(approved.body)); assert.equal(approved.body.report.status, 'approved'); assert.equal(approved.body.report.approvedRevision, 2);
  assert.equal((await f.host.request(`ai-reports/${report.id}/revisions`, { expectedRevision: 2, content })).status, 409);
  assert.notEqual((await f.host.request(`ai-reports/${report.id}/generate`, { expectedRevision: 2 })).status, 202);
  h.database.prepare("UPDATE talk_meeting_members SET role='member' WHERE meeting_id='talk-workshop' AND account_id=?").run(f.member.id);
  assert.equal((await f.member.request(`ai-reports/${report.id}`)).status, 404);
});

test('fixture generation is idempotent, checkpointed, grounded and always requires manager review', async t => {
  let calls = 0;
  const h = await harness({ provider: fixtureProvider(async ({ sources, onCheckpoint }) => { calls++; await onCheckpoint({ completedChunks: 1 }); return reportContent(sources); }) }); t.after(h.close);
  const f = await h.setup(); await h.ready(f); const report = await h.create(f);
  for (let attempt = 0; attempt < 2; attempt++) assert.equal((await f.host.request(`ai-reports/${report.id}/generate`, { expectedRevision: 1 })).status, 202);
  assert.equal(h.database.prepare('SELECT COUNT(*) AS n FROM talk_ai_jobs WHERE report_id=?').get(report.id).n, 1);
  await h.tick();
  const read = await f.host.request(`ai-reports/${report.id}`);
  assert.equal(read.body.report.status, 'review_required', JSON.stringify(read.body)); assert.equal(calls, 1);
  assert.equal(read.body.report.approvedRevision, null);
  assert.equal(read.body.report.content.blockers[0].evidence[0].revisionId, f.revision.id);
  const job = h.database.prepare('SELECT * FROM talk_ai_jobs WHERE report_id=?').get(report.id);
  assert.equal(job.status, 'completed'); assert.deepEqual(JSON.parse(job.checkpoint_json), {});
  assert.equal((await f.host.request(`ai-reports/${report.id}/approve`, { expectedRevision: read.body.report.currentRevision })).status, 200);
  assert.equal((await f.host.request(`ai-reports/${report.id}/generate`, { expectedRevision: 1 })).status, 409);
});

test('durable retry resumes a saved checkpoint without leaking a provider exception', async t => {
  let calls = 0, resumed;
  const h = await harness({ retryDelayMs: 10, provider: fixtureProvider(async ({ sources, checkpoint, onCheckpoint }) => { calls++; if (calls === 1) { await onCheckpoint({ completedChunks: 1 }); throw new Error('PRIVATE PROVIDER INTERNAL DETAILS'); } resumed = checkpoint; return reportContent(sources); }) }); t.after(h.close);
  const f = await h.setup(); await h.ready(f); const report = await h.create(f);
  assert.equal((await f.host.request(`ai-reports/${report.id}/generate`, { expectedRevision: 1 })).status, 202);
  await h.tick();
  let job = h.database.prepare('SELECT * FROM talk_ai_jobs WHERE report_id=?').get(report.id);
  assert.equal(job.status, 'queued'); assert.equal(job.attempts, 1);
  assert.doesNotMatch(JSON.stringify((await f.host.request(`ai-reports/${report.id}`)).body), /PRIVATE PROVIDER/);
  h.advance(10000); await h.tick();
  job = h.database.prepare('SELECT * FROM talk_ai_jobs WHERE report_id=?').get(report.id);
  assert.equal(job.status, 'completed'); assert.equal(job.attempts, 2); assert.equal(resumed.completedChunks, 1);
});

test('a cancelled generation aborts work and cannot commit its late provider result', async t => {
  let started, release, aborted = false;
  const began = new Promise(resolve => { started = resolve; }), barrier = new Promise(resolve => { release = resolve; });
  const h = await harness({ provider: fixtureProvider(async ({ sources, signal }) => { signal.addEventListener('abort', () => { aborted = true; }, { once: true }); started(); await barrier; return reportContent(sources); }) });
  t.after(async () => { release(); await h.close(); });
  const f = await h.setup(); await h.ready(f); const report = await h.create(f);
  await f.host.request(`ai-reports/${report.id}/generate`, { expectedRevision: 1 });
  const processing = h.tick(); await began;
  assert.equal((await f.host.request(`ai-reports/${report.id}/cancel`, {})).status, 200); release(); await processing;
  assert.equal(aborted, true);
  assert.equal((await f.host.request(`ai-reports/${report.id}`)).body.report.status, 'cancelled');
  assert.equal(h.database.prepare('SELECT COUNT(*) AS n FROM talk_ai_report_revisions WHERE report_id=?').get(report.id).n, 1);
  assert.equal(h.database.prepare('SELECT status FROM talk_ai_jobs WHERE report_id=?').get(report.id).status, 'cancelled');
});

test('a fresh service recovers expired worker leases from persisted SQLite storage', async t => {
  let recoveredCheckpoint;
  const provider = fixtureProvider(async ({ sources, checkpoint }) => { recoveredCheckpoint = checkpoint; return reportContent(sources); });
  const h = await harness({ persistent: true, provider }); t.after(h.close);
  const f = await h.setup(); await h.ready(f); const report = await h.create(f);
  await f.host.request(`ai-reports/${report.id}/generate`, { expectedRevision: 1 }); await h.app.locals.assistant.shutdown();
  h.database.prepare("UPDATE talk_ai_jobs SET status='running',attempts=1,lease_owner='crashed-backend',lease_expires_at=1,checkpoint_json=? WHERE report_id=?").run(JSON.stringify({ completedChunks: 1 }), report.id);
  const reopened = openAuthDatabase(h.databasePath), adapter = asyncDatabase(reopened);
  const manager = createMeetingManagement({ db: adapter, service: h.service, now: h.now });
  const recovered = createMeetingAssistant({ db: adapter, manager, provider, now: h.now });
  try {
    await recovered.tick();
    const job = reopened.prepare('SELECT * FROM talk_ai_jobs WHERE report_id=?').get(report.id);
    assert.equal(job.status, 'completed'); assert.equal(job.attempts, 2); assert.equal(recoveredCheckpoint.completedChunks, 1);
    assert.equal(reopened.prepare('SELECT status FROM talk_ai_reports WHERE id=?').get(report.id).status, 'review_required');
  } finally { await recovered.shutdown(); reopened.close(); }
});

test('AI consent withdrawal blocks existing reports and prevents subsequent generation', async t => {
  const h = await harness(); t.after(h.close); const f = await h.setup(); await h.ready(f); const report = await h.create(f);
  assert.equal((await h.consent(f.member, f.recordingId, f.revision.id, 'declined')).status, 200);
  assert.notEqual((await f.host.request(`ai-reports/${report.id}`)).status, 200);
  assert.notEqual((await f.host.request(`ai-reports/${report.id}/generate`, { expectedRevision: 1 })).status, 202);
  assert.equal((await f.host.request('meetings/talk-workshop/ai-eligibility')).body.eligible, false);
});

test('source expiry and deletion prevent report retrieval and purge evidence-bearing revisions', async t => {
  const h = await harness(); t.after(h.close); const f = await h.setup(); await h.ready(f); const report = await h.create(f);
  h.database.prepare('UPDATE talk_recordings SET expires_at=? WHERE id=?').run(h.now() - 1, f.recordingId);
  h.database.prepare('UPDATE talk_ai_reports SET expires_at=? WHERE id=?').run(h.now() - 1, report.id);
  assert.equal((await f.host.request(`ai-reports/${report.id}`)).status, 404);
  await h.tick();
  assert.equal(h.database.prepare('SELECT COUNT(*) AS n FROM talk_ai_report_revisions WHERE report_id=?').get(report.id).n, 0);
});

test('recording deletion purges report text, transcript snapshots and consent in the same private workflow', async t => {
  const h = await harness(); t.after(h.close); const f = await h.setup(); await h.ready(f); const report = await h.create(f);
  assert.equal((await f.host.request(`recordings/${f.recordingId}/delete`, {})).status, 202);
  assert.equal((await f.host.request(`ai-reports/${report.id}`)).status, 404);
  assert.equal(h.database.prepare('SELECT COUNT(*) AS n FROM talk_ai_report_revisions WHERE report_id=?').get(report.id).n, 0);
  assert.equal(h.database.prepare('SELECT COUNT(*) AS n FROM talk_transcript_revisions WHERE recording_id=?').get(f.recordingId).n, 0);
  assert.equal(h.database.prepare('SELECT COUNT(*) AS n FROM talk_ai_consents WHERE recording_id=?').get(f.recordingId).n, 0);
});

test('provider failures stop after the retry limit and cannot leave a report processing forever', async t => {
  let calls = 0;
  const h = await harness({ retryDelayMs: 1, provider: fixtureProvider(async () => { calls++; throw new Error('private provider details'); }) }); t.after(h.close);
  const f = await h.setup(); await h.ready(f); const report = await h.create(f);
  await f.host.request(`ai-reports/${report.id}/generate`, { expectedRevision: 1 });
  for (let index = 0; index < 4; index++) { await h.tick(); h.advance(10000); }
  const read = await f.host.request(`ai-reports/${report.id}`), job = h.database.prepare('SELECT * FROM talk_ai_jobs WHERE report_id=?').get(report.id);
  assert.equal(calls, 3); assert.equal(job.attempts, 3); assert.equal(job.status, 'failed'); assert.equal(read.body.report.status, 'failed');
  assert.doesNotMatch(JSON.stringify(read.body), /private provider details/);
});

test('a worker that loses its lease cannot overwrite the replacement worker', async t => {
  let started, release;
  const began = new Promise(resolve => { started = resolve; }), barrier = new Promise(resolve => { release = resolve; });
  const h = await harness({ provider: fixtureProvider(async ({ sources }) => { started(); await barrier; return reportContent(sources); }) });
  t.after(async () => { release(); await h.close(); });
  const f = await h.setup(); await h.ready(f); const report = await h.create(f);
  await f.host.request(`ai-reports/${report.id}/generate`, { expectedRevision: 1 }); const pending = h.tick(); await began;
  h.database.prepare("UPDATE talk_ai_jobs SET lease_owner='replacement-worker',lease_expires_at=? WHERE report_id=?").run(h.now() + 120000, report.id);
  release(); await pending;
  const job = h.database.prepare('SELECT * FROM talk_ai_jobs WHERE report_id=?').get(report.id);
  assert.equal(job.lease_owner, 'replacement-worker'); assert.equal(job.status, 'running');
  assert.equal(h.database.prepare('SELECT current_revision FROM talk_ai_reports WHERE id=?').get(report.id).current_revision, 1);
});

test('one meeting cannot import another meeting recording even with host-controlled request data', async t => {
  const h = await harness(); t.after(h.close); const f = await h.setup(); await h.ready(f);
  const created = await f.outsider.request('meetings', { title: 'Other private meeting', approvalRequired: true });
  assert.equal(created.status, 201); const secondId = created.body.meeting.id;
  assert.equal((await f.outsider.request(`meetings/${secondId}/ai-reports`, { recordingIds: [f.recordingId], meetingId: 'talk-workshop', role: 'host' })).status, 404);
  assert.equal(h.database.prepare('SELECT COUNT(*) AS n FROM talk_ai_reports').get().n, 0);
});

test('a stalled provider is aborted at its deadline and leaves a bounded durable retry', async t => {
  let aborted = false;
  const h = await harness({ jobTimeoutMs: 50, provider: fixtureProvider(async ({ signal }) => { signal.addEventListener('abort', () => { aborted = true; }, { once: true }); return new Promise(() => {}); }) }); t.after(h.close);
  const f = await h.setup(); await h.ready(f); const report = await h.create(f);
  await f.host.request(`ai-reports/${report.id}/generate`, { expectedRevision: 1 });
  await h.tick();
  const job = h.database.prepare('SELECT * FROM talk_ai_jobs WHERE report_id=?').get(report.id);
  assert.equal(aborted, true); assert.equal(job.status, 'queued'); assert.equal(job.attempts, 1);
  assert.equal(job.lease_owner, null); assert.equal(job.lease_expires_at, null); assert.ok(job.next_run_at > h.now());
});

test('graceful backend shutdown preserves checkpointed interrupted work for restart', async t => {
  let started;
  const began = new Promise(resolve => { started = resolve; });
  const h = await harness({ provider: fixtureProvider(async ({ onCheckpoint }) => { await onCheckpoint({ completedChunks: 1 }); started(); return new Promise(() => {}); }) }); t.after(h.close);
  const f = await h.setup(); await h.ready(f); const report = await h.create(f);
  await f.host.request(`ai-reports/${report.id}/generate`, { expectedRevision: 1 });
  const processing = h.tick(); await began;
  await h.app.locals.assistant.shutdown(); await processing;
  const job = h.database.prepare('SELECT * FROM talk_ai_jobs WHERE report_id=?').get(report.id);
  assert.equal(job.status, 'queued'); assert.equal(job.lease_owner, null); assert.equal(job.lease_expires_at, null);
  assert.equal(JSON.parse(job.checkpoint_json).completedChunks, 1);
  assert.equal(h.database.prepare('SELECT status FROM talk_ai_reports WHERE id=?').get(report.id).status, 'processing');
});

test('authorized explicit retry recovers a failed job without duplicating its durable identity', async t => {
  let calls = 0;
  const h = await harness({ retryDelayMs: 1, provider: fixtureProvider(async ({ sources }) => { calls++; if (calls <= 3) throw new Error('private transient fixture failure'); return reportContent(sources); }) }); t.after(h.close);
  const f = await h.setup(); await h.ready(f); const report = await h.create(f);
  await f.host.request(`ai-reports/${report.id}/generate`, { expectedRevision: 1 });
  for (let index = 0; index < 3; index++) { await h.tick(); h.advance(10000); }
  const before = h.database.prepare('SELECT * FROM talk_ai_jobs WHERE report_id=?').get(report.id);
  assert.equal(before.status, 'failed');
  assert.equal((await f.member.request(`ai-reports/${report.id}/retry`, { expectedRevision: 1 })).status, 404);
  assert.equal((await f.host.request(`ai-reports/${report.id}/retry`, { expectedRevision: 0 })).status, 409);
  assert.equal((await f.host.request(`ai-reports/${report.id}/retry`, { expectedRevision: 1 })).status, 202);
  await h.tick();
  const after = h.database.prepare('SELECT * FROM talk_ai_jobs WHERE report_id=?').get(report.id);
  assert.equal(after.id, before.id); assert.equal(after.status, 'completed'); assert.equal(after.attempts, 1);
  assert.equal(h.database.prepare('SELECT COUNT(*) AS n FROM talk_ai_jobs WHERE report_id=?').get(report.id).n, 1);
  assert.equal((await f.host.request(`ai-reports/${report.id}`)).body.report.status, 'review_required');
});

test('owner-requested generation survives revoking the co-host who originally created the draft', async t => {
  const h = await harness({ provider: fixtureProvider(async ({ sources }) => reportContent(sources)) }); t.after(h.close);
  const f = await h.setup(); await h.ready(f);
  assert.equal((await f.host.request('meetings/talk-workshop/actions', { action: 'cohost_add', target: f.member.id })).status, 200);
  const created = await f.member.request('meetings/talk-workshop/ai-reports', { recordingIds: [f.recordingId] });
  assert.equal(created.status, 201); const report = created.body.report;
  assert.equal(h.database.prepare('SELECT created_by FROM talk_ai_reports WHERE id=?').get(report.id).created_by, f.member.id);
  assert.equal((await f.host.request(`ai-reports/${report.id}/generate`, { expectedRevision: 1 })).status, 202);
  assert.equal(h.database.prepare('SELECT requested_by FROM talk_ai_jobs WHERE report_id=?').get(report.id).requested_by, f.host.id);
  assert.equal((await f.host.request('meetings/talk-workshop/actions', { action: 'cohost_remove', target: f.member.id })).status, 200);
  await h.tick();
  const result = await f.host.request(`ai-reports/${report.id}`);
  assert.equal(result.status, 200); assert.equal(result.body.report.status, 'review_required');
  assert.equal(h.database.prepare('SELECT status FROM talk_ai_jobs WHERE report_id=?').get(report.id).status, 'completed');
  assert.equal((await f.member.request(`ai-reports/${report.id}`)).status, 404);
});

test('revoking the requesting co-host during inference discards the late result even when the owner created the draft', async t => {
  let started, release;
  const began = new Promise(resolve => { started = resolve; }), barrier = new Promise(resolve => { release = resolve; });
  const h = await harness({ provider: fixtureProvider(async ({ sources }) => { started(); await barrier; return reportContent(sources); }) });
  t.after(async () => { release(); await h.close(); });
  const f = await h.setup(); await h.ready(f); const report = await h.create(f);
  assert.equal((await f.host.request('meetings/talk-workshop/actions', { action: 'cohost_add', target: f.member.id })).status, 200);
  assert.equal((await f.member.request(`ai-reports/${report.id}/generate`, { expectedRevision: 1 })).status, 202);
  assert.equal(h.database.prepare('SELECT requested_by FROM talk_ai_jobs WHERE report_id=?').get(report.id).requested_by, f.member.id);
  const processing = h.tick(); await began;
  assert.equal((await f.host.request('meetings/talk-workshop/actions', { action: 'cohost_remove', target: f.member.id })).status, 200);
  release(); await processing;
  const result = await f.host.request(`ai-reports/${report.id}`);
  assert.equal(result.status, 200); assert.equal(result.body.report.status, 'cancelled'); assert.equal(result.body.report.currentRevision, 1);
  assert.equal(h.database.prepare('SELECT status FROM talk_ai_jobs WHERE report_id=?').get(report.id).status, 'cancelled');
  assert.equal(h.database.prepare('SELECT COUNT(*) AS n FROM talk_ai_report_revisions WHERE report_id=?').get(report.id).n, 1);
  assert.equal((await f.member.request(`ai-reports/${report.id}`)).status, 404);
});
