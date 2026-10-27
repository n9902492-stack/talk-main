import {sqliteMigrationCount} from './helpers/migration-count.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openAuthDatabase } from '../backend/src/database.mjs';
import { asyncDatabase } from '../backend/src/async-database.mjs';
import { ensureTranscriptRevision, readTranscriptRevision, transcriptContentHash } from '../backend/src/transcript-revisions.mjs';

function fixture(t, filename = ':memory:') {
  const raw = openAuthDatabase(filename), db = asyncDatabase(raw), time = 100000;
  raw.prepare('INSERT INTO accounts(id,name,email,created_at) VALUES (?,?,?,?)').run('host', 'Host', 'host@example.test', time);
  raw.prepare('INSERT INTO talk_meetings(id,title,room_name,owner_account_id,created_at) VALUES (?,?,?,?,?)').run('meeting', 'Daily status', 'fixture-room', 'host', time);
  raw.prepare("INSERT INTO talk_recordings(id,meeting_id,requested_by,mode,language,status,created_at,recorder_identity,expires_at,transcript_status,transcript_language) VALUES (?,?,?,'audio','hi','completed',?,?,?,'completed','hi')").run('recording', 'meeting', 'host', time, 'rec-fixture', time + 600000);
  raw.prepare('INSERT INTO talk_transcript_segments(recording_id,segment_index,start_ms,end_ms,text,speaker,language) VALUES (?,0,1000,3000,?,NULL,?)').run('recording', 'नमस्ते, काम जारी है।', 'hi');
  let closed = false;
  const close = () => { if (!closed) { raw.close(); closed = true; } };
  t.after(close);
  const transaction = operation => db.withContext(async () => {
    await db.exec('BEGIN IMMEDIATE');
    try { await db.lockIdentity('meeting:meeting'); const result = await operation(); await db.exec('COMMIT'); return result; }
    catch (error) { await db.exec('ROLLBACK'); throw error; }
  });
  return { raw, db, time, close, transaction, snapshot: () => transaction(() => ensureTranscriptRevision({ db, recordingId: 'recording', now: () => time })) };
}

test('completed transcripts create stable, Unicode-preserving, idempotent evidence snapshots', async t => {
  const h = fixture(t), first = await h.snapshot(), second = await h.snapshot();
  assert.equal(first.id, second.id);
  assert.equal(first.revision, 1);
  assert.match(first.contentHash, /^[a-f0-9]{64}$/);
  assert.equal(first.segments[0].text, 'नमस्ते, काम जारी है।');
  assert.deepEqual(first.segments[0], { segmentId: '0', startMs: 1000, endMs: 3000, text: 'नमस्ते, काम जारी है।', speaker: null, language: 'hi' });
  assert.equal(h.raw.prepare('SELECT COUNT(*) AS n FROM talk_transcript_revisions').get().n, 1);
});

test('retranscription allocates a new immutable version without altering previous evidence', async t => {
  const h = fixture(t), first = await h.snapshot();
  h.raw.prepare('UPDATE talk_transcript_segments SET text=? WHERE recording_id=?').run('काम पूरा हुआ।', 'recording');
  const second = await h.snapshot();
  assert.equal(second.revision, 2);
  assert.notEqual(first.contentHash, second.contentHash);
  const old = await h.db.withContext(() => readTranscriptRevision({ db: h.db, revisionId: first.id, now: () => h.time }));
  assert.equal(old.segments[0].text, 'नमस्ते, काम जारी है।');
  for (const [column, value] of [['segments_json', '[]'], ['content_hash', 'a'.repeat(64)], ['created_at', 1], ['expires_at', h.time * 10], ['revision', 50], ['recording_id', 'other']]) {
    assert.throws(() => h.raw.prepare(`UPDATE talk_transcript_revisions SET ${column}=? WHERE id=?`).run(value, first.id), /immutable/);
  }
});

test('hashes cover language, stable segment identity, timestamps, attribution and text', () => {
  const source = { language: 'en', segments: [{ segmentId: '0', startMs: 0, endMs: 500, text: 'Work in progress', speaker: null, language: 'en' }] };
  const original = transcriptContentHash(source);
  assert.notEqual(original, transcriptContentHash({ ...source, language: 'hi' }));
  for (const [field, value] of [['segmentId', '1'], ['startMs', 1], ['endMs', 600], ['text', 'Work completed'], ['speaker', 'named speaker'], ['language', 'hi']]) {
    assert.notEqual(original, transcriptContentHash({ ...source, segments: [{ ...source.segments[0], [field]: value }] }));
  }
});

