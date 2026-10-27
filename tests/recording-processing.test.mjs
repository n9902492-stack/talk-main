import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeJwt } from 'jose';
import { parseWhisperResult } from '../backend/src/recording-transcriber.mjs';
import { createRecordingRuntime } from '../backend/src/recording-runtime.mjs';
import { createMeetingService } from '../backend/src/meetings.mjs';
import { EventEmitter } from 'node:events';
import { mkdtemp, copyFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { closeRecordingBrowser, createBrowserRecorder } from '../backend/src/recording-recorder.mjs';
import { flushRecorderOutput } from '../backend/src/recorder-client.mjs';

test('Whisper output retains Hindi/English timestamps without inventing speaker names',()=>{
  const result=parseWhisperResult({result:{language:'hi'},transcription:[{offsets:{from:100,to:1500},text:' नमस्ते, आज की बैठक। '},{offsets:{from:1500,to:2200},text:'[BLANK_AUDIO]'}]});
  assert.deepEqual(result,{language:'hi',segments:[{start:0.1,end:1.5,text:'नमस्ते, आज की बैठक।',speaker:null}]});
  for(const offsets of [{from:-1,to:5},{from:500,to:100},{from:0,to:7203000},{from:'invalid',to:1}])assert.throws(()=>parseWhisperResult({transcription:[{offsets,text:'text'}]}));
  assert.throws(()=>parseWhisperResult({transcription:[{offsets:{from:0,to:1000},text:'a'.repeat(10001)}]}));
});

test('recording token is room-restricted, read-only and cannot publish data or impersonate a user',async()=>{
  const service=createMeetingService({NODE_ENV:'development',LIVEKIT_URL:'ws://localhost:7880',LIVEKIT_API_KEY:'test-key',LIVEKIT_API_SECRET:'test-secret-at-least-32-characters'});
  const identity='rec_550e8400-e29b-41d4-a716-446655440000',room='talk-550e8400-e29b-41d4-a716-446655440000';
  const token=decodeJwt((await service.issueRecordingToken(identity,room)).token);
  assert.equal(token.sub,identity);assert.equal(token.video.room,room);assert.equal(token.video.canSubscribe,true);assert.equal(token.video.canPublish,false);assert.equal(token.video.canPublishData,false);assert.ok(!token.video.roomAdmin);assert.ok(!token.video.roomCreate);assert.ok(!token.video.roomRecord);
  await assert.rejects(service.issueRecordingToken('talk_fake',room));await assert.rejects(service.issueRecordingToken(identity,'other-room'));
});

test('production capture fails closed without explicit worker and durable storage',()=>{
  const service={configured:true};
  assert.equal(createRecordingRuntime({env:{NODE_ENV:'production'},service}).configured,false);
  assert.equal(createRecordingRuntime({env:{NODE_ENV:'production',RECORDING_PROVIDER:'disabled'},service}).configured,false);
});

test('encoder flush releases generated output tracks before stop and includes final data', async () => {
  const events = [], recorder = new EventTarget();
  recorder.state = 'recording'; recorder.requestData = () => events.push('request-data');
  const track = { readyState: 'live', stop() { events.push('track-ended'); this.readyState = 'ended'; } };
  recorder.stop = () => { assert.equal(track.readyState, 'ended'); events.push('encoder-stop'); recorder.state = 'inactive'; queueMicrotask(() => { events.push('last-chunk'); recorder.dispatchEvent(new Event('dataavailable')); recorder.dispatchEvent(new Event('stop')); }); };
  await flushRecorderOutput(recorder, { getTracks: () => [track] });
  assert.deepEqual(events, ['request-data', 'track-ended', 'encoder-stop', 'last-chunk']);
});

test('encoder failure and missing stop event are bounded and always release inputs', async () => {
  for (const scenario of ['error', 'timeout', 'already-stopped']) {
    const recorder = new EventTarget(); recorder.state = scenario === 'already-stopped' ? 'inactive' : 'recording'; recorder.requestData = () => {};
    const track = { readyState: 'live', stop() { this.readyState = 'ended'; } };
    recorder.stop = () => { recorder.state = 'inactive'; if (scenario === 'error') queueMicrotask(() => recorder.dispatchEvent(new Event('error'))); };
    const result = flushRecorderOutput(recorder, { getTracks: () => [track] }, { timeoutMs: 10 });
    if (scenario === 'already-stopped') await result;
    else await assert.rejects(result, scenario === 'error' ? /encoder failed/ : /did not finish/);
    assert.equal(track.readyState, 'ended');
  }
});

test('worker teardown forces only its owned Chromium tree after graceful close stalls', async () => {
  const calls = [];
  await closeRecordingBrowser({ close() { calls.push('close'); return new Promise(() => {}); }, async kill() { calls.push('kill'); } }, { closeMs: 10, killMs: 10 });
  assert.deepEqual(calls, ['close', 'kill']);
  calls.length = 0;
  await closeRecordingBrowser({ async close() { calls.push('close'); }, async kill() { calls.push('kill'); } });
  assert.deepEqual(calls, ['close']);
  // Even an abnormal OS/process acknowledgement cannot hold the backend open.
  await closeRecordingBrowser({ kill: () => new Promise(() => {}) }, { force: true, killMs: 10 });
});

async function workerFixture(t, { stop, runCommand, launchServer, closeHangs = false, timeouts = {} } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'talk-recorder-lifecycle-'));
  t.after(async () => { if (path.resolve(directory).startsWith(path.join(path.resolve(os.tmpdir()), 'talk-recorder-lifecycle-'))) await rm(directory, { recursive: true, force: true }); });
  const calls = [], exposed = {};
  const page = new EventEmitter();
  Object.assign(page, { async goto() {}, async setContent() {}, async addScriptTag() {}, async exposeFunction(name, callback) { exposed[name] = callback; }, async evaluate(fn, values) {
    if (String(fn).includes('startTalkRecorder')) return { mimeType: 'audio/webm' };
    if (String(fn).includes('stopTalkRecorder')) { calls.push('encoder-flush'); if (stop) return stop({ exposed, calls }); await exposed.writeTalkRecording(Buffer.from('final-test-chunk').toString('base64')); return { durationMs: 1234, mimeType: 'audio/webm' }; }
    calls.push(['allowed', values]);
  } });
  const browser = new EventEmitter(); let connected = true;
  Object.assign(browser, { isConnected: () => connected, async newContext() { return { async addInitScript() {}, async route() {}, async newPage() { return page; } }; } });
  const server = { wsEndpoint: () => 'ws://127.0.0.1/owned-test-worker', close() { calls.push('browser-close'); if (closeHangs) return new Promise(() => {}); connected = false; browser.emit('disconnected'); return Promise.resolve(); }, async kill() { calls.push('browser-kill'); connected = false; browser.emit('disconnected'); } };
  const recorder = createBrowserRecorder({ service: { configured: true, async issueRecordingToken() { return { serverUrl: 'ws://127.0.0.1:7880', token: 'private-worker-token' }; } }, browserType: { launchServer: launchServer || (async () => server), async connect() { return browser; } }, buildClient: async () => '// fake browser boundary for lifecycle tests only', runCommand: runCommand || (async (_executable, args, options) => { assert.equal(options.killSignal, 'SIGKILL'); assert.ok(options.signal); calls.push('remux'); await copyFile(args[args.indexOf('-i') + 1], args.at(-1)); }), timeouts: { close: 10, kill: 1000, flush: 25000, io: 15000, operation: 45000, launch: 30000, ...timeouts } });
  return { recorder, calls, browser, server, outputPath: path.join(directory, 'private.webm'), options: { id: 'worker-test', roomName: 'talk-test', identity: 'rec_test', mode: 'audio', outputPath: path.join(directory, 'private.webm') } };
}

