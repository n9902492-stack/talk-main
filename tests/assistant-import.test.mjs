import test from 'node:test';
import assert from 'node:assert/strict';
import { openAuthDatabase } from '../backend/src/database.mjs';
import { importSqlite } from '../backend/src/import-sqlite.mjs';
import { transcriptContentHash } from '../backend/src/transcript-revisions.mjs';
import { emptyAssistantReport } from '../backend/src/assistant-grounding.mjs';

const aiTables = ['talk_transcript_revisions', 'talk_ai_consents', 'talk_ai_reports', 'talk_ai_report_sources',
  'talk_ai_report_revisions', 'talk_ai_jobs', 'talk_ai_events'];

// The real import function sees a minimal injected PostgreSQL client. Its INSERTs
// execute against a separate real SQLite target with foreign keys enabled. This
// exercises row preservation, dependency order and rollback without a network or
// a private database. Real PostgreSQL coverage is a separate integration suite.
function fixturePool(target, { failTable } = {}) {
  const queries = [], inserted = [];
  let released = 0;
  const client = {
    async query(sql, parameters = []) {
      queries.push(sql);
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) { target.exec(sql); return { rowCount: 0, rows: [] }; }
      if (sql === 'SELECT pg_advisory_xact_lock(791604215)' || /^LOCK TABLE [a-z_]+ IN ACCESS EXCLUSIVE MODE$/.test(sql)) return { rowCount: 0, rows: [] };
      if (sql.startsWith('SELECT column_name FROM information_schema.columns')) {
        assert.match(parameters[0], /^[a-z_]+$/);
        const rows = target.prepare(`PRAGMA table_info(${parameters[0]})`).all().map(column => ({ column_name: column.name }));
        return { rowCount: rows.length, rows };
      }
      if (/^SELECT 1 FROM [a-z_]+ LIMIT 1$/.test(sql)) {
        const rows = target.prepare(sql).all(); return { rowCount: rows.length, rows };
      }
      const insertion = /^INSERT INTO ([a-z_]+) /.exec(sql);
      if (insertion) {
        if (insertion[1] === failTable) throw new Error('Injected import failure.');
        const result = target.prepare(sql.replace(/\$[0-9]+/g, '?')).run(...parameters);
        inserted.push(insertion[1]); return { rowCount: result.changes, rows: [] };
      }
      assert.fail('Unexpected SQL operation in isolated import fixture.');
    },
    release() { released++; },
  };
  return { connect: async () => client, queries, inserted, releases: () => released };
}

function sourceFixture() {
  const db = openAuthDatabase(':memory:'), time = 1800000000000;
  const text = 'आज काम जारी है। The migration is blocked.';
  const segments = [{ segmentId: '0', startMs: 0, endMs: 4000, text, speaker: null, language: 'hi' }];
  const contentHash = transcriptContentHash({ language: 'hi', segments });
  db.prepare('INSERT INTO accounts(id,name,email,email_verified,created_at) VALUES (?,?,?,?,?)').run('fixture-host', 'Fixture Host', 'fixture@example.test', 1, time);
  db.prepare("INSERT INTO talk_meetings(id,title,room_name,owner_account_id,created_at) VALUES ('fixture-meeting','Fixture meeting','fixture-room','fixture-host',?)").run(time);
  db.prepare("INSERT INTO talk_recordings(id,meeting_id,requested_by,mode,language,status,created_at,recorder_identity,expires_at,transcript_status,transcript_language) VALUES ('fixture-recording','fixture-meeting','fixture-host','audio','hi','completed',?,'rec_fixture',?,'completed','hi')").run(time, time + 86400000);
  db.prepare("INSERT INTO talk_recording_consents(recording_id,account_id,decision,decided_at,notice_version) VALUES ('fixture-recording','fixture-host','accepted',?,'talk-recording-v1')").run(time);
  db.prepare("INSERT INTO talk_transcript_segments(recording_id,segment_index,start_ms,end_ms,text,speaker,language) VALUES ('fixture-recording',0,0,4000,?,NULL,'hi')").run(text);
  db.prepare("INSERT INTO talk_transcript_revisions(id,recording_id,revision,content_hash,language,segments_json,created_at,expires_at) VALUES ('fixture-transcript-revision','fixture-recording',1,?,'hi',?,?,?)").run(contentHash, JSON.stringify(segments), time, time + 86400000);
  db.prepare("INSERT INTO talk_ai_consents(recording_id,transcript_revision_id,account_id,notice_version,decision,decided_at) VALUES ('fixture-recording','fixture-transcript-revision','fixture-host','talk-ai-v1','accepted',?)").run(time);
  db.prepare("INSERT INTO talk_ai_reports(id,meeting_id,created_by,status,source_hash,created_at,updated_at,expires_at,current_revision) VALUES ('fixture-report','fixture-meeting','fixture-host','processing',?,?,?,?,1)").run('b'.repeat(64), time, time, time + 86400000);
  db.prepare("INSERT INTO talk_ai_report_sources(report_id,recording_id,transcript_revision_id,ordinal) VALUES ('fixture-report','fixture-recording','fixture-transcript-revision',0)").run();
  const content = emptyAssistantReport();
  content.blockers.push({ id: 'blocker-1', text: 'The migration is blocked.', speaker: null, owner: null, deadline: null,
    uncertainty: ['needs_review', 'unknown_speaker', 'unknown_owner', 'unknown_deadline'],
    evidence: [{ recordingId: 'fixture-recording', revisionId: 'fixture-transcript-revision', segmentId: '0', startMs: 0, endMs: 4000, quote: text }] });
  db.prepare("INSERT INTO talk_ai_report_revisions(id,report_id,revision,content_json,origin,author_account_id,schema_version,created_at) VALUES ('fixture-report-revision','fixture-report',1,?,'manager','fixture-host','1',?)").run(JSON.stringify(content), time);
  db.prepare("INSERT INTO talk_ai_jobs(id,report_id,requested_by,idempotency_key,status,attempts,next_run_at,checkpoint_json,created_at,updated_at) VALUES ('fixture-job','fixture-report','fixture-host',?,'queued',1,?,?,?,?)").run('c'.repeat(64), time, JSON.stringify({ completedChunks: 1, sourceHash: contentHash }), time, time);
  db.prepare("INSERT INTO talk_ai_events(id,report_id,actor_account_id,action,detail_json,created_at) VALUES ('fixture-event','fixture-report','fixture-host','generation_requested',?,?)").run(JSON.stringify({ sources: 1 }), time);
  return db;
}

