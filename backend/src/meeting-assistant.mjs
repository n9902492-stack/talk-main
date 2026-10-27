import { createHash, randomUUID } from 'node:crypto';
import { MeetingError } from './meeting-management.mjs';
import { ensureTranscriptRevision, readTranscriptRevision } from './transcript-revisions.mjs';
import { emptyAssistantReport, validateAssistantReport } from './assistant-grounding.mjs';
import { createOllamaProvider } from './assistant-provider.mjs';

export const aiNoticeVersion = 'talk-ai-v1';
export const aiNotice = 'Allow this recording transcript to be processed locally into private AI meeting notes, employee updates and action-item drafts for the host and authorized co-hosts. No transcript is sent to an external AI provider. AI drafts require manager review. You can withdraw permission.';
const fail = (status, code, message) => { throw new MeetingError(status, code, message); };
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const promptVersion = 'talk-assistant-foundation-v1';

export function createMeetingAssistant({ db, manager, provider = createOllamaProvider(), now = Date.now,
  jobTimeoutMs = 120000, leaseMs = 30000, retryDelayMs = 1000, maxAttempts = 3, autoStart = false } = {}) {
  const get = (sql, ...params) => db.prepare(sql).get(...params);
  const all = (sql, ...params) => db.prepare(sql).all(...params);
  const run = (sql, ...params) => db.prepare(sql).run(...params);
  const workerId = randomUUID(), controllers = new Map();
  let closed = false, ticking = null;
  const leaseDuration = Math.max(100, Math.min(60000, Number(leaseMs) || 30000));
  const attemptsLimit = Math.max(1, Math.min(3, Number(maxAttempts) || 3));
  const audit = (reportId, actor, action, detail = {}) => run('INSERT INTO talk_ai_events(id,report_id,actor_account_id,action,detail_json,created_at) VALUES (?,?,?,?,?,?)', randomUUID(), reportId, actor || null, action, JSON.stringify(detail), now());
  async function transaction(meetingId, operation) {
    await db.exec('BEGIN IMMEDIATE');
    try {
      if (meetingId) await db.lockIdentity(`meeting:${meetingId}`);
      await db.lockIdentity('assistant:global');
      const value = await operation(); await db.exec('COMMIT'); return value;
    } catch (error) { await db.exec('ROLLBACK'); throw error; }
  }
  async function authorize(meetingId, session, ownerOnly = false) {
    const meeting = await manager.meeting(meetingId), member = meeting && await manager.member(meetingId, session?.account_id);
    if (!meeting || !member || member.admission !== 'admitted'
      || meeting.owner_account_id !== session?.account_id && member.role !== 'cohost') fail(404, 'ai_report_unavailable', 'This private meeting report is not available.');
    if (ownerOnly && meeting.owner_account_id !== session.account_id) fail(403, 'ai_approval_owner_required', 'Only the meeting owner can approve this report.');
    return meeting;
  }
  async function recordingRow(recordingId) {
    const recording = await get('SELECT * FROM talk_recordings WHERE id=?', recordingId);
    if (!recording || recording.status !== 'completed' || recording.expires_at <= now()) fail(404, 'ai_source_unavailable', 'A selected recording is unavailable or expired.');
    if (recording.transcript_status !== 'completed') fail(409, 'ai_transcript_not_ready', 'Wait for the selected transcript to finish processing.');
    return recording;
  }
  async function consentInfo(recording, revision) {
    const people = await all("SELECT account_id,decision FROM talk_recording_consents WHERE recording_id=?", recording.id);
    const accepted = people.filter(person => person.decision === 'accepted');
    const consents = await all('SELECT account_id,decision FROM talk_ai_consents WHERE recording_id=? AND transcript_revision_id=? AND notice_version=?', recording.id, revision.id, aiNoticeVersion);
    const approved = accepted.filter(person => consents.some(consent => consent.account_id === person.account_id && consent.decision === 'accepted')).length;
    const declined = people.some(person => person.decision !== 'accepted') || consents.some(consent => consent.decision === 'declined');
    return { required: accepted.length, accepted: approved, declined,
      eligible: people.length > 0 && !declined && approved === accepted.length,
      reason: !people.length ? 'recording_consent_missing' : declined ? 'consent_declined' : approved !== accepted.length ? 'ai_consent_required' : null };
  }
  async function selectedSources(meetingId, recordingIds) {
    if (!Array.isArray(recordingIds) || !recordingIds.length || recordingIds.length > 20
      || recordingIds.some(id => typeof id !== 'string' || !id || id.length > 100) || new Set(recordingIds).size !== recordingIds.length) fail(400, 'invalid_ai_sources', 'Choose between one and twenty distinct completed recordings.');
    const sources = [];
    for (const id of recordingIds) {
      const recording = await recordingRow(id);
      if (recording.meeting_id !== meetingId) fail(404, 'ai_source_unavailable', 'A selected recording is unavailable.');
      const revision = await ensureTranscriptRevision({ db, recordingId: id, now });
      if (!revision.segments.length) fail(409, 'ai_transcript_empty', 'A selected transcript contains no speech.');
      sources.push({ ...revision, consent: await consentInfo(recording, revision) });
    }
    return sources;
  }
  const sourceHash = sources => digest(sources.map(source => ({ recordingId: source.recordingId, revisionId: source.id, contentHash: source.contentHash })));
  const requireConsent = sources => { if (sources.some(source => !source.consent.eligible)) fail(409, 'ai_consent_required', 'Every recorded participant must explicitly consent to AI processing of this transcript version.'); };
  async function reportRow(id, session, ownerOnly = false) {
    const report = await get('SELECT * FROM talk_ai_reports WHERE id=? AND deleted_at IS NULL', id);
    if (!report || report.expires_at <= now()) fail(404, 'ai_report_unavailable', 'This private meeting report is unavailable or expired.');
    await authorize(report.meeting_id, session, ownerOnly); return report;
  }
  async function reportSources(report) {
    const manifest = await all('SELECT * FROM talk_ai_report_sources WHERE report_id=? ORDER BY ordinal', report.id);
    if (!manifest.length) fail(404, 'ai_source_unavailable', 'The report source is no longer available.');
    const sources = await selectedSources(report.meeting_id, manifest.map(source => source.recording_id));
    if (sources.some((source, index) => source.id !== manifest[index].transcript_revision_id) || sourceHash(sources) !== report.source_hash) fail(409, 'ai_source_changed', 'The transcript changed. Create a new draft using the current transcript and consent.');
    requireConsent(sources); return sources;
  }
  async function response(report) {
    const revision = await get('SELECT * FROM talk_ai_report_revisions WHERE report_id=? AND revision=?', report.id, report.current_revision);
    const jobs = await all('SELECT id,status,attempts,error_code,created_at,updated_at FROM talk_ai_jobs WHERE report_id=? ORDER BY created_at', report.id);
    return { report: { id: report.id, meetingId: report.meeting_id, status: report.status, currentRevision: Number(report.current_revision),
      approvedRevision: report.approved_revision === null ? null : Number(report.approved_revision),
      content: revision ? JSON.parse(revision.content_json) : null, origin: revision?.origin || null,
      sourceHash: report.source_hash, createdAt: Number(report.created_at), updatedAt: Number(report.updated_at), expiresAt: Number(report.expires_at), errorCode: report.error_code },
    jobs: jobs.map(job => ({ id: job.id, status: job.status, attempts: Number(job.attempts), errorCode: job.error_code })) };
  }
  async function appendRevision(report, content, origin, actor, modelDigest = null) {
    const revision = Number(report.current_revision) + 1;
    await run('INSERT INTO talk_ai_report_revisions(id,report_id,revision,content_json,origin,author_account_id,model_digest,prompt_version,schema_version,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)', randomUUID(), report.id, revision, JSON.stringify(content), origin, actor || null, modelDigest, promptVersion, '1', now());
    await run('UPDATE talk_ai_reports SET current_revision=?,updated_at=? WHERE id=?', revision, now(), report.id);
    return revision;
  }
  async function lockedReport(id, session, operation, ownerOnly = false) {
    const initial = await reportRow(id, session, ownerOnly);
    return transaction(initial.meeting_id, async () => operation(await reportRow(id, session, ownerOnly)));
  }
  const expected = (report, value) => { if (!Number.isSafeInteger(value) || value !== Number(report.current_revision)) fail(409, 'ai_revision_conflict', 'This draft changed. Reload it before continuing.'); };
  const editable = report => { if (report.status === 'approved' || report.status === 'processing') fail(409, 'ai_report_locked', 'An approved or processing report cannot be edited. Create a new draft or cancel processing first.'); };

  async function eligibility(meetingId, session, { recordingIds } = {}) {
    return transaction(meetingId, async () => {
      await authorize(meetingId, session);
      const ids = recordingIds || (await all("SELECT id FROM talk_recordings WHERE meeting_id=? AND status='completed' AND transcript_status='completed' AND expires_at>? ORDER BY created_at LIMIT 20", meetingId, now())).map(row => row.id);
      if (!ids.length) return { eligible: false, recordings: [], noticeVersion: aiNoticeVersion, notice: aiNotice, providerConfigured: provider.configured === true };
      const sources = await selectedSources(meetingId, ids);
      return { eligible: sources.every(source => source.consent.eligible), noticeVersion: aiNoticeVersion, notice: aiNotice, providerConfigured: provider.configured === true,
        recordings: sources.map(source => ({ id: source.recordingId, revisionId: source.id, revision: source.revision, contentHash: source.contentHash, language: source.language, consent: source.consent, eligible: source.consent.eligible })) };
    });
  }
  async function consentState(recordingId, session) {
    const recording = await recordingRow(recordingId);
    return transaction(recording.meeting_id, async () => {
      const original = await get("SELECT decision FROM talk_recording_consents WHERE recording_id=? AND account_id=?", recordingId, session.account_id);
      if (!original || original.decision !== 'accepted') fail(404, 'ai_consent_unavailable', 'This consent request is unavailable.');
      const revision = await ensureTranscriptRevision({ db, recordingId, now });
      const own = await get('SELECT decision FROM talk_ai_consents WHERE recording_id=? AND transcript_revision_id=? AND account_id=? AND notice_version=?', recordingId, revision.id, session.account_id, aiNoticeVersion);
      return { recordingId, revisionId: revision.id, noticeVersion: aiNoticeVersion, notice: aiNotice, decision: own?.decision || null };
    });
  }
  async function purgeReport(report, actor, reason) {
    const jobs = await all("SELECT id FROM talk_ai_jobs WHERE report_id=? AND status IN ('queued','running')", report.id);
    for (const job of jobs) controllers.get(job.id)?.abort();
    await run("UPDATE talk_ai_jobs SET status=CASE WHEN status IN ('queued','running') THEN 'cancelled' ELSE status END,checkpoint_json='{}',lease_owner=NULL,lease_expires_at=NULL,error_code=?,updated_at=? WHERE report_id=?", reason, now(), report.id);
    await run('DELETE FROM talk_ai_report_revisions WHERE report_id=?', report.id);
    await run("UPDATE talk_ai_reports SET status='cancelled',current_revision=0,approved_revision=NULL,deleted_at=?,updated_at=?,error_code=? WHERE id=?", now(), now(), reason, report.id);
    await audit(report.id, actor, 'deleted', { reason });
  }
  async function onSourceUnavailable(recordingId) {
    const reports = await all('SELECT r.* FROM talk_ai_reports r JOIN talk_ai_report_sources s ON s.report_id=r.id WHERE s.recording_id=? AND r.deleted_at IS NULL', recordingId);
    for (const report of reports) await purgeReport(report, null, 'source_unavailable');
  }
  async function consent(recordingId, session, body) {
    if (!body || !['accepted', 'declined'].includes(body.decision) || body.noticeVersion !== aiNoticeVersion || typeof body.revisionId !== 'string') fail(400, 'invalid_ai_consent', 'Read the current AI processing notice and choose accept or decline.');
    const recording = await recordingRow(recordingId);
    return transaction(recording.meeting_id, async () => {
      const original = await get('SELECT decision FROM talk_recording_consents WHERE recording_id=? AND account_id=?', recordingId, session.account_id);
      const member = await manager.member(recording.meeting_id, session.account_id);
      if (!original || original.decision !== 'accepted' || body.decision === 'accepted' && member?.admission !== 'admitted') fail(404, 'ai_consent_unavailable', 'This consent request is unavailable.');
      let revision;
      try { revision = await readTranscriptRevision({ db, revisionId: body.revisionId, now }); }
      catch { fail(404, 'ai_consent_unavailable', 'This transcript version is unavailable.'); }
      if (!revision || revision.recordingId !== recordingId) fail(404, 'ai_consent_unavailable', 'This transcript version is unavailable.');
      const current = await ensureTranscriptRevision({ db, recordingId, now });
      if (body.decision === 'accepted' && current.id !== revision.id) fail(409, 'ai_source_changed', 'Read the consent notice for the current transcript version.');
      await run('INSERT INTO talk_ai_consents(recording_id,transcript_revision_id,account_id,notice_version,decision,decided_at) VALUES (?,?,?,?,?,?) ON CONFLICT(recording_id,transcript_revision_id,account_id,notice_version) DO UPDATE SET decision=excluded.decision,decided_at=excluded.decided_at', recordingId, revision.id, session.account_id, aiNoticeVersion, body.decision, now());
      await run('INSERT INTO talk_recording_events(id,recording_id,actor_account_id,action,detail,created_at) VALUES (?,?,?,?,?,?)', randomUUID(), recordingId, session.account_id, `ai_processing_${body.decision}`, JSON.stringify({ revisionId: revision.id, noticeVersion: aiNoticeVersion }), now());
      if (body.decision === 'declined') await onSourceUnavailable(recordingId);
      return { ok: true, recordingId, revisionId: revision.id, decision: body.decision, noticeVersion: aiNoticeVersion };
    });
  }
  async function create(meetingId, session, { recordingIds } = {}) {
    return transaction(meetingId, async () => {
      await authorize(meetingId, session);
      const sources = await selectedSources(meetingId, recordingIds); requireConsent(sources);
      const id = randomUUID(), expiry = Math.min(...sources.map(source => Number(source.expiresAt)));
      await run("INSERT INTO talk_ai_reports(id,meeting_id,created_by,status,source_hash,created_at,updated_at,expires_at,current_revision) VALUES (?,?,?,'draft',?,?,?,?,0)", id, meetingId, session.account_id, sourceHash(sources), now(), now(), expiry);
      for (let index = 0; index < sources.length; index++) await run('INSERT INTO talk_ai_report_sources(report_id,recording_id,transcript_revision_id,ordinal) VALUES (?,?,?,?)', id, sources[index].recordingId, sources[index].id, index);
      let report = await get('SELECT * FROM talk_ai_reports WHERE id=?', id);
      await appendRevision(report, emptyAssistantReport(), 'manager', session.account_id);
      await audit(id, session.account_id, 'created', { sources: sources.length });
      report = await get('SELECT * FROM talk_ai_reports WHERE id=?', id); return response(report);
    });
  }
  async function read(id, session) { return lockedReport(id, session, async report => { await reportSources(report); return response(report); }); }
  async function list(meetingId, session) {
    await authorize(meetingId, session);
    const reports = await all('SELECT id,status,current_revision,approved_revision,created_at,updated_at,expires_at FROM talk_ai_reports WHERE meeting_id=? AND deleted_at IS NULL AND expires_at>? ORDER BY created_at DESC LIMIT 100', meetingId, now());
    return { reports: reports.map(report => ({ id: report.id, status: report.status, currentRevision: Number(report.current_revision), approvedRevision: report.approved_revision === null ? null : Number(report.approved_revision), createdAt: Number(report.created_at), expiresAt: Number(report.expires_at) })), providerConfigured: provider.configured === true };
  }
  async function edit(id, session, body) {
    return lockedReport(id, session, async report => {
      expected(report, body?.expectedRevision); editable(report);
      const sources = await reportSources(report); let content;
      try { content = validateAssistantReport(body.content, sources); } catch { fail(400, 'invalid_ai_evidence', 'Each report statement needs valid transcript evidence. Keep uncertain speakers, owners and deadlines marked for review.'); }
      await appendRevision(report, content, 'manager', session.account_id);
      await run("UPDATE talk_ai_reports SET status='review_required',error_code=NULL WHERE id=?", id);
      await audit(id, session.account_id, 'edited'); return response(await reportRow(id, session));
    });
  }
  async function approve(id, session, body) {
    return lockedReport(id, session, async report => {
      expected(report, body?.expectedRevision);
      if (report.status !== 'review_required') fail(409, 'ai_not_reviewable', 'Review a completed report draft before approving it.');
      const sources = await reportSources(report), revision = await get('SELECT content_json FROM talk_ai_report_revisions WHERE report_id=? AND revision=?', id, report.current_revision);
      let content; try { content = validateAssistantReport(JSON.parse(revision.content_json), sources); } catch { fail(409, 'invalid_ai_evidence', 'Review the report evidence before approval.'); }
      if (!Object.entries(content).some(([key, value]) => key !== 'schemaVersion' && Array.isArray(value) && value.length)) fail(409, 'ai_empty_report', 'An empty report cannot be approved.');
      await run("UPDATE talk_ai_reports SET status='approved',approved_revision=current_revision,updated_at=? WHERE id=?", now(), id);
      await audit(id, session.account_id, 'approved', { revision: Number(report.current_revision) }); return response(await reportRow(id, session));
    }, true);
  }
  async function generate(id, session, body) {
    return lockedReport(id, session, async report => {
      if (report.status === 'approved') fail(409, 'ai_report_locked', 'An approved report cannot be regenerated. Create a new draft.');
      if (!provider.configured) fail(503, 'assistant_provider_disabled', 'Local AI generation is disabled pending separate Ollama installation and model benchmarking approval.');
      const key = digest([report.id, report.source_hash, body?.expectedRevision, session.account_id, provider.modelDigest || 'fixture', promptVersion]);
      const existing = await get('SELECT id,status FROM talk_ai_jobs WHERE idempotency_key=?', key);
      await reportSources(report);
      if (existing) return { job: existing, ...(await response(report)), idempotent: true };
      expected(report, body?.expectedRevision); editable(report);
      const jobId = randomUUID();
      await run("INSERT INTO talk_ai_jobs(id,report_id,requested_by,idempotency_key,status,next_run_at,created_at,updated_at) VALUES (?,?,?,?,'queued',?,?,?)", jobId, id, session.account_id, key, now(), now(), now());
      await run("UPDATE talk_ai_reports SET status='processing',updated_at=?,error_code=NULL WHERE id=?", now(), id);
      await audit(id, session.account_id, 'generation_requested'); return { job: { id: jobId, status: 'queued' }, ...(await response(await reportRow(id, session))) };
    });
  }
  async function retry(id, session, body) {
    return lockedReport(id, session, async report => {
      expected(report, body?.expectedRevision);
      if (report.status !== 'failed') fail(409, 'ai_retry_unavailable', 'Only a failed report job can be retried.');
      if (!provider.configured) fail(503, 'assistant_provider_disabled', 'Local AI generation is disabled pending separate installation and benchmarking approval.');
      await reportSources(report);
      const job = await get("SELECT * FROM talk_ai_jobs WHERE report_id=? AND status='failed' ORDER BY created_at DESC LIMIT 1", id);
      if (!job) fail(409, 'ai_retry_unavailable', 'No failed report job is available.');
      await run("UPDATE talk_ai_jobs SET status='queued',requested_by=?,attempts=0,next_run_at=?,lease_owner=NULL,lease_expires_at=NULL,checkpoint_json='{}',error_code=NULL,updated_at=? WHERE id=? AND status='failed'", session.account_id, now(), now(), job.id);
      await run("UPDATE talk_ai_reports SET status='processing',error_code=NULL,updated_at=? WHERE id=?", now(), id);
      await audit(id, session.account_id, 'retry_requested');
      return { job: { id: job.id, status: 'queued' }, ...(await response(await reportRow(id, session))) };
    });
  }
  async function cancel(id, session) {
    return lockedReport(id, session, async report => {
      if (report.status === 'approved') fail(409, 'ai_report_locked', 'An approved report cannot be cancelled.');
      const jobs = await all("SELECT id FROM talk_ai_jobs WHERE report_id=? AND status IN ('queued','running')", id);
      for (const job of jobs) controllers.get(job.id)?.abort();
      await run("UPDATE talk_ai_jobs SET status='cancelled',lease_owner=NULL,lease_expires_at=NULL,checkpoint_json='{}',updated_at=? WHERE report_id=? AND status IN ('queued','running')", now(), id);
      await run("UPDATE talk_ai_reports SET status='cancelled',updated_at=?,error_code=NULL WHERE id=?", now(), id); await audit(id, session.account_id, 'cancelled');
      return response(await reportRow(id, session));
    });
  }
  async function remove(id, session) { return lockedReport(id, session, async report => { await purgeReport(report, session.account_id, 'manager_deleted'); return { ok: true }; }); }
  async function usableJob(job) {
    const report = await get('SELECT * FROM talk_ai_reports WHERE id=? AND deleted_at IS NULL', job.report_id);
    if (!report || report.status !== 'processing' || report.expires_at <= now()) fail(409, 'ai_job_obsolete', 'This report job is no longer eligible.');
    await authorize(report.meeting_id, { account_id: job.requested_by });
    return { report, sources: await reportSources(report) };
  }
  async function processJob(job) {
    const controller = new AbortController(); controllers.set(job.id, controller);
    let renewal, deadline, onAbort;
    try {
      const { report, sources } = await db.withContext(() => usableJob(job));
      const owned = async () => {
        const current = await get('SELECT * FROM talk_ai_jobs WHERE id=?', job.id);
        if (!current || current.status !== 'running' || current.lease_owner !== workerId || current.lease_expires_at <= now()) fail(409, 'ai_lease_lost', 'The report worker lease is no longer valid.');
        return current;
      };
      renewal = setInterval(() => { void db.withContext(async () => {
        const changed = await run("UPDATE talk_ai_jobs SET lease_expires_at=?,updated_at=? WHERE id=? AND status='running' AND lease_owner=? AND lease_expires_at>?", now() + leaseDuration, now(), job.id, workerId, now());
        if (!changed.changes) controller.abort();
      }).catch(() => controller.abort()); }, Math.max(25, Math.floor(leaseDuration / 3))); renewal.unref();
      const onCheckpoint = value => db.withContext(() => transaction(report.meeting_id, async () => {
        await owned(); await usableJob(job);
        const json = JSON.stringify(value);
        if (!value || Object.getPrototypeOf(value) !== Object.prototype || json.length > 131072 || controller.signal.aborted) throw new Error('Invalid checkpoint');
        await run("UPDATE talk_ai_jobs SET checkpoint_json=?,updated_at=? WHERE id=? AND status='running' AND lease_owner=?", json, now(), job.id, workerId);
      }));
      const output = await Promise.race([
        Promise.resolve().then(() => provider.generate({ sources, checkpoint: JSON.parse(job.checkpoint_json), signal: controller.signal, onCheckpoint })),
        new Promise((_, reject) => {
          onAbort = () => reject(new Error('Cancelled'));
          controller.signal.addEventListener('abort', onAbort, { once: true });
          if (controller.signal.aborted) onAbort();
          deadline = setTimeout(() => { controller.abort(); reject(new Error('Deadline exceeded')); }, Math.max(50, Math.min(600000, jobTimeoutMs)));
        }),
      ]);
      if (controller.signal.aborted) throw new Error('Cancelled');
      const content = validateAssistantReport(output, sources);
      await db.withContext(() => transaction(report.meeting_id, async () => {
        await owned(); const current = await usableJob(job);
        if (controller.signal.aborted) throw new Error('Cancelled');
        await appendRevision(current.report, content, 'ai', null, provider.modelDigest || 'fixture');
        await run("UPDATE talk_ai_reports SET status='review_required',updated_at=?,error_code=NULL WHERE id=? AND status='processing' AND deleted_at IS NULL", now(), report.id);
        await run("UPDATE talk_ai_jobs SET status='completed',lease_owner=NULL,lease_expires_at=NULL,checkpoint_json='{}',error_code=NULL,updated_at=? WHERE id=? AND lease_owner=?", now(), job.id, workerId);
        await audit(report.id, null, 'generation_completed');
      }));
    } catch {
      await db.withContext(() => transaction(null, async () => {
        const current = await get('SELECT * FROM talk_ai_jobs WHERE id=?', job.id);
        if (!current || current.status !== 'running' || current.lease_owner !== workerId || current.lease_expires_at <= now()) return;
        let eligible = true; try { await usableJob(job); } catch { eligible = false; }
        const retry = eligible && (closed || Number(current.attempts) < attemptsLimit);
        await run('UPDATE talk_ai_jobs SET status=?,lease_owner=NULL,lease_expires_at=NULL,next_run_at=?,error_code=?,updated_at=?,checkpoint_json=CASE WHEN ?=1 THEN checkpoint_json ELSE \'{}\' END WHERE id=? AND lease_owner=?', retry ? 'queued' : eligible ? 'failed' : 'cancelled', now() + Math.min(60000, retryDelayMs * 2 ** Number(current.attempts)), eligible ? 'processing_failed' : 'source_or_permission_changed', now(), retry ? 1 : 0, job.id, workerId);
        await run('UPDATE talk_ai_reports SET status=?,error_code=?,updated_at=? WHERE id=? AND status=\'processing\' AND deleted_at IS NULL', retry ? 'processing' : eligible ? 'failed' : 'cancelled', eligible ? 'processing_failed' : 'source_or_permission_changed', now(), job.report_id);
        await audit(job.report_id, null, retry ? 'generation_retry_queued' : 'generation_failed');
      })).catch(() => {});
    } finally { clearInterval(renewal); clearTimeout(deadline); if (onAbort) controller.signal.removeEventListener('abort', onAbort); controllers.delete(job.id); }
  }
  async function tickInternal() {
    const expired = await all("SELECT DISTINCT r.* FROM talk_ai_reports r LEFT JOIN talk_ai_report_sources s ON s.report_id=r.id LEFT JOIN talk_recordings c ON c.id=s.recording_id LEFT JOIN talk_transcript_revisions v ON v.id=s.transcript_revision_id WHERE r.deleted_at IS NULL AND (r.expires_at<=? OR s.report_id IS NULL OR c.status='deleted' OR c.expires_at<=? OR v.id IS NULL) LIMIT 20", now(), now());
    for (const report of expired) await transaction(report.meeting_id, () => purgeReport(report, null, 'source_unavailable'));
    const job = await transaction(null, async () => {
      const abandoned = await all("SELECT * FROM talk_ai_jobs WHERE status='running' AND (lease_expires_at IS NULL OR lease_expires_at<=?)", now());
      for (const lost of abandoned) {
        const exhausted = Number(lost.attempts) >= attemptsLimit;
        await run("UPDATE talk_ai_jobs SET status=?,lease_owner=NULL,lease_expires_at=NULL,next_run_at=?,updated_at=?,error_code='worker_lost' WHERE id=? AND status='running' AND (lease_expires_at IS NULL OR lease_expires_at<=?)", exhausted ? 'failed' : 'queued', now(), now(), lost.id, now());
        if (exhausted) await run("UPDATE talk_ai_reports SET status='failed',error_code='worker_lost',updated_at=? WHERE id=? AND status='processing' AND deleted_at IS NULL", now(), lost.report_id);
      }
      if (!provider.configured || closed) return null;
      const running = await get("SELECT id FROM talk_ai_jobs WHERE status='running' AND lease_expires_at>? LIMIT 1", now());
      const media = await get("SELECT id FROM talk_recordings WHERE status IN ('starting','recording','stopping') OR transcript_status='processing' LIMIT 1");
      if (running || media) return null;
      const next = await get("SELECT j.* FROM talk_ai_jobs j JOIN talk_ai_reports r ON r.id=j.report_id WHERE j.status='queued' AND j.next_run_at<=? AND r.status='processing' AND r.deleted_at IS NULL ORDER BY j.created_at,j.id LIMIT 1", now());
      if (!next) return null;
      await run("UPDATE talk_ai_jobs SET status='running',attempts=attempts+1,lease_owner=?,lease_expires_at=?,updated_at=? WHERE id=? AND status='queued'", workerId, now() + leaseDuration, now(), next.id);
      return { ...next, attempts: Number(next.attempts) + 1, lease_owner: workerId };
    });
    if (job) await processJob(job);
  }
  const tick = () => {
    if (closed) return Promise.resolve();
    if (ticking) return ticking;
    ticking = db.withContext(tickInternal).finally(() => { ticking = null; }); return ticking;
  };
  const timer = autoStart ? setInterval(() => { void tick().catch(() => {}); }, 2000) : null; timer?.unref();
  async function shutdown() { closed = true; clearInterval(timer); for (const controller of controllers.values()) controller.abort(); await ticking?.catch(() => {}); }
  return { configured: provider.configured === true, eligibility, consentState, consent, create, get: read, list, edit, generate, retry, approve, cancel, remove, tick, shutdown, onSourceUnavailable };
}
