import { randomUUID } from 'node:crypto';
import { DataPacket_Kind } from 'livekit-server-sdk';
import { MeetingError } from './meeting-management.mjs';
import { exportTranscriptPdf, exportTranscriptText } from './recording-exports.mjs';
import { ensureTranscriptRevision } from './transcript-revisions.mjs';

const captureStates = "'awaiting_consent','starting','recording','stopping'";
const bounded = async (operation, milliseconds, onTimeout = () => {}, signal) => {
  let timer, onAbort;
  try { return await Promise.race([Promise.resolve(operation), new Promise((_, reject) => {
    onAbort = () => reject(new Error('Recording worker was cancelled.'));
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => { onTimeout(); reject(new Error('Recording worker deadline exceeded.')); }, milliseconds);
  })]); } finally { clearTimeout(timer); if (onAbort) signal?.removeEventListener('abort', onAbort); }
};
const error = (status, code, message) => { throw new MeetingError(status, code, message); };
export function createMeetingRecordings({ db, service, manager, runtime = {}, now = Date.now }) {
  const get = (sql, ...p) => db.prepare(sql).get(...p), all = (sql, ...p) => db.prepare(sql).all(...p), run = (sql, ...p) => db.prepare(sql).run(...p);
  const workerId = randomUUID(), captures = new Map(), tasks = new Set(), controllers = new Map(); let ticking = false, closed = false;
  let assistantGuard;
  // In-process lifecycle integration only: never expose a public administrative route.
  const setAssistantGuard = guard => { assistantGuard = guard; };
  const startupTimeout = runtime.startTimeoutMs ?? 90000, stopTimeout = runtime.stopTimeoutMs ?? 180000;
  const transcriptionTimeout = runtime.transcriptionTimeoutMs ?? 3780000;
  const row = id => get('SELECT * FROM talk_recordings WHERE id=?', id);
  const active = id => get(`SELECT * FROM talk_recordings WHERE meeting_id=? AND status IN (${captureStates}) ORDER BY created_at DESC LIMIT 1`, id);
  const audit = (id, account, action, detail = {}) => run('INSERT INTO talk_recording_events(id,recording_id,actor_account_id,action,detail,created_at) VALUES (?,?,?,?,?,?)', randomUUID(), id, account || null, action, JSON.stringify(detail), now());
  async function transaction(id, operation) { await db.exec('BEGIN IMMEDIATE'); try { await db.lockIdentity(`meeting:${id}`); const value = await operation(); await db.exec('COMMIT'); return value; } catch (failure) { await db.exec('ROLLBACK'); throw failure; } }
  const detached = operation => { const promise = db.withContext(operation).catch(() => {}).finally(() => tasks.delete(promise)); tasks.add(promise); return promise; };
  async function notify(id) { const meeting = await manager.meeting(id); if (meeting) try { await bounded(service.admin.sendData(meeting.room_name, new TextEncoder().encode('{}'), DataPacket_Kind.RELIABLE, { topic: 'talk.recording.v1' }),5000); } catch { /* Polling recovers notices. */ } }
  async function authorize(meetingId, session, requireActive = false) {
    const meeting = await manager.meeting(meetingId), member = await manager.member(meetingId, session.account_id);
    if (!meeting || !member || member.admission !== 'admitted' || meeting.owner_account_id !== session.account_id && member.role !== 'cohost') error(404, 'recording_unavailable', 'This private meeting content is not available to your account.');
    if (requireActive && meeting.status !== 'active') error(410, 'meeting_ended', 'This meeting has ended.'); return meeting;
  }
  async function people(meeting) {
    let live; try { live = await bounded(service.admin.listParticipants(meeting.room_name),5000); } catch (failure) { if (failure.status === 404 || failure.code === 'not_found') return []; throw failure; }
    const connections = await all('SELECT c.identity,c.account_id,m.display_name FROM talk_meeting_connections c JOIN talk_meeting_members m ON m.meeting_id=c.meeting_id AND m.account_id=c.account_id JOIN sessions s ON s.token_hash=c.session_hash AND s.account_id=c.account_id WHERE c.meeting_id=? AND c.revoked=0 AND c.expires_at>? AND s.expires_at>? AND s.requires_confirmation=0 AND m.admission=\'admitted\'', meeting.id, now(), now());
    return connections.filter(c => live.some(person => person.identity === c.identity));
  }
  async function acceptedIdentities(recording, meeting) {
    const users = await people(meeting), consents = await all("SELECT account_id FROM talk_recording_consents WHERE recording_id=? AND decision='accepted'", recording.id);
    return users.filter(user => consents.some(consent => consent.account_id === user.account_id)).map(user => user.identity);
  }
  const publicRow = r => ({ id: r.id, meetingId: r.meeting_id, mode: r.mode, language: r.language, status: r.status, createdAt: r.created_at, startedAt: r.started_at, stoppedAt: r.stopped_at, durationMs: r.duration_ms, bytes: r.bytes, expiresAt: r.expires_at, transcriptStatus: r.transcript_status, error: r.error_code ? messages[r.error_code] || 'Recording processing failed. Try another segment.' : null });
  const messages = { recording_bundle_failed: 'The recording client could not be prepared. Run npm run recording:prepare locally before retrying.', recorder_failed: 'The recording worker stopped unexpectedly.', storage_failed: 'The recording could not be saved.', recording_size_limit: 'The recording reached its storage limit.', recording_duration_limit: 'The recording reached its duration limit.', worker_lost: 'The recording worker restarted before capture completed.', recording_timeout: 'Recording finalization timed out. Start a new recording segment.', consent_withdrawn: 'Recording stopped because consent was withdrawn.' };
  async function state(id, session) {
    const meeting = await manager.meeting(id), member = meeting && await manager.member(id, session.account_id);
    if (member && ['removed', 'denied'].includes(member.admission)) error(403, 'meeting_access_denied', 'This meeting is unavailable.');
    const recording = meeting && await active(id), canManage = !!(meeting && member?.admission === 'admitted' && (meeting.owner_account_id === session.account_id || member.role === 'cohost'));
    const own = recording && await get('SELECT decision FROM talk_recording_consents WHERE recording_id=? AND account_id=?', recording.id, session.account_id);
    let pending;
    if (canManage && recording) { const users = [...new Map((await people(meeting)).map(u => [u.account_id, u])).values()]; const consents = await all("SELECT account_id FROM talk_recording_consents WHERE recording_id=? AND decision='accepted'", recording.id); pending = users.filter(u => !consents.some(c => c.account_id === u.account_id)).map(u => ({ accountId: u.account_id, name: u.display_name })); }
    const latestFailure = canManage && !recording ? await get("SELECT * FROM talk_recordings WHERE meeting_id=? AND status='failed' AND stopped_at>? ORDER BY stopped_at DESC LIMIT 1", id, now()-300000) : null;
    const latest = canManage && !recording ? await get("SELECT * FROM talk_recordings WHERE meeting_id=? AND status IN ('processing','completed','failed') AND expires_at>? ORDER BY created_at DESC LIMIT 1", id, now()) : null;
    return { canManage, latest: latest ? publicRow(latest) : null, lastFailure: latestFailure ? {id:latestFailure.id,error:publicRow(latestFailure).error} : null, provider: { configured: !!runtime.configured, name: runtime.name || 'Talk server recording', pauseSupported: false, reason: runtime.reason || '' }, active: recording ? publicRow(recording) : null, consent: { required: !!recording && own?.decision !== 'accepted', decision: own?.decision || 'pending', ...(pending ? { pending } : {}) } };
  }
  async function checkJoin(id, accountId, { existing = false } = {}) { const recording = await active(id); if (!recording || existing && ['awaiting_consent','stopping'].includes(recording.status)) return true; const consent = await get("SELECT 1 AS accepted FROM talk_recording_consents WHERE recording_id=? AND account_id=? AND decision='accepted'", recording.id, accountId); if (!consent) error(409, 'recording_consent_required', 'Review recording consent on the pre-join screen before joining this meeting.'); return true; }
  async function isRecorder(meeting, identity) { return !!await get("SELECT 1 AS active FROM talk_recordings WHERE meeting_id=? AND recorder_identity=? AND status IN ('starting','recording','stopping') AND lease_expires_at>?", meeting.id, identity, now()); }
  async function request(id, session, body) {
    if (!runtime.configured) error(503, 'recording_not_configured', runtime.reason || 'The recording worker is not configured.');
    const mode = body?.mode || 'audio', language = body?.language || 'auto', retention = body?.retentionDays ?? 30;
    if (!['audio', 'video'].includes(mode) || !['auto', 'en', 'hi'].includes(language) || ![7, 30, 90].includes(retention)) error(400, 'invalid_recording', 'Choose a recording mode, English/Hindi language and retention of 7, 30 or 90 days.');
    const created = await transaction(id, async () => {
      const ownedMeeting = await authorize(id, session, true); await db.lockIdentity('recording-owner:'+ownedMeeting.owner_account_id); if (await active(id)) error(409, 'recording_active', 'Finish the current recording segment first.');
      const usage = await get("SELECT COALESCE(SUM(CASE WHEN r.status IN ('awaiting_consent','starting','recording','stopping') THEN 536870912 ELSE r.bytes END),0) AS bytes FROM talk_recordings r JOIN talk_meetings m ON m.id=r.meeting_id WHERE m.owner_account_id=? AND r.status<>'deleted'", (await manager.meeting(id)).owner_account_id);
      if (Number(usage.bytes) + 536870912 > 2147483648) error(413, 'recording_storage_limit', 'Delete older recordings before starting another segment.');
      const recordingId = randomUUID(); await run("INSERT INTO talk_recordings(id,meeting_id,requested_by,mode,language,status,created_at,recorder_identity,expires_at) VALUES (?,?,?,?,?,'awaiting_consent',?,?,?)", recordingId, id, session.account_id, mode, language, now(), `rec_${recordingId}`, now() + retention * 86400000);
      await audit(recordingId, session.account_id, 'consent_requested', { mode, language, retentionDays: retention, noticeVersion: 'talk-recording-v1' }); return recordingId;
    }); await notify(id); return { id: created };
  }
  async function consent(id, recordingId, session, accept) {
    if (typeof accept !== 'boolean') error(400, 'invalid_consent', 'Choose whether you consent to recording.');
    let stopNeeded = false;
    await transaction(id, async () => { const meeting = await manager.meeting(id), member = await manager.member(id, session.account_id), recording = await row(recordingId); if (!meeting || !recording || recording.meeting_id !== id || !captureStates.includes(`'${recording.status}'`) || member && ['removed', 'denied'].includes(member.admission)) error(404, 'recording_unavailable', 'This recording request is no longer active.');
      const previousConsent = await get('SELECT decision FROM talk_recording_consents WHERE recording_id=? AND account_id=?', recordingId, session.account_id);
      if (!accept && previousConsent?.decision === 'accepted') await assistantGuard?.onSourceUnavailable?.(recordingId);
      await run('INSERT INTO talk_recording_consents(recording_id,account_id,decision,decided_at,notice_version) VALUES (?,?,?,?,?) ON CONFLICT(recording_id,account_id) DO UPDATE SET decision=excluded.decision,decided_at=excluded.decided_at,notice_version=excluded.notice_version', recordingId, session.account_id, accept ? 'accepted' : 'declined', now(), 'talk-recording-v1');
      await audit(recordingId, session.account_id, accept ? 'consent_accepted' : 'consent_declined');
      if (!accept && previousConsent?.decision === 'accepted' && member?.admission === 'admitted' && ['starting', 'recording'].includes(recording.status)) { stopNeeded = true; await run("UPDATE talk_recordings SET status='stopping',error_code='consent_withdrawn' WHERE id=?", recordingId); }
    });
    if (stopNeeded) detached(() => stopInternal(recordingId, 'consent_withdrawn')); await notify(id); return { ok: true };
  }
  async function start(id, recordingId, session) {
    const meeting = await authorize(id, session, true), users = await people(meeting);
    if(await manager.hasScheduledGuests?.(id))error(409,'guest_recording_consent_unavailable','Recording is unavailable while booking guests are admitted. Guest recording consent is not enabled.');
    if (!users.length) error(409, 'meeting_empty', 'Join the meeting before starting a recording.');
    await transaction(id, async () => {
      await authorize(id, session, true); const recording = await row(recordingId); if (!recording || recording.meeting_id !== id || recording.status !== 'awaiting_consent') error(409, 'recording_not_ready', 'This segment is not ready to start.');
      if(await manager.hasScheduledGuests?.(id))error(409,'guest_recording_consent_unavailable','Recording is unavailable while booking guests are admitted.');
      await db.lockIdentity('recording-capacity');
      const capacity=await get("SELECT COUNT(*) AS count FROM talk_recordings WHERE status IN ('starting','recording','stopping')");
      if(capacity.count>=2)error(429,'recording_capacity','The recording workers are busy. Try again after another recording stops.');
      if(recording.mode==='video'&&users.length>16)error(413,'recording_participant_limit','Video recording supports up to 16 connected participants. Choose audio-only for a larger meeting.');
      for (const user of users) if (!await get("SELECT 1 AS accepted FROM talk_recording_consents WHERE recording_id=? AND account_id=? AND decision='accepted'", recordingId, user.account_id)) error(409, 'consent_pending', 'Every connected participant must consent before recording starts.');
      await run("UPDATE talk_recordings SET status='starting',worker_id=?,lease_expires_at=? WHERE id=?", workerId, now() + startupTimeout + 30000, recordingId); await audit(recordingId, session.account_id, 'start_requested');
    });
    detached(() => launch(recordingId)); await notify(id); return { ok: true, status: 'starting' };
  }
  async function launch(recordingId) {
    const entry = { handle: null, starting: true, stopRequested: false, controller: new AbortController() }; captures.set(recordingId, entry);
    let abandoned = false;
    try { await bounded((async () => {
      const recording = await row(recordingId), meeting = await manager.meeting(recording.meeting_id), outputPath = await runtime.storage.allocate(recordingId);
      entry.controller.signal.throwIfAborted();
      await run('UPDATE talk_recordings SET output_path=? WHERE id=?', outputPath, recordingId);
      const starting = runtime.recorder.start({ id: recordingId, roomName: meeting.room_name, identity: recording.recorder_identity, mode: recording.mode, outputPath, allowedIdentities: await acceptedIdentities(recording, meeting), maxBytes: 536870912, maxDurationMs: 7200000, signal: entry.controller.signal, onProgress: stage => audit(recordingId, null, 'worker_stage', {stage}), onFailure: code => detached(() => stopInternal(recordingId, code || 'recorder_failed')) });
      void starting.then(handle => { if (abandoned) return handle.abort(); }).catch(() => {});
      const handle = await bounded(starting, startupTimeout, () => { abandoned = true; entry.controller.abort(); }, entry.controller.signal);
      entry.handle = handle; entry.starting = false;
      const fresh = await row(recordingId);
      if (closed || entry.stopRequested || fresh.status !== 'starting') { detached(() => stopInternal(recordingId)); return; }
      await run("UPDATE talk_recordings SET status='recording',started_at=?,lease_expires_at=? WHERE id=? AND status='starting'", now(), now() + 30000, recordingId); await audit(recordingId, null, 'capture_started'); await notify(recording.meeting_id);
    })(),startupTimeout,()=>{abandoned=true;entry.controller.abort();},entry.controller.signal);
    } catch (failure) { abandoned = true; entry.starting = false; await failed(recordingId, failure?.code === 'recording_bundle_failed' ? failure.code : 'recorder_failed'); }
  }
  async function failed(id, code) {
    const entry = captures.get(id); captures.delete(id); entry?.controller.abort();
    await bounded(Promise.resolve().then(() => entry?.handle?.abort?.()), 5000).catch(() => {});
    const recording = await row(id); if (!recording || ['completed','deleted'].includes(recording.status)) return;
    const changed = await run("UPDATE talk_recordings SET status='failed',error_code=?,stopped_at=?,lease_expires_at=NULL WHERE id=? AND status IN ('starting','recording','stopping','processing') AND (worker_id=? OR lease_expires_at IS NULL OR lease_expires_at<=?)", code, now(), id, workerId, now()); if (!changed.changes) return; await audit(id, null, 'capture_failed', { code });
    if (recording.storage_key || recording.output_path) await queueJob(id, 'delete');
    if (recording.output_path) await runtime.storage?.discard(recording.output_path).catch(() => {});
    await service.admin?.removeParticipant((await manager.meeting(recording.meeting_id)).room_name, recording.recorder_identity).catch(() => {}); await notify(recording.meeting_id);
  }
  async function stopInternal(id, code) {
    const entry = captures.get(id), recording = await row(id); if (!recording || ['completed','processing','failed','deleted'].includes(recording.status)) return;
    if (recording.error_code === 'consent_withdrawn') code = recording.error_code;
    else if (recording.status === 'stopping' && code === 'recorder_disconnected') code = undefined;
    if (entry?.finishing) return entry.finishing;
    if (entry?.starting) { entry.stopRequested = true; await run("UPDATE talk_recordings SET status='stopping' WHERE id=?", id); return; }
    if (!entry?.handle) { if (recording.status === 'awaiting_consent') { await run("UPDATE talk_recordings SET status='deleted',deleted_at=? WHERE id=?", now(), id); await audit(id, null, 'request_cancelled'); await notify(recording.meeting_id); return; }
      if(recording.worker_id!==workerId&&recording.lease_expires_at>now()){await run("UPDATE talk_recordings SET status='stopping' WHERE id=?",id);await service.admin.removeParticipant((await manager.meeting(recording.meeting_id)).room_name,recording.recorder_identity).catch(()=>{});return;}
      await failed(id, code || 'worker_lost'); return; }
    entry.finishing = (async () => {
      await run("UPDATE talk_recordings SET status='stopping' WHERE id=?", id); await notify(recording.meeting_id);
      try { await bounded((async () => {
        const result = await entry.handle.stop();
        if (entry.controller.signal.aborted) return;
        await run("UPDATE talk_recordings SET status='processing' WHERE id=? AND status='stopping' AND worker_id=?", id, workerId);
        await audit(id, null, 'capture_finalizing');
        await notify(recording.meeting_id);
        // Persist the intended private key before upload, so a lost cloud upload
        // acknowledgement can still be cleaned by a durable failure job.
        await run('UPDATE talk_recordings SET storage_key=? WHERE id=?', runtime.storage.keyFor(id), id);
        let stored;
        try { stored = await runtime.storage.commit(id, result); }
        catch (failure) {
          // An upload can fail after creating an object (for example a lost
          // acknowledgement). Re-arm cleanup even if the original deadline's
          // delete job already ran before the late provider response arrived.
          if (entry.controller.signal.aborted) await queueJob(id, 'delete');
          throw failure;
        }
        // A slow upload may resolve after the deadline or after deletion. Never
        // resurrect its database state, and clean a late cloud acknowledgement.
        const current = await row(id);
        if (entry.controller.signal.aborted || current?.status !== 'processing' || current.worker_id !== workerId) {
          await queueJob(id, 'delete'); return;
        }
        const persistedBytes = await runtime.storage.size(stored.key);
        if (!Number.isSafeInteger(persistedBytes) || persistedBytes <= 0 || persistedBytes !== stored.bytes) throw new Error('Recording persistence check failed.');
        const transcriptReady = !!runtime.transcriber?.configured;
        await transaction(recording.meeting_id, async () => {
          if (entry.controller.signal.aborted) { await queueJob(id, 'delete'); return; }
          const saved = await run("UPDATE talk_recordings SET status='completed',started_at=COALESCE(started_at,?),stopped_at=?,duration_ms=?,bytes=?,mime_type=?,storage_key=?,output_path=NULL,lease_expires_at=NULL,error_code=?,transcript_status=? WHERE id=? AND status='processing' AND worker_id=?", now() - result.durationMs, now(), result.durationMs, stored.bytes, stored.mimeType, stored.key, code || null, transcriptReady ? 'queued' : 'unavailable', id, workerId);
          if (!saved.changes) { await queueJob(id, 'delete'); return; }
          if (transcriptReady) await queueJob(id, 'transcribe'); await audit(id, null, 'capture_completed', { reason: code || 'host_stopped', bytes: stored.bytes, durationMs: result.durationMs, diagnostics: result.diagnostics });
        });
      })(), stopTimeout, () => entry.controller.abort()); }
      catch { await failed(id, entry.controller.signal.aborted ? 'recording_timeout' : code || 'storage_failed'); }
      finally { captures.delete(id); await service.admin?.removeParticipant((await manager.meeting(recording.meeting_id)).room_name, recording.recorder_identity).catch(() => {}); await notify(recording.meeting_id); }
    })(); return entry.finishing;
  }
  async function stop(id, recordingId, session) {
    let stopNeeded = false;
    await transaction(id, async () => {
      await authorize(id, session); const r = await row(recordingId);
      if (!r || r.meeting_id !== id) error(404, 'recording_unavailable', 'Recording unavailable.');
      await audit(recordingId, session.account_id, 'stop_requested');
      if (r.status === 'awaiting_consent') {
        await run("UPDATE talk_recordings SET status='deleted',deleted_at=? WHERE id=?", now(), recordingId);
        await audit(recordingId, session.account_id, 'request_cancelled');
      } else if (['starting','recording','stopping'].includes(r.status)) {
        stopNeeded = true; await run("UPDATE talk_recordings SET status='stopping' WHERE id=?", recordingId);
      }
    });
    // Encoder flush/remux/upload must survive a closed HTTP request context.
    if (stopNeeded) detached(() => stopInternal(recordingId));
    detached(() => notify(id)); return { ok: true };
  }
  async function queueJob(id, kind) { await run("INSERT INTO talk_recording_jobs(id,recording_id,kind,status,next_run_at,created_at,updated_at) VALUES (?,?,?,'queued',?,?,?) ON CONFLICT(recording_id,kind) DO UPDATE SET status='queued',attempts=0,next_run_at=excluded.next_run_at,lease_owner=NULL,lease_expires_at=NULL,error_code=NULL,updated_at=excluded.updated_at", randomUUID(), id, kind, now()+(kind==='transcribe'?(runtime.transcriptionDelayMs??15000):0), now(), now()); }
  async function privateRecording(id, session) { const r = await row(id); if (!r || r.status === 'deleted' || r.expires_at <= now()) error(404, 'recording_unavailable', 'Recording unavailable or retention has expired.'); await authorize(r.meeting_id, session); return r; }
  async function remove(id, session) { const r = await privateRecording(id, session); if (['starting','recording','stopping'].includes(r.status)) error(409, 'recording_active', 'Stop the recording before deleting it.'); controllers.get(id)?.controller.abort(); await transaction(r.meeting_id, async () => { await assistantGuard?.onSourceUnavailable?.(id); await run("UPDATE talk_recordings SET status='deleted',deleted_at=?,transcript_status='deleted' WHERE id=?", now(), id); await run('DELETE FROM talk_transcript_segments WHERE recording_id=?', id); await run('DELETE FROM talk_transcript_revisions WHERE recording_id=?', id); await queueJob(id, 'delete'); await audit(id, session.account_id, 'deleted'); }); return { ok: true }; }
  async function transcript(id, session) {
    const r = await privateRecording(id, session);
    const revision = r.transcript_status === 'completed' ? await transaction(r.meeting_id, async () => {
      await privateRecording(id, session);
      return ensureTranscriptRevision({ db, recordingId: id, now });
    }) : null;
    const segments = revision ? revision.segments.map(s => ({ start: s.startMs / 1000, end: s.endMs / 1000, text: s.text, speaker: s.speaker, language: s.language, segmentId: s.segmentId })) : [];
    const job = ['queued','processing','failed'].includes(r.transcript_status) ? await get("SELECT attempts,next_run_at FROM talk_recording_jobs WHERE recording_id=? AND kind='transcribe'",id) : null;
    return { status: r.transcript_status, language: revision?.language || r.transcript_language || r.language, segments, ...(revision ? { revision: { id: revision.id, number: revision.revision, contentHash: revision.contentHash, createdAt: revision.createdAt, expiresAt: revision.expiresAt } } : {}), ...(job ? { processing: { attempt: Number(job.attempts), maxAttempts: 3, nextRetryAt: r.transcript_status === 'queued' && job.next_run_at > now() ? Number(job.next_run_at) : null } } : {}), error: r.transcript_status === 'unavailable' ? 'Install the local multilingual Whisper model to enable transcription, then retry.' : r.transcript_status === 'failed' ? 'Transcription failed. You can retry processing this recording.' : null };
  }
  async function retryTranscript(id, session, body = {}) {
    const r = await privateRecording(id, session);
    if (!runtime.transcriber?.configured) error(503, 'transcription_not_configured', 'The local Whisper transcription worker is not configured.');
    if (body?.language !== undefined && !['auto','en','hi'].includes(body.language)) error(400, 'invalid_language', 'Choose English, Hindi or automatic language detection.');
    await transaction(r.meeting_id, async () => {
      const current = await privateRecording(id, session);
      if (current.status !== 'completed' || ['queued','processing'].includes(current.transcript_status)) error(409, 'transcript_not_ready', 'Wait until recording or processing finishes.');
      const language = body?.language ?? current.language;
      await run("UPDATE talk_recordings SET language=?,transcript_status='queued',transcript_error=NULL WHERE id=?", language, id);
      await queueJob(id, 'transcribe'); await audit(id, session.account_id, 'transcription_retried', { language });
    }); return { ok: true };
  }

  async function history(session) { const rows = await all("SELECT DISTINCT m.*,a.name AS host_name FROM talk_meetings m JOIN accounts a ON a.id=m.owner_account_id JOIN talk_meeting_members p ON p.meeting_id=m.id WHERE p.account_id=? AND p.admission='admitted' AND (m.owner_account_id=? OR p.role='cohost') ORDER BY m.created_at DESC LIMIT 100", session.account_id, session.account_id); return { meetings: await Promise.all(rows.map(async m => ({ id: m.id, title: m.title, createdAt: m.created_at, endedAt: m.ended_at, hostName: m.host_name, participantCount: (await get("SELECT COUNT(*) AS count FROM talk_meeting_members WHERE admission='admitted' AND meeting_id=?", m.id)).count, recordingCount: (await get("SELECT COUNT(*) AS count FROM talk_recordings WHERE meeting_id=? AND status='completed' AND expires_at>?", m.id, now())).count, transcriptCount: (await get("SELECT COUNT(*) AS count FROM talk_recordings WHERE meeting_id=? AND status='completed' AND transcript_status='completed' AND expires_at>?", m.id, now())).count }))) }; }
  async function details(id, session) { const m = await authorize(id, session), host = await get('SELECT name FROM accounts WHERE id=?', m.owner_account_id); return { meeting: { id: m.id, title: m.title, createdAt: m.created_at, endedAt: m.ended_at, hostName: host.name, status: m.status }, participants: (await all("SELECT display_name,role,admission FROM talk_meeting_members WHERE admission='admitted' AND meeting_id=? ORDER BY updated_at", id)).map(p => ({ name: p.display_name, role: p.role, admission: p.admission })), recordings: (await all("SELECT * FROM talk_recordings WHERE meeting_id=? AND status<>'deleted' AND expires_at>? ORDER BY created_at DESC", id, now())).map(publicRow), canManage: true }; }
  async function runJob(job) {
    const controller = new AbortController(), attemptId = randomUUID(); controllers.set(job.recording_id, { controller, jobId: job.id });
    let key;
    try {
      const r = await row(job.recording_id); if (!r) return;
      if (job.kind === 'delete') await bounded((async () => { if (r.storage_key) await runtime.storage.remove(r.storage_key); if (r.output_path) await runtime.storage.discard(r.output_path); })(), stopTimeout, () => controller.abort());
      else if (r.status === 'completed' && r.expires_at > now()) {
        if (!runtime.transcriber?.configured) {
          await run("UPDATE talk_recordings SET transcript_status='unavailable',transcript_error='not_configured' WHERE id=? AND status='completed'", r.id);
          await run("UPDATE talk_recording_jobs SET status='failed',lease_owner=NULL,lease_expires_at=NULL,error_code='not_configured',updated_at=? WHERE id=? AND lease_owner=?",now(),job.id,workerId);
          return;
        }
        key = r.storage_key; await run("UPDATE talk_recordings SET transcript_status='processing' WHERE id=?", r.id);
        await audit(r.id, null, 'transcription_started', { attempt: job.attempts });
        const result = await bounded((async () => {
          const inputPath = await runtime.storage.localPath(key, { attemptId, signal: controller.signal });
          controller.signal.throwIfAborted();
          return runtime.transcriber.transcribe({ inputPath, language: r.language, signal: controller.signal, onProgress: stage => ['preparing_audio','recognizing'].includes(stage) ? audit(r.id,null,'transcription_stage',{stage,attempt:job.attempts}) : undefined });
        })(), transcriptionTimeout, () => controller.abort(), controller.signal);
        if (!Array.isArray(result.segments) || result.segments.length > 30000 || !['en','hi','und','auto'].includes(result.language)) throw new Error('Invalid transcript result.');
        await transaction(r.meeting_id, async () => { const lease = await get('SELECT * FROM talk_recording_jobs WHERE id=?' + (db.kind === 'postgres' ? ' FOR UPDATE' : ''), job.id); if (!lease || lease.status !== 'running' || lease.lease_owner !== workerId || lease.lease_expires_at <= now()) { await audit(r.id,null,'stale_transcription_discarded'); return; } const current = await row(r.id); if (current.status === 'deleted' || controller.signal.aborted) return; await run('DELETE FROM talk_transcript_segments WHERE recording_id=?', r.id);
          let previous = 0;
          for (let i=0;i<result.segments.length;i++) { const s=result.segments[i]; if (!Number.isFinite(s.start)||!Number.isFinite(s.end)||s.start<previous||s.end<s.start||s.end>Math.max(2,r.duration_ms/1000+2)||typeof s.text!=='string'||s.text.length>10000) throw new Error('Invalid transcript segment.'); previous=s.start; await run('INSERT INTO talk_transcript_segments(recording_id,segment_index,start_ms,end_ms,text,speaker,language) VALUES (?,?,?,?,?,?,?)', r.id,i,Math.round(s.start*1000),Math.round(s.end*1000),s.text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,''),null,result.language); }
          await run("UPDATE talk_recordings SET transcript_status='completed',transcript_language=?,transcript_error=NULL WHERE id=?", result.language,r.id); await ensureTranscriptRevision({ db, recordingId: r.id, now }); await audit(r.id,null,'transcription_completed',{segments:result.segments.length}); await run("UPDATE talk_recording_jobs SET status='completed',lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND lease_owner=?",now(),job.id,workerId); });
      }
      if (job.kind === 'delete' || r.status !== 'completed' || r.expires_at <= now()) await run("UPDATE talk_recording_jobs SET status='completed',lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND lease_owner=?", now(),job.id,workerId);
    } catch {
      const again=job.attempts<3;
      const changed = await run("UPDATE talk_recording_jobs SET status=?,next_run_at=?,lease_owner=NULL,lease_expires_at=NULL,error_code='processing_failed',updated_at=? WHERE id=? AND lease_owner=?",again?'queued':'failed',now()+Math.min(300000,5000*2**job.attempts),now(),job.id,workerId);
      if(changed.changes && job.kind==='transcribe') {
        await run("UPDATE talk_recordings SET transcript_status=?,transcript_error='processing_failed' WHERE id=? AND status<>'deleted'",again?'queued':'failed',job.recording_id);
        await audit(job.recording_id, null, again ? 'transcription_retry_scheduled' : 'transcription_failed', { attempt: job.attempts, reason: controller.signal.aborted ? 'cancelled_or_deadline' : 'processing_failed' });
      }
    } finally { if (controllers.get(job.recording_id)?.jobId === job.id) controllers.delete(job.recording_id); if(key)await bounded(Promise.resolve().then(() => runtime.storage.releaseLocal?.(key, { attemptId })), 5000).catch(()=>{}); }
  }
  async function tick() {
    if(ticking||closed||!runtime.storage)return;ticking=true;
    try {
      for(const[id,entry]of captures){const r=await row(id);if(!r||r.worker_id!==workerId||['deleted','failed'].includes(r.status)){entry.controller.abort();await bounded(Promise.resolve().then(() => entry.handle?.abort?.()),5000).catch(()=>{});captures.delete(id);if(r?.output_path)await runtime.storage.discard(r.output_path).catch(()=>{});continue;}await run('UPDATE talk_recordings SET lease_expires_at=? WHERE id=? AND worker_id=?',now()+(entry.starting?startupTimeout:30000)+30000,id,workerId);if(entry.handle&&!entry.finishing){const meeting=await manager.meeting(r.meeting_id);if(r.status==='stopping'||meeting.status!=='active'||!(await people(meeting)).length)detached(()=>stopInternal(id));else try { await entry.handle.setAllowed?.(await acceptedIdentities(r,meeting)); } catch { detached(()=>stopInternal(id,'recorder_failed')); }}}
      for(const[id,work]of controllers){
        const lease = await get('SELECT status,lease_owner FROM talk_recording_jobs WHERE id=?',work.jobId);
        if (!lease || lease.status!=='running' || lease.lease_owner!==workerId) work.controller.abort();
        else await run("UPDATE talk_recording_jobs SET lease_expires_at=? WHERE recording_id=? AND status='running' AND lease_owner=?",now()+120000,id,workerId);
      }
      const lost=await all("SELECT id FROM talk_recordings WHERE status IN ('starting','recording','stopping','processing') AND (lease_expires_at IS NULL OR lease_expires_at<=?)",now());for(const r of lost)await failed(r.id,'worker_lost');
      const expired=await all("SELECT * FROM talk_recordings WHERE status<>'deleted' AND expires_at<? LIMIT 20",now());for(const r of expired){if(captures.has(r.id))await stopInternal(r.id);await transaction(r.meeting_id,async()=>{await assistantGuard?.onSourceUnavailable?.(r.id);await run("UPDATE talk_recordings SET status='deleted',deleted_at=?,transcript_status='deleted' WHERE id=?",now(),r.id);await run('DELETE FROM talk_transcript_segments WHERE recording_id=?',r.id);await run('DELETE FROM talk_transcript_revisions WHERE recording_id=?',r.id);await queueJob(r.id,'delete');await audit(r.id,null,'retention_expired');});}
      await db.exec('BEGIN IMMEDIATE'); let job;
      try {
        await db.lockIdentity('recording-jobs');
        const abandoned = await all("SELECT * FROM talk_recording_jobs WHERE status='running' AND (lease_expires_at IS NULL OR lease_expires_at<=?)",now());
        for(const work of abandoned){const exhausted=work.attempts>=3;const changed=await run("UPDATE talk_recording_jobs SET status=?,lease_owner=NULL,lease_expires_at=NULL,error_code='worker_lost',next_run_at=?,updated_at=? WHERE id=? AND status='running' AND (lease_expires_at IS NULL OR lease_expires_at<=?)",exhausted?'failed':'queued',now(),now(),work.id,now());if(changed.changes&&work.kind==='transcribe'){await run("UPDATE talk_recordings SET transcript_status=?,transcript_error='worker_lost' WHERE id=? AND status='completed'",exhausted?'failed':'queued',work.recording_id);await audit(work.recording_id,null,'transcription_worker_recovered',{attempt:work.attempts,exhausted});}}
        // Reconcile interrupted/legacy state without new tables or duplicate jobs.
        const orphans=await all("SELECT r.id,r.transcript_status,j.id AS job_id,j.status AS job_status FROM talk_recordings r LEFT JOIN talk_recording_jobs j ON j.recording_id=r.id AND j.kind='transcribe' WHERE r.status='completed' AND r.expires_at>? AND r.transcript_status IN ('queued','processing') AND (j.id IS NULL OR j.status IN ('completed','failed')) LIMIT 20",now());
        for(const orphan of orphans){if(!orphan.job_id){await queueJob(orphan.id,'transcribe');await run("UPDATE talk_recordings SET transcript_status='queued' WHERE id=?",orphan.id);}else await run("UPDATE talk_recordings SET transcript_status='failed',transcript_error='worker_lost' WHERE id=?",orphan.id);}
        if(!controllers.size){
          const busy=await get("SELECT COUNT(*) AS count FROM talk_recording_jobs WHERE kind='transcribe' AND status='running' AND lease_expires_at>?",now());
          const capturing=await get("SELECT COUNT(*) AS count FROM talk_recordings WHERE status IN ('starting','recording','stopping')");
          job=await get("SELECT * FROM talk_recording_jobs WHERE status='queued' AND next_run_at<=?"+(Number(busy.count)||Number(capturing.count)?" AND kind='delete'":'')+" ORDER BY CASE WHEN kind='delete' THEN 0 ELSE 1 END,created_at LIMIT 1",now());
          if(job){await run("UPDATE talk_recording_jobs SET status='running',attempts=attempts+1,lease_owner=?,lease_expires_at=?,updated_at=? WHERE id=? AND status='queued'",workerId,now()+120000,now(),job.id);job.attempts++;}
        }
        await db.exec('COMMIT');
      }catch(failure){await db.exec('ROLLBACK');throw failure;}
      if(job)detached(()=>runJob(job));
    } finally { ticking=false; }
  }
  const timer=runtime.storage?setInterval(()=>{void db.withContext(tick).catch(()=>{});},2000):null;timer?.unref();
  async function shutdown(){closed=true;clearInterval(timer);for(const work of controllers.values())work.controller.abort();for(const entry of captures.values())if(entry.starting)entry.controller.abort();await Promise.allSettled([...captures.keys()].map(id=>db.withContext(()=>stopInternal(id))));await bounded(Promise.allSettled([...tasks]),stopTimeout+6000,()=>{for(const entry of captures.values())entry.controller.abort();}).catch(()=>{});}
  return { state, request, consent, start, stop, transcript, history, details, privateRecording, remove, retryTranscript, checkJoin, isRecorder, setAssistantGuard, tick:()=>db.withContext(tick), shutdown, onMeetingEnd:async id=>{const r=await active(id);if(!r)return;if(r.status==='awaiting_consent'){await run("UPDATE talk_recordings SET status='deleted',deleted_at=? WHERE id=?",now(),r.id);return;}await run("UPDATE talk_recordings SET status='stopping' WHERE id=?",r.id);detached(()=>stopInternal(r.id));}, runtime };
}

