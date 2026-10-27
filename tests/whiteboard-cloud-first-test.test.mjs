import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {createFirstGeminiTestGuard, FIRST_GEMINI_TEST as spec} from '../backend/src/whiteboard-cloud-first-test.mjs';
import {cloudHash, createCloudWhiteboardProvider, CLOUD_EXTERNAL_RELEASE_APPROVED} from '../backend/src/whiteboard-cloud-provider.mjs';

const body = readFileSync(new URL('../deployment/phase10i-gemini-first-test.body.json', import.meta.url), 'utf8');
const prepared = {body, hash: cloudHash(body)};
const approval = {sendApproved: true, maximumSpendINR: 0, projectId: spec.projectId,
  model: spec.model, destination: spec.destination, bodySha256: spec.bodySha256,
  keyProjectConfirmed: true, freeTierConfirmed: true, noPaidFallbackConfirmed: true,
  freeQuotaConfirmed: true, modelRestrictionAcknowledged: true};
const options = {enabled: true, operatorApproved: true, provider: 'openai-compatible', model: spec.model,
  baseUrl: spec.destination.replace('/chat/completions', ''),
  allowlist: [spec.destination.replace('/chat/completions', '')], apiKey: 'FAKE_TEST_CREDENTIAL_NOT_A_REAL_KEY',
  maxInputTokens: 8192, maxOutputTokens: 2048, timeoutMs: 45000, maxConcurrent: 1};
const output = {choices: [{finish_reason: 'stop', message: {content: JSON.stringify({schemaVersion: 1, title: 'Fictional OrbitMeet', layout: 'swot', nodes: [{id: 'n1', type: 'sticky', text: 'Fictional opportunity', section: 2}], edges: []})}}]};
function fixture(t, {gate = true, transport} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'talk-gemini-guard-'));
  const ledgerPath = join(dir, 'receipt.sqlite');
  const guard = createFirstGeminiTestGuard({ledgerPath, executionGate: () => gate});
  let calls = 0;
  const provider = createCloudWhiteboardProvider(options, async req => {
    calls++; await req.beforeSend(); return transport ? transport(req) : output;
  });
  t.after(() => { guard.close(); rmSync(dir, {recursive: true, force: true}); });
  return {guard, ledgerPath, provider, calls: () => calls, run: patch => guard.run({provider, prepared, approval, ...patch})};
}

test('prepared payload is byte-exact and contains only fictional prompt, schema and empty notes', () => {
  assert.equal(Buffer.byteLength(body), spec.bodyBytes);
  assert.equal(prepared.hash, spec.bodySha256);
  const wire = JSON.parse(body);
  assert.deepEqual(Object.keys(wire).sort(), ['max_tokens', 'messages', 'model', 'response_format', 'stream']);
  assert.equal(wire.model, spec.model);
  assert.equal(wire.max_tokens, 2048);
  assert.equal(wire.messages.length, 2);
  assert.deepEqual(JSON.parse(wire.messages[1].content), {notes: [], request: 'Generate a SWOT analysis for a fictional video meeting application called OrbitMeet. Include strengths, weaknesses, opportunities and threats. Return structured data suitable for editable Konva shapes and sticky notes.'});
});

test('default release lock denies execution without consuming an attempt', async t => {
  assert.equal(globalThis.__cloudEgressGuard, true);
  assert.equal(CLOUD_EXTERNAL_RELEASE_APPROVED, false);
  const f = fixture(t, {gate: false});
  await assert.rejects(f.run(), {code: 'cloud_release_blocked'});
  assert.equal(f.calls(), 0); assert.equal(f.guard.status(), null);
});

test('explicit send approval and every zero-spend/project evidence acknowledgement are mandatory', async t => {
  const f = fixture(t);
  for (const field of Object.keys(approval)) {
    const changed = {...approval}; delete changed[field];
    await assert.rejects(f.run({approval: changed}), {code: 'first_test_approval'});
  }
  await assert.rejects(f.run({approval: {...approval, maximumSpendINR: 1}}), {code: 'first_test_approval'});
  assert.equal(f.calls(), 0); assert.equal(f.guard.status(), null);
});

test('changed body, model, destination, credentials binding, or limits cannot bypass approval', async t => {
  const f = fixture(t);
  for (const value of [body + '\n', body.replace('OrbitMeet', 'RealCompany')]) {
    await assert.rejects(f.run({prepared: {body: value, hash: cloudHash(value)}}), {code: 'first_test_payload'});
  }
  for (const patch of [{model: 'another-model'}, {endpoint: 'https://other.example/v1'}, {fingerprint: ''},
    {enabled: false}, {limits: {...f.provider.limits, output: 4096}}]) {
    await assert.rejects(f.run({provider: {...f.provider, ...patch}}), {code: 'first_test_configuration'});
  }
  assert.equal(f.calls(), 0); assert.equal(f.guard.status(), null);
});

test('successful attempt persists across reopen and cannot run again', async t => {
  const f = fixture(t);
  const result = await f.run(); assert.equal(result.output.title, 'Fictional OrbitMeet');
  assert.equal(f.guard.status().state, 'completed');
  const reopened = createFirstGeminiTestGuard({ledgerPath: f.ledgerPath, executionGate: () => true});
  try { await assert.rejects(reopened.run({provider: f.provider, prepared, approval}), {code: 'first_test_consumed'}); }
  finally { reopened.close(); }
  await assert.rejects(f.run({provider: {...f.provider, fingerprint: cloudHash('rotated-fake-key')}}), {code: 'first_test_consumed'});
  assert.equal(f.calls(), 1);
});

