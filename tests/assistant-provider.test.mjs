import test from 'node:test';
import assert from 'node:assert/strict';
import { createOllamaProvider } from '../backend/src/assistant-provider.mjs';

test('local provider is disabled without any network, installation, model or environment dependency', async () => {
  let requests = 0;
  const provider = createOllamaProvider({ fetchImpl: async () => { requests++; assert.fail('must not send a request'); } });
  assert.equal(provider.configured, false);
  assert.equal(provider.prepared, false);
  assert.equal(provider.provider, 'ollama-local');
  assert.equal(provider.settings.cloudAllowed, false);
  assert.equal(provider.settings.autoPull, false);
  await assert.rejects(provider.generate({ sources: [{ private: 'transcript' }] }), { code: 'assistant_provider_disabled' });
  assert.equal(requests, 0);
  assert.ok(Object.isFrozen(provider)); assert.ok(Object.isFrozen(provider.settings));
});

test('even future approved/pinned configuration cannot activate generation in foundation phase', async () => {
  let requests = 0, checkpoints = 0;
  const provider = createOllamaProvider({ enabled: true, benchmarkApproved: true, model: 'qwen3:1.7b', modelDigest: `sha256:${'a'.repeat(64)}`,
    fetchImpl: async () => { requests++; assert.fail('must not fetch even after readiness validation'); } });
  assert.equal(provider.prepared, true); assert.equal(provider.configured, false);
  await assert.rejects(provider.generate({ sources: [], checkpoint: { stage: 'queued' }, onCheckpoint() { checkpoints++; } }), /separately approved/);
  assert.equal(requests, 0); assert.equal(checkpoints, 0);
});

test('only literal HTTP loopback endpoints are accepted; DNS, cloud, credentials and redirects are impossible', () => {
  for (const baseUrl of ['http://127.0.0.1:11434', 'http://127.0.0.1:11434/', 'http://[::1]:11434']) {
    assert.equal(createOllamaProvider({ baseUrl }).configured, false);
  }
  for (const baseUrl of [
    'https://127.0.0.1:11434', 'http://localhost:11434', 'http://example.com:11434', 'https://api.ollama.com',
    'http://127.0.0.2:11434', 'http://2130706433:11434', 'http://127.1:11434', 'http://0177.0.0.1:11434',
    'http://127.0.0.1.evil.example', 'http://user:private@127.0.0.1:11434', 'http://127.0.0.1:11434/api/generate',
    'http://127.0.0.1:11434?redirect=https://example.com', 'http://127.0.0.1:11434#fragment',
    'file:///private', 'http://[::ffff:127.0.0.1]:11434', '', null,
  ]) assert.throws(() => createOllamaProvider({ baseUrl }), { code: 'assistant_provider_configuration' });
});

test('readiness requires explicit benchmark approval and pinned local model without cloud tags', () => {
  for (const options of [
    { enabled: true }, { enabled: true, benchmarkApproved: true, model: 'qwen3:1.7b' },
    { enabled: true, benchmarkApproved: false, model: 'qwen3:1.7b', modelDigest: `sha256:${'a'.repeat(64)}` },
    { enabled: true, benchmarkApproved: true, model: 'qwen3:cloud', modelDigest: `sha256:${'a'.repeat(64)}` },
    { model: 'https://cloud.example/model' }, { model: 'qwen3\nprivate' }, { model: '../model' },
    { modelDigest: 'sha256:latest' }, { enabled: 'true' }, { benchmarkApproved: 1 },
  ]) assert.throws(() => createOllamaProvider(options), { code: 'assistant_provider_configuration' });
});

test('configuration and disabled errors never reflect private settings or transcript contents', async () => {
  const sensitive = 'private-token-that-must-not-appear';
  assert.throws(() => createOllamaProvider({ baseUrl: `http://${sensitive}@cloud.example` }), error => !error.message.includes(sensitive));
  try { await createOllamaProvider().generate({ sources: [{ text: sensitive }] }); assert.fail('expected disabled'); }
  catch (error) { assert.equal(error.code, 'assistant_provider_disabled'); assert.ok(!error.message.includes(sensitive)); }
});
