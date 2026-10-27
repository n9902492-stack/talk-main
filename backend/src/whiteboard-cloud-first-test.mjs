// Isolated first-test guard. Not mounted in Talk or the public tunnel runtime.
// Importing this module does not open a database or contact a provider.
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname, isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {CLOUD_EXTERNAL_RELEASE_APPROVED, cloudHash} from './whiteboard-cloud-provider.mjs';

export const FIRST_GEMINI_TEST = Object.freeze({
  id: 'phase10i-first-gemini-test',
  projectId: 'gen-lang-client-0562383032',
  model: 'gemini-2.5-flash',
  destination: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  bodySha256: '15808093f5c7f539d721ac559b851ae91d41854083a4dd617fb5040e4c6805b9',
  bodyBytes: 2661,
});
export const FIRST_GEMINI_LEDGER = fileURLToPath(new URL('../../data/whiteboard-cloud-first-test.sqlite', import.meta.url));
const fail = code => Object.assign(new Error('First Gemini test blocked or consumed. No retry or fallback is permitted.'), {code});
const safeCodes = new Set(['cloud_provider_error', 'cloud_rate_limited', 'cloud_timeout', 'cloud_cancelled', 'cloud_connection', 'cloud_invalid_json', 'cloud_incomplete', 'cloud_response_limit', 'cloud_release_blocked']);

export function createFirstGeminiTestGuard({ledgerPath = FIRST_GEMINI_LEDGER, executionGate = () => CLOUD_EXTERNAL_RELEASE_APPROVED} = {}) {
  if (!isAbsolute(ledgerPath) || ledgerPath.includes(':memory:')) throw fail('first_test_durable_path');
  mkdirSync(dirname(ledgerPath), {recursive: true});
  const db = new DatabaseSync(ledgerPath);
  try {
    db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS first_gemini_attempt (
        id TEXT PRIMARY KEY CHECK(id='phase10i-first-gemini-test'),
        project_id TEXT NOT NULL, model TEXT NOT NULL, destination TEXT NOT NULL,
        body_hash TEXT NOT NULL, config_fingerprint TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('reserved','completed','failed','unknown')),
        reserved_at INTEGER NOT NULL, finished_at INTEGER, failure_code TEXT
      ) STRICT;
      CREATE TRIGGER IF NOT EXISTS first_gemini_no_delete BEFORE DELETE ON first_gemini_attempt
        BEGIN SELECT RAISE(ABORT,'First attempt receipts cannot be deleted'); END;
      CREATE TRIGGER IF NOT EXISTS first_gemini_immutable BEFORE UPDATE ON first_gemini_attempt
        WHEN OLD.state!='reserved' OR NEW.state='reserved' OR NEW.id!=OLD.id
          OR NEW.project_id!=OLD.project_id OR NEW.model!=OLD.model OR NEW.destination!=OLD.destination
          OR NEW.body_hash!=OLD.body_hash OR NEW.config_fingerprint!=OLD.config_fingerprint
          OR NEW.reserved_at!=OLD.reserved_at
        BEGIN SELECT RAISE(ABORT,'First attempt binding is immutable'); END;`);
  } catch { db.close(); throw fail('first_test_ledger_unavailable'); }
  const read = () => db.prepare('SELECT state, reserved_at, finished_at, failure_code FROM first_gemini_attempt WHERE id=?').get(FIRST_GEMINI_TEST.id) || null;
  function reserve(fingerprint) {
    // FULL synchronous COMMIT completes before any provider call. Another process
    // is serialized here. A crash leaves a consumed reservation, never a retry.
    try {
      db.exec('BEGIN IMMEDIATE');
      if (read()) throw fail('first_test_consumed');
      db.prepare(`INSERT INTO first_gemini_attempt
        (id,project_id,model,destination,body_hash,config_fingerprint,state,reserved_at)
        VALUES(?,?,?,?,?,?,'reserved',?)`).run(FIRST_GEMINI_TEST.id, FIRST_GEMINI_TEST.projectId,
        FIRST_GEMINI_TEST.model, FIRST_GEMINI_TEST.destination, FIRST_GEMINI_TEST.bodySha256, fingerprint, Date.now());
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw fail(error?.code === 'first_test_consumed' ? 'first_test_consumed' : 'first_test_ledger_unavailable');
    }
  }
  function finish(state, code = null) {
    db.prepare("UPDATE first_gemini_attempt SET state=?,finished_at=?,failure_code=? WHERE id=? AND state='reserved'")
      .run(state, Date.now(), code, FIRST_GEMINI_TEST.id);
  }
  async function run({provider, prepared, approval, signal} = {}) {
    // No environment variable or JSON review document can lift this source lock.
    if (executionGate() !== true) throw fail('cloud_release_blocked');
    const spec = FIRST_GEMINI_TEST;
    if (approval?.sendApproved !== true || approval.maximumSpendINR !== 0 ||
        approval.projectId !== spec.projectId || approval.model !== spec.model ||
        approval.destination !== spec.destination || approval.bodySha256 !== spec.bodySha256 ||
        approval.keyProjectConfirmed !== true || approval.freeTierConfirmed !== true ||
        approval.noPaidFallbackConfirmed !== true || approval.freeQuotaConfirmed !== true ||
        approval.modelRestrictionAcknowledged !== true) throw fail('first_test_approval');
    if (!provider?.configured || provider.enabled !== true || provider.provider !== 'openai-compatible' ||
        provider.model !== spec.model || provider.endpoint + '/chat/completions' !== spec.destination ||
        !/^[a-f0-9]{64}$/.test(provider.fingerprint || '') || typeof provider.generate !== 'function' ||
        provider.limits?.input !== 8192 || provider.limits?.output !== 2048 ||
        provider.limits?.timeout !== 45000 || provider.limits?.concurrent !== 1) throw fail('first_test_configuration');
    if (typeof prepared?.body !== 'string' || Buffer.byteLength(prepared.body) !== spec.bodyBytes ||
        prepared.hash !== spec.bodySha256 || cloudHash(prepared.body) !== spec.bodySha256) throw fail('first_test_payload');
    signal?.throwIfAborted();
    const request = Object.freeze({...prepared});
    const generate = provider.generate.bind(provider);
    reserve(provider.fingerprint);
    const timeout = AbortSignal.timeout(45000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let beforeSendCalled = false, aborted;
    try {
      const result = await Promise.race([
        generate({prepared: request, signal: combined, beforeSend: async () => {
          combined.throwIfAborted();
          if (beforeSendCalled) throw fail('first_test_consumed');
          beforeSendCalled = true;
        }}),
        new Promise((_, reject) => {
          aborted = () => reject(fail(signal?.aborted ? 'cloud_cancelled' : 'cloud_timeout'));
          combined.addEventListener('abort', aborted, {once: true});
          if (combined.aborted) aborted();
        }),
      ]);
      if (!beforeSendCalled) throw fail('first_test_transport_contract');
      combined.throwIfAborted();
      finish('completed');
      return result;
    } catch (error) {
      const code = safeCodes.has(error?.code) ? error.code : 'first_test_failed';
      // Even a failure before transmission consumes the reservation. No result,
      // prompt, raw provider error, key or key portion is written to the ledger.
      try { finish(code === 'cloud_timeout' || code === 'cloud_connection' || code === 'cloud_cancelled' ? 'unknown' : 'failed', code); } catch {}
      throw fail(code);
    } finally {
      if (aborted) combined.removeEventListener('abort', aborted);
    }
  }
  return {run, status: read, close: () => db.close()};
}