for (const code of ['cloud_provider_error', 'cloud_rate_limited', 'cloud_timeout', 'cloud_invalid_json', 'cloud_incomplete', 'cloud_connection']) {
  test(`${code} permanently consumes attempt without retry or fallback`, async t => {
    const f = fixture(t, {transport: () => {throw Object.assign(new Error('Do not log provider detail'), {code});}});
    await assert.rejects(f.run(), {code});
    await assert.rejects(f.run(), {code: 'first_test_consumed'});
    assert.equal(f.calls(), 1);
    assert.ok(['failed', 'unknown'].includes(f.guard.status().state));
  });
}

test('malformed response JSON is rejected by actual adapter and consumes attempt', async t => {
  const f = fixture(t, {transport: () => ({choices: [{finish_reason: 'stop', message: {content: 'not-json'}}]})});
  await assert.rejects(f.run(), {code: 'cloud_invalid_json'});
  await assert.rejects(f.run(), {code: 'first_test_consumed'}); assert.equal(f.calls(), 1);
});

test('errors are sanitized and receipt has no raw credential, prompt or response', async t => {
  const secret = options.apiKey;
  const f = fixture(t, {transport: () => {throw new Error(secret);}});
  await assert.rejects(f.run(), error => error.code === 'cloud_provider_error' && !error.message.includes(secret));
  const bytes = readFileSync(f.ledgerPath);
  for (const text of [secret, 'Generate a SWOT analysis', 'Fictional OrbitMeet']) assert.equal(bytes.includes(Buffer.from(text)), false);
});

test('cancelled signal before reservation leaves attempt unused; in-flight cancellation consumes it', async t => {
  const f = fixture(t); const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(f.run({signal: cancelled.signal})); assert.equal(f.guard.status(), null);
  const active = new AbortController();
  const provider = {...f.provider, generate: async ({beforeSend}) => {await beforeSend(); active.abort(); return output;}};
  await assert.rejects(f.run({provider, signal: active.signal}));
  assert.equal(f.guard.status().state, 'unknown');
  await assert.rejects(f.run(), {code: 'first_test_consumed'});
});

test('receipt cannot be deleted or reset through SQL; memory-only storage is rejected', async t => {
  const f = fixture(t); await f.run();
  const db = new DatabaseSync(f.ledgerPath);
  try {
    assert.throws(() => db.exec('DELETE FROM first_gemini_attempt'));
    assert.throws(() => db.exec("UPDATE first_gemini_attempt SET state='reserved'"));
  } finally {db.close();}
  assert.throws(() => createFirstGeminiTestGuard({ledgerPath: ':memory:'}));
});

const moduleUrl = new URL('../backend/src/whiteboard-cloud-first-test.mjs', import.meta.url).href;
const guardPath = new URL('./helpers/cloud-egress-guard.mjs', import.meta.url).href;
function child(ledgerPath, crash = false) {
  const script = `import {createFirstGeminiTestGuard} from ${JSON.stringify(moduleUrl)};
    const guard=createFirstGeminiTestGuard({ledgerPath:process.env.FIRST_TEST_LEDGER,executionGate:()=>true});
    const provider={configured:true,enabled:true,provider:'openai-compatible',model:${JSON.stringify(spec.model)},
      endpoint:${JSON.stringify(options.baseUrl)},fingerprint:'a'.repeat(64),limits:{input:8192,output:2048,timeout:45000,concurrent:1},
      generate:async({beforeSend})=>{await beforeSend();${crash ? "process.exit(0);" : "await new Promise(r=>setTimeout(r,40));return {};"}}};
    try{await guard.run({provider,prepared:${JSON.stringify(prepared)},approval:${JSON.stringify(approval)}});console.log('one-mock-attempt');}
    catch(e){console.log(e.code==='first_test_consumed'?'consumed':'unexpected');process.exitCode=e.code==='first_test_consumed'?0:1;}
    finally{guard.close();}`;
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ['--import', guardPath, '--input-type=module', '-e', script], {
      env: {...process.env, FIRST_TEST_LEDGER: ledgerPath}, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '', diagnostic = ''; proc.stdout.on('data', b => {out += b;}); proc.stderr.on('data', b => {diagnostic += b;}); proc.on('error', reject);
    proc.on('close', code => code === 0 ? resolve(out.trim()) : reject(new Error('Offline synthetic child failed: ' + diagnostic.slice(-1800))));
  });
}

test('two independent processes racing on one ledger produce only one mock attempt', async t => {
  const f = fixture(t);
  const results = await Promise.all([child(f.ledgerPath), child(f.ledgerPath)]);
  assert.deepEqual(results.sort(), ['consumed', 'one-mock-attempt']);
});

test('process crash after reservation is permanently consumed on restart', async t => {
  const f = fixture(t); await child(f.ledgerPath, true);
  assert.equal(f.guard.status().state, 'reserved');
  await assert.rejects(f.run(), {code: 'first_test_consumed'}); assert.equal(f.calls(), 0);
});

test('unusable ledger fails closed without invoking a provider', t => {
  const dir = mkdtempSync(join(tmpdir(), 'talk-gemini-corrupt-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  const path = join(dir, 'receipt.sqlite'); writeFileSync(path, 'not a sqlite database');
  assert.throws(() => createFirstGeminiTestGuard({ledgerPath: path}), {code: 'first_test_ledger_unavailable'});
});
