import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { recordingClientBundle } from '../backend/src/recording-client-bundle.mjs';

test('prepared recorder bundle works when runtime compilation is denied; corrupt cache fails closed', async () => {
  const cacheDirectory = await mkdtemp(path.resolve('artifacts/qa/recorder-bundle-'));
  let calls = 0;
  const code = 'window.syntheticRecorderFixture = true;';
  const compile = async () => { calls++; return { outputFiles: [{ text: code }] }; };
  assert.equal(await recordingClientBundle({ prepare: true, cacheDirectory, compile }), code);
  const denied = async () => { throw new Error('Access denied: private filesystem details'); };
  assert.equal(await recordingClientBundle({ cacheDirectory, compile: denied }), code);
  assert.equal(calls, 1);
  const filename = (await readdir(cacheDirectory)).find(name => name.endsWith('.js'));
  await writeFile(path.join(cacheDirectory, filename), 'corrupted code');
  await assert.rejects(recordingClientBundle({ cacheDirectory, compile: denied }), failure =>
    failure.code === 'recording_bundle_failed' && !failure.message.includes('private filesystem'));
});

test('missing bundle and denied compiler return actionable sanitized failure', async () => {
  const cacheDirectory = await mkdtemp(path.resolve('artifacts/qa/recorder-bundle-'));
  await assert.rejects(recordingClientBundle({ cacheDirectory, compile: async () => { throw new Error('private compiler argument'); } }), failure =>
    failure.code === 'recording_bundle_failed' && failure.message.includes('recording:prepare') && !failure.message.includes('private compiler'));
});