export function mountRecordingRoutes({ app, recordings, meetingSession, meetingWrite, safeAsync, rateLimited }) {
  const read = handler => safeAsync(async(req,res)=>{const session=await meetingSession(req,res);if(session&&!await rateLimited(req,res,'recording-read',session.account_id,{email:600,ip:4000,window:60000}))await handler(req,res,session);});
  app.get('/api/auth/meetings/:meetingId/recording-state',read(async(req,res,s)=>res.json({...await recordings.state(req.params.meetingId,s),csrfToken:s.csrf_token})));
  for(const[action,method]of [['request','request'],['consent','consent'],['start','start'],['stop','stop']]){const suffix=action==='request'?'/request':`/:recordingId/${action}`;app.post(`/api/auth/meetings/:meetingId/recordings${suffix}`,...meetingWrite(async(req,res,s)=>{const args=action==='request'?[req.params.meetingId,s,req.body]:action==='consent'?[req.params.meetingId,req.params.recordingId,s,req.body?.accept]:[req.params.meetingId,req.params.recordingId,s];res.status(202).json(await recordings[method](...args));}));}
  app.get('/api/auth/meeting-history',read(async(_req,res,s)=>res.json({...await recordings.history(s),csrfToken:s.csrf_token})));
  app.get('/api/auth/meeting-history/:meetingId',read(async(req,res,s)=>res.json({...await recordings.details(req.params.meetingId,s),csrfToken:s.csrf_token})));
  app.get('/api/auth/recordings/:recordingId/transcript',read(async(req,res,s)=>res.json(await recordings.transcript(req.params.recordingId,s))));
  for(const format of ['txt','pdf'])app.get(`/api/auth/recordings/:recordingId/transcript.${format}`,read(async(req,res,s)=>{if(format==='pdf'&&await rateLimited(req,res,'transcript-pdf',s.account_id,{email:6,ip:20,window:60000}))return;const r=await recordings.privateRecording(req.params.recordingId,s),transcript=await recordings.transcript(r.id,s);if(transcript.status!=='completed')throw new MeetingError(409,'transcript_not_ready','Wait until transcription finishes.');const details=await recordings.details(r.meeting_id,s);const value={title:details.meeting.title,...transcript};res.set('Content-Disposition',`attachment; filename="talk-transcript-${r.id}.${format}"`);res.type(format==='pdf'?'application/pdf':'text/plain; charset=utf-8').send(format==='pdf'?await exportTranscriptPdf(value):exportTranscriptText(value));}));
  for(const[action,method]of [['delete','remove'],['retry-transcript','retryTranscript']])app.post(`/api/auth/recordings/:recordingId/${action}`,...meetingWrite(async(req,res,s)=>res.status(202).json(await recordings[method](req.params.recordingId,s,action==='retry-transcript'?req.body:undefined))));
  app.get('/api/auth/recordings/:recordingId/playback',read(async(req,res,s)=>{const r=await recordings.privateRecording(req.params.recordingId,s);if(r.status!=='completed'||!r.storage_key)throw new MeetingError(409,'recording_not_ready','The recording is not ready for playback.');const size=await recordings.runtime.storage.size(r.storage_key);let start=0,end=size-1;const range=req.get('Range');if(range){const match=/^bytes=(\d*)-(\d*)$/.exec(range);if(!match||!match[1]&&!match[2])return res.status(416).set('Content-Range',`bytes */${size}`).end();if(!match[1])start=Math.max(0,size-Number(match[2]));else{start=Number(match[1]);if(match[2])end=Math.min(end,Number(match[2]));}if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>end||start>=size)return res.status(416).set('Content-Range',`bytes */${size}`).end();res.status(206).set('Content-Range',`bytes ${start}-${end}/${size}`);}res.set({'Accept-Ranges':'bytes','Content-Length':String(end-start+1),'Content-Type':r.mime_type,'Content-Disposition':`${req.query.download === '1' ? 'attachment' : 'inline'}; filename="talk-recording-${r.id}.webm"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});const result=await recordings.runtime.storage.open(r.storage_key,{start,end});res.once('close',()=>result.stream.destroy());result.stream.on('error',()=>res.destroy());result.stream.pipe(res);}));
}
