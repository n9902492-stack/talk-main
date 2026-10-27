import { createHash, randomUUID } from 'node:crypto';

const unavailable = () => { throw new Error('A completed, unexpired transcript is required.'); };
const corrupt = () => { throw new Error('Transcript revision integrity validation failed.'); };

/** A versioned canonical representation; neither names nor missing metadata are inferred. */
export function transcriptContentHash({ language, segments }) {
  return createHash('sha256').update(JSON.stringify({ version: 1, language, segments }), 'utf8').digest('hex');
}

function canonicalSegments(rows) {
  let previousIndex = -1, previousStart = 0;
  if (rows.length > 30000) corrupt();
  return rows.map(row => {
    const index = Number(row.segment_index ?? row.segmentId);
    const startMs = Number(row.start_ms ?? row.startMs), endMs = Number(row.end_ms ?? row.endMs);
    if (!Number.isSafeInteger(index) || index <= previousIndex || !Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) || startMs < previousStart || endMs < startMs || startMs < 0 || typeof row.text !== 'string' || row.text.length > 10000 || row.speaker != null && typeof row.speaker !== 'string' || row.language != null && typeof row.language !== 'string') corrupt();
    previousIndex = index; previousStart = startMs;
    return { segmentId: String(index), startMs, endMs, text: row.text, speaker: row.speaker ?? null, language: row.language ?? null };
  });
}

function mapRevision(row) {
  let parsed;
  try { parsed = JSON.parse(row.segments_json); } catch { corrupt(); }
  if (!Array.isArray(parsed)) corrupt();
  const segments = canonicalSegments(parsed);
  if (row.content_hash !== transcriptContentHash({ language: row.language, segments })) corrupt();
  return { id: row.id, recordingId: row.recording_id, revision: Number(row.revision), contentHash: row.content_hash, language: row.language, segments, createdAt: Number(row.created_at), expiresAt: Number(row.expires_at) };
}

async function recordingSource(db, recordingId, time) {
  const recording = await db.prepare('SELECT * FROM talk_recordings WHERE id=?').get(recordingId);
  if (!recording || recording.status !== 'completed' || recording.transcript_status !== 'completed' || recording.deleted_at != null || Number(recording.expires_at) <= time) unavailable();
  return recording;
}

/** Call inside the existing meeting transaction/lock to serialize revision allocation. */
export async function ensureTranscriptRevision({ db, recordingId, now = Date.now }) {
  const time = typeof now === 'function' ? now() : now;
  const recording = await recordingSource(db, recordingId, time);
  const rows = await db.prepare('SELECT * FROM talk_transcript_segments WHERE recording_id=? ORDER BY segment_index').all(recordingId);
  const language = recording.transcript_language || recording.language || 'und', segments = canonicalSegments(rows);
  const contentHash = transcriptContentHash({ language, segments });
  const latest = await db.prepare('SELECT * FROM talk_transcript_revisions WHERE recording_id=? ORDER BY revision DESC LIMIT 1').get(recordingId);
  if (latest && latest.content_hash === contentHash) return mapRevision(latest);
  const id = randomUUID(), revision = latest ? Number(latest.revision) + 1 : 1;
  await db.prepare('INSERT INTO talk_transcript_revisions(id,recording_id,revision,content_hash,language,segments_json,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)').run(id, recordingId, revision, contentHash, language, JSON.stringify(segments), time, Number(recording.expires_at));
  return { id, recordingId, revision, contentHash, language, segments, createdAt: time, expiresAt: Number(recording.expires_at) };
}

/** Reads are private-service helpers, not authorization boundaries. Check meeting access first. */
export async function readTranscriptRevision({ db, revisionId, now = Date.now }) {
  const time = typeof now === 'function' ? now() : now;
  const row = await db.prepare('SELECT * FROM talk_transcript_revisions WHERE id=?').get(revisionId);
  if (!row || Number(row.expires_at) <= time) unavailable();
  await recordingSource(db, row.recording_id, time);
  return mapRevision(row);
}