test('expired, deleted and incomplete recordings never provide readable AI sources', async t => {
  const h = fixture(t), revision = await h.snapshot();
  await assert.rejects(h.db.withContext(() => readTranscriptRevision({ db: h.db, revisionId: revision.id, now: () => revision.expiresAt })), /unexpired/);
  for (const state of ['queued', 'processing', 'failed', 'unavailable', 'deleted']) {
    h.raw.prepare('UPDATE talk_recordings SET transcript_status=? WHERE id=?').run(state, 'recording');
    await assert.rejects(h.snapshot, /completed/);
    await assert.rejects(h.db.withContext(() => readTranscriptRevision({ db: h.db, revisionId: revision.id, now: () => h.time })), /completed/);
  }
  h.raw.prepare("UPDATE talk_recordings SET transcript_status='completed',status='deleted',deleted_at=?").run(h.time);
  await assert.rejects(h.snapshot, /completed/);
});

test('corrupt snapshots and invalid segment data fail closed', async t => {
  const h = fixture(t), revision = await h.snapshot();
  // Fixture-only bypass demonstrates detection even if a privileged DB operator tampers.
  h.raw.exec('DROP TRIGGER talk_transcript_revision_immutable');
  h.raw.prepare('UPDATE talk_transcript_revisions SET content_hash=? WHERE id=?').run('0'.repeat(64), revision.id);
  await assert.rejects(h.db.withContext(() => readTranscriptRevision({ db: h.db, revisionId: revision.id, now: () => h.time })), /integrity/);
  h.raw.prepare('UPDATE talk_transcript_segments SET end_ms=-1').run();
  await assert.rejects(h.snapshot, /integrity/);
});

test('concurrent request contexts serialize revision allocation under the meeting lock', async t => {
  const h = fixture(t);
  const values = await Promise.all(Array.from({ length: 8 }, () => h.snapshot()));
  assert.equal(new Set(values.map(value => value.id)).size, 1);
  assert.equal(h.raw.prepare('SELECT COUNT(*) AS n FROM talk_transcript_revisions').get().n, 1);
});

test('revisions survive database reopen and retention deletion cascades consent/source references', async t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'talk-ai-revision-'));
  let reopened;
  t.after(() => { reopened?.close(); rmSync(directory, { recursive: true, force: true }); });
  const filename = path.join(directory, 'fixture.sqlite'), h = fixture(t, filename), revision = await h.snapshot();
  h.raw.prepare("INSERT INTO talk_ai_consents(recording_id,transcript_revision_id,account_id,notice_version,decision,decided_at) VALUES (?,?,?,'ai-v1','accepted',?)").run('recording', revision.id, 'host', h.time);
  h.raw.prepare("INSERT INTO talk_ai_reports(id,meeting_id,created_by,status,source_hash,created_at,updated_at,expires_at) VALUES ('report','meeting','host','draft',?,?,?,?)").run(revision.contentHash, h.time, h.time, revision.expiresAt);
  h.raw.prepare("INSERT INTO talk_ai_report_sources(report_id,recording_id,transcript_revision_id,ordinal) VALUES ('report','recording',?,0)").run(revision.id);
  h.raw.prepare("INSERT INTO talk_ai_report_revisions(id,report_id,revision,content_json,origin,created_at) VALUES ('report-revision','report',1,'{}','manager',?)").run(h.time);
  assert.throws(() => h.raw.prepare("UPDATE talk_ai_report_revisions SET content_json='changed'").run(), /immutable/);
  h.close();
  reopened = openAuthDatabase(filename);
  const persisted = reopened.prepare('SELECT * FROM talk_transcript_revisions WHERE id=?').get(revision.id);
  assert.equal(persisted.content_hash, revision.contentHash);
  assert.equal(reopened.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n,sqliteMigrationCount);
  reopened.prepare('DELETE FROM talk_transcript_revisions WHERE id=?').run(revision.id);
  assert.equal(reopened.prepare('SELECT COUNT(*) AS n FROM talk_ai_consents').get().n, 0);
  assert.equal(reopened.prepare('SELECT COUNT(*) AS n FROM talk_ai_report_sources').get().n, 0);
});