test('SQLite import preserves every AI table, immutable evidence and resumable jobs in foreign-key order', async t => {
  const source = sourceFixture(), target = openAuthDatabase(':memory:');
  t.after(() => { source.close(); target.close(); });
  const output = [];
  t.mock.method(console, 'log', (...values) => output.push(values));
  t.mock.method(console, 'error', (...values) => output.push(values));
  const pool = fixturePool(target), counts = await importSqlite(source, pool);
  for (const table of aiTables) {
    assert.equal(counts[table], 1, `missing imported ${table}`);
    assert.deepEqual(target.prepare(`SELECT * FROM ${table}`).all(), source.prepare(`SELECT * FROM ${table}`).all());
  }
  assert.ok(pool.inserted.indexOf('accounts') < pool.inserted.indexOf('talk_recordings'));
  assert.ok(pool.inserted.indexOf('talk_recordings') < pool.inserted.indexOf('talk_transcript_revisions'));
  assert.ok(pool.inserted.indexOf('talk_transcript_revisions') < pool.inserted.indexOf('talk_ai_consents'));
  assert.ok(pool.inserted.indexOf('talk_ai_reports') < pool.inserted.indexOf('talk_ai_report_sources'));
  assert.ok(pool.inserted.indexOf('talk_ai_reports') < pool.inserted.indexOf('talk_ai_jobs'));
  assert.deepEqual(target.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(pool.releases(), 1);
  assert.deepEqual(output, []);
  const snapshot = target.prepare('SELECT * FROM talk_transcript_revisions').get();
  assert.equal(snapshot.content_hash, transcriptContentHash({ language: snapshot.language, segments: JSON.parse(snapshot.segments_json) }));
  assert.equal(JSON.parse(target.prepare('SELECT checkpoint_json FROM talk_ai_jobs').get().checkpoint_json).completedChunks, 1);
  assert.equal(target.prepare('SELECT requested_by FROM talk_ai_jobs').get().requested_by, 'fixture-host');
  assert.throws(() => target.prepare("UPDATE talk_transcript_revisions SET language='en'").run(), /immutable/i);
  assert.throws(() => target.prepare("UPDATE talk_ai_report_revisions SET content_json='{}'").run(), /immutable/i);
});

test('a nonempty target is rejected before inserts and both databases leave the failed transaction', async t => {
  const source = sourceFixture(), target = openAuthDatabase(':memory:');
  t.after(() => { source.close(); target.close(); });
  target.prepare("INSERT INTO accounts(id,name,email,created_at) VALUES ('existing','Existing','existing@example.test',1)").run();
  const pool = fixturePool(target);
  await assert.rejects(importSqlite(source, pool), /empty target/);
  assert.deepEqual(pool.inserted, []);
  assert.equal(target.prepare('SELECT COUNT(*) AS count FROM accounts').get().count, 1);
  assert.equal(source.prepare('SELECT COUNT(*) AS count FROM talk_ai_reports').get().count, 1);
  for (const database of [source, target]) { database.exec('BEGIN'); database.exec('ROLLBACK'); }
  assert.equal(pool.releases(), 1);
});

test('failure during AI-row import rolls back all previously copied identities, sources and reports', async t => {
  const source = sourceFixture(), target = openAuthDatabase(':memory:');
  t.after(() => { source.close(); target.close(); });
  const pool = fixturePool(target, { failTable: 'talk_ai_report_revisions' });
  await assert.rejects(importSqlite(source, pool), /Injected import failure/);
  assert.ok(pool.inserted.includes('talk_ai_consents'));
  for (const table of ['accounts', 'talk_recordings', ...aiTables]) assert.equal(target.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0);
  assert.equal(source.prepare('SELECT COUNT(*) AS count FROM talk_ai_report_revisions').get().count, 1);
  assert.equal(pool.releases(), 1);
});

test('legacy SQLite databases without Phase 9 tables still import existing recording data', async t => {
  const source = sourceFixture(), target = openAuthDatabase(':memory:');
  t.after(() => { source.close(); target.close(); });
  for (const table of [...aiTables].reverse()) source.exec(`DROP TABLE ${table}`);
  source.exec('DROP TABLE password_reset_challenges');
  const counts = await importSqlite(source, fixturePool(target));
  assert.equal(counts.password_reset_challenges, 0);
  for (const table of aiTables) assert.equal(counts[table], 0);
  assert.equal(counts.talk_recordings, 1);
  assert.equal(counts.talk_transcript_segments, 1);
  assert.equal(target.prepare('SELECT text FROM talk_transcript_segments').get().text, source.prepare('SELECT text FROM talk_transcript_segments').get().text);
});