test('normal worker stop is idempotent, flushes final bytes, remuxes, then bounds browser teardown', async t => {
  const fixture = await workerFixture(t, { closeHangs: true });
  const handle = await fixture.recorder.start(fixture.options);
  const first = handle.stop(), second = handle.stop(); assert.equal(first, second);
  const result = await first;
  assert.equal(result.durationMs, 1234); assert.equal(result.bytes, 16); assert.equal(await readFile(result.path, 'utf8'), 'final-test-chunk');
  assert.deepEqual(fixture.calls, ['encoder-flush', 'remux', 'browser-close', 'browser-kill']);
  assert.equal(handle.isRunning(), false);
});

test('hung encoder stop fails clearly and still terminates its browser worker', async t => {
  const fixture = await workerFixture(t, { stop: () => new Promise(() => {}), closeHangs: true, timeouts: { flush: 30 } });
  const handle = await fixture.recorder.start(fixture.options);
  await assert.rejects(handle.stop(), /timed out/);
  assert.deepEqual(fixture.calls, ['encoder-flush', 'browser-close', 'browser-kill']);
});

test('startup cancellation disposes a late launched browser without starting capture', async t => {
  let releaseLaunch, launching;
  const launchStarted = new Promise(resolve => { launching = resolve; });
  const fixture = await workerFixture(t, { launchServer: () => { launching(); return new Promise(resolve => { releaseLaunch = resolve; }); } });
  const controller = new AbortController(), startup = fixture.recorder.start({ ...fixture.options, signal: controller.signal });
  await launchStarted; controller.abort(); await assert.rejects(startup, /cancelled/);
  releaseLaunch(fixture.server); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(fixture.calls, ['browser-kill']);
});

test('abort interrupts an in-flight remux and prevents a later successful stop', async t => {
  let began;
  const remuxStarted = new Promise(resolve => { began = resolve; });
  const fixture = await workerFixture(t, { runCommand: async (_executable, _args, { signal }) => { began(); await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('remux cancelled')), { once: true })); } });
  const handle = await fixture.recorder.start(fixture.options), stopping = handle.stop();
  const rejected = assert.rejects(stopping, /cancelled/);
  await remuxStarted; await handle.abort(); await rejected;
  assert.ok(fixture.calls.includes('browser-kill')); assert.equal(handle.isRunning(), false);
});

test('abnormal browser disconnect reports failure once without exposing credentials', async t => {
  const fixture = await workerFixture(t), failures = [], progress = [];
  const handle = await fixture.recorder.start({ ...fixture.options, onFailure: code => failures.push(code), onProgress: stage => progress.push(stage) });
  fixture.browser.emit('disconnected'); fixture.browser.emit('disconnected');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(failures, ['recording_worker_failed']); assert.equal(handle.isRunning(), false);
  assert.ok(progress.every(stage => !stage.includes('private-worker-token')));
  await handle.abort();
});
