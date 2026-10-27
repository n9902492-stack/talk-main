import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openPostgresDatabase } from '../backend/src/postgres-database.mjs';
import { createMeetingAssistant, aiNoticeVersion } from '../backend/src/meeting-assistant.mjs';
import { ensureTranscriptRevision, readTranscriptRevision } from '../backend/src/transcript-revisions.mjs';

// Only the existing runner's disposable loopback database is accepted. No .env,
// private transcript, model, email, SMS or remote inference is involved.
const enabled = process.env.TALK_POSTGRES_TEST === '1' && process.env.PGHOST === '127.0.0.1' && process.env.PGDATABASE === 'talk_auth_test';
const content = source => ({ schemaVersion: 1, summary: [], topics: [], employeeUpdates: [], completedWork: [], workInProgress: [], blockers: [{ id: 'pg-blocker', text: 'The migration is blocked.', speaker: null, owner: null, deadline: null, uncertainty: [], evidence: [{ recordingId: source.recordingId, revisionId: source.id, segmentId: '0', startMs: 0, endMs: 4000, quote: 'The migration is blocked.' }] }], risks: [], decisions: [], actionItems: [], followUpNotes: [] });

test('real PostgreSQL assistant migrations, private consent, immutable evidence, persistence and worker recovery (local provider fixture)', { skip: !enabled }, async t => {
  let db, assistant, releaseGeneration;
  const time = Date.now(), id = () => randomUUID(), host = { account_id: id() }, member = { account_id: id() }, outsider = { account_id: id() }, meetingId = id(), recordingId = id();
  const now = () => time;
  const get = (sql, ...params) => db.withContext(() => db.prepare(sql).get(...params));
  const run = (sql, ...params) => db.withContext(() => db.prepare(sql).run(...params));
  const invoke = (method, ...args) => db.withContext(() => assistant[method](...args));
  const manager = { meeting: value => db.prepare('SELECT * FROM talk_meetings WHERE id=?').get(value), member: (meeting, account) => db.prepare('SELECT * FROM talk_meeting_members WHERE meeting_id=? AND account_id=?').get(meeting, account) };
  let generate = async ({ sources, onCheckpoint }) => { await onCheckpoint({ completedChunks: 1 }); return content(sources[0]); };
  const open = async () => {
    db = await openPostgresDatabase(process.env, { migrate: true });
    assistant = createMeetingAssistant({ db, manager, provider: { configured: true, modelDigest: 'postgres-fixture-model', generate: options => generate(options) }, now, autoStart: false });
  };
  const close = async () => { await assistant?.shutdown(); await db?.close(); assistant = db = undefined; };
  const snapshot = () => db.withContext(async () => {
    await db.exec('BEGIN IMMEDIATE');
    try { await db.lockIdentity(`meeting:${meetingId}`); const value = await ensureTranscriptRevision({ db, recordingId, now }); await db.exec('COMMIT'); return value; }
    catch (error) { await db.exec('ROLLBACK'); throw error; }
  });
  await open();
  t.after(async () => { releaseGeneration?.(); await close(); });
  for (const [person, name] of [[host, 'Host'], [member, 'Member'], [outsider, 'Outsider']]) await run('INSERT INTO accounts(id,name,email,created_at) VALUES (?,?,?,?)', person.account_id, name, `assistant-${id()}@example.test`, time);
  await run('INSERT INTO talk_meetings(id,title,room_name,owner_account_id,created_at) VALUES (?,?,?,?,?)', meetingId, 'PostgreSQL assistant fixture', `assistant-${id()}`, host.account_id, time);
  for (const [person, role] of [[host, 'host'], [member, 'member']]) await run("INSERT INTO talk_meeting_members(meeting_id,account_id,role,admission,display_name,updated_at) VALUES (?,?,?,'admitted',?,?)", meetingId, person.account_id, role, role, time);
  await run("INSERT INTO talk_recordings(id,meeting_id,requested_by,mode,language,status,created_at,recorder_identity,expires_at,transcript_status,transcript_language) VALUES (?,?,?,'audio','en','completed',?,?,?,'completed','en')", recordingId, meetingId, host.account_id, time, `rec-${id()}`, time + 3600000);
  await run('INSERT INTO talk_transcript_segments(recording_id,segment_index,start_ms,end_ms,text,speaker,language) VALUES (?,0,0,4000,?,NULL,?)', recordingId, 'The migration is blocked.', 'en');
  for (const person of [host, member]) await run("INSERT INTO talk_recording_consents(recording_id,account_id,decision,decided_at,notice_version) VALUES (?,?,'accepted',?,'talk-recording-v1')", recordingId, person.account_id, time);
  const first = await snapshot();
  let approvedReportId;

  await t.test('migrations and immutable source/report revisions enforce actual PostgreSQL constraints', async () => {
    assert.ok(await get("SELECT version FROM schema_migrations WHERE version='006_meeting_assistant.sql'"));
    assert.equal((await snapshot()).id, first.id);
    await assert.rejects(run('UPDATE talk_transcript_revisions SET content_hash=? WHERE id=?', '0'.repeat(64), first.id), /immutable/i);
    assert.equal((await db.withContext(() => readTranscriptRevision({ db, revisionId: first.id, now }))).segments[0].speaker, null);
  });

  await t.test('recording consent does not grant AI permission; only original participants consent for themselves', async () => {
    assert.equal((await invoke('eligibility', meetingId, host)).eligible, false);
    await assert.rejects(invoke('create', meetingId, host, { recordingIds: [recordingId] }), error => error.code === 'ai_consent_required');
    await assert.rejects(invoke('consent', recordingId, outsider, { revisionId: first.id, noticeVersion: aiNoticeVersion, decision: 'accepted' }), error => error.status === 404);
    for (const person of [host, member]) await invoke('consent', recordingId, person, { revisionId: first.id, noticeVersion: aiNoticeVersion, decision: 'accepted', accountId: outsider.account_id });
    assert.equal(Number((await get("SELECT COUNT(*) AS n FROM talk_ai_consents WHERE recording_id=? AND decision='accepted'", recordingId)).n), 2);
    assert.equal((await invoke('eligibility', meetingId, host)).eligible, true);
  });

  await t.test('private report ownership and owner-only approval survive a fresh database pool', async () => {
    const report = (await invoke('create', meetingId, host, { recordingIds: [recordingId] })).report; approvedReportId = report.id;
    await assert.rejects(invoke('get', report.id, outsider), error => error.status === 404);
    await assert.rejects(invoke('get', report.id, member), error => error.status === 404);
    await run("UPDATE talk_meeting_members SET role='cohost' WHERE meeting_id=? AND account_id=?", meetingId, member.account_id);
    await invoke('edit', report.id, member, { expectedRevision: 1, content: content(first) });
    await assert.rejects(invoke('approve', report.id, member, { expectedRevision: 2 }), error => error.status === 403);
    assert.equal((await invoke('approve', report.id, host, { expectedRevision: 2 })).report.status, 'approved');
    await assert.rejects(run("UPDATE talk_ai_report_revisions SET content_json='{}' WHERE report_id=?", report.id), /immutable/i);
    await close(); await open();
    const restored = (await invoke('get', report.id, host)).report;
    assert.equal(restored.status, 'approved'); assert.equal(restored.approvedRevision, 2); assert.equal(restored.content.blockers[0].owner, null);
    await run("UPDATE talk_meeting_members SET role='member' WHERE meeting_id=? AND account_id=?", meetingId, member.account_id);
    await assert.rejects(invoke('get', report.id, member), error => error.status === 404);
  });

  await t.test('durable idempotent jobs recover an abandoned lease and checkpoint through a fresh service', async () => {
    const report = (await invoke('create', meetingId, host, { recordingIds: [recordingId] })).report;
    const requested = await invoke('generate', report.id, host, { expectedRevision: 1 });
    assert.equal((await get('SELECT requested_by FROM talk_ai_jobs WHERE id=?', requested.job.id)).requested_by, host.account_id);
    const repeat = await invoke('generate', report.id, host, { expectedRevision: 1 });
    assert.equal(requested.job.id, repeat.job.id); assert.equal(repeat.idempotent, true);
    await run("UPDATE talk_ai_jobs SET status='running',attempts=1,lease_owner='terminated-pg-worker',lease_expires_at=?,checkpoint_json=? WHERE id=?", time - 1, JSON.stringify({ completedChunks: 1 }), requested.job.id);
    let resumed;
    generate = async ({ sources, checkpoint, onCheckpoint }) => { resumed = checkpoint; await onCheckpoint({ completedChunks: 2 }); return content(sources[0]); };
    await close(); await open(); await assistant.tick();
    assert.deepEqual(resumed, { completedChunks: 1 });
    const job = await get('SELECT * FROM talk_ai_jobs WHERE id=?', requested.job.id);
    assert.equal(job.status, 'completed'); assert.equal(job.attempts, 2); assert.equal(job.checkpoint_json, '{}');
    assert.equal(job.requested_by, host.account_id);
    const processed = (await invoke('get', report.id, host)).report;
    assert.equal(processed.status, 'review_required'); assert.equal(processed.origin, 'ai');
  });

  await t.test('a changed transcript invalidates stale worker commits and requires new version-specific consent', async () => {
    let began;
    const started = new Promise(resolve => { began = resolve; });
    const barrier = new Promise(resolve => { releaseGeneration = resolve; });
    generate = async ({ sources }) => { began(); await barrier; return content(sources[0]); };
    const report = (await invoke('create', meetingId, host, { recordingIds: [recordingId] })).report;
    const queued = await invoke('generate', report.id, host, { expectedRevision: 1 });
    const work = assistant.tick();
    await Promise.race([started, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Fixture worker did not start.')), 10000); timer.unref(); })]);
    await run('UPDATE talk_transcript_segments SET text=? WHERE recording_id=?', 'Correction: the migration is complete.', recordingId);
    const current = await snapshot(); assert.equal(current.revision, 2); assert.notEqual(current.contentHash, first.contentHash);
    releaseGeneration(); await work;
    assert.equal((await get('SELECT status FROM talk_ai_jobs WHERE id=?', queued.job.id)).status, 'cancelled');
    assert.equal((await get('SELECT current_revision FROM talk_ai_reports WHERE id=?', report.id)).current_revision, 1);
    assert.equal((await invoke('eligibility', meetingId, host)).eligible, false);
    assert.equal((await db.withContext(() => readTranscriptRevision({ db, revisionId: first.id, now }))).segments[0].text, 'The migration is blocked.');
    await invoke('consent', recordingId, member, { revisionId: first.id, noticeVersion: aiNoticeVersion, decision: 'declined' });
    assert.equal(Number((await get('SELECT COUNT(*) AS n FROM talk_ai_report_revisions WHERE report_id=?', approvedReportId)).n), 0);
    await assert.rejects(invoke('get', approvedReportId, host), error => error.status === 404);
  });
});
