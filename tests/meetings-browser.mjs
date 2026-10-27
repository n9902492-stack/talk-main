import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { chromium, expect } from '@playwright/test';
import { createAuthApp } from '../backend/src/auth.mjs';
import { createMeetingService } from '../backend/src/meetings.mjs';
import { localChrome } from '../scripts/browser-options.mjs';

// Real LiveKit server, WebRTC transport and browser capture/decoding. Only the
// account verifier and media hardware are fixtures. No paid service or messages.
const configuration = JSON.parse(await fs.readFile('data/livekit-local.json', 'utf8'));
const meetings = createMeetingService({ NODE_ENV: 'development', LIVEKIT_URL: configuration.url, LIVEKIT_API_KEY: configuration.apiKey, LIVEKIT_API_SECRET: configuration.apiSecret });
const app = express();
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const auth = createAuthApp({ clientId: 'meeting-browser.apps.googleusercontent.com', origins: [origin], verifyCredential: async credential => JSON.parse(credential), meetings });
auth.locals.attachMeetingGateway(server);
app.use(auth);
app.use(express.static(path.resolve('frontend/dist')));
app.get('*', (_req, res) => res.sendFile(path.resolve('frontend/dist/index.html')));
const browsers = [];
let step = 'launch';
const errors = [];
await fs.mkdir('artifacts/qa', { recursive: true });
await fs.writeFile('artifacts/qa/live-meeting-test-results.json', JSON.stringify({ passed: false, status: 'running' }));

async function toneFile(name, frequency) {
  const samples = 48000 * 8;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(96000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(7000 * Math.sin(2 * Math.PI * frequency * i / 48000)), 44 + i * 2);
  const filename = path.resolve(`artifacts/qa/${name}.wav`); await fs.writeFile(filename, wav); return filename;
}
async function member(name, frequency) {
  const audio = await toneFile(name, frequency);
  const browser = await chromium.launch({ ...localChrome(), headless: true, args: ['--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${audio}`, '--autoplay-policy=no-user-gesture-required'] });
  browsers.push(browser);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['camera', 'microphone'], reducedMotion: 'reduce' });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.origin === origin || url.origin === 'http://127.0.0.1:7880' ? route.continue() : route.abort();
  });
  await context.addInitScript(() => {
    window.__talkTestPeers = []; window.__talkTestCaptures = []; window.__talkTestSockets = [];
    const Peer = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends Peer { constructor(...args) { super(...args); window.__talkTestPeers.push(this); } };
    const Socket = window.WebSocket;
    window.WebSocket = class extends Socket { constructor(...args) { super(...args); window.__talkTestSockets.push(this); } };
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (...args) => { const stream = await capture(...args); window.__talkTestCaptures.push(stream); return stream; };
  });
  const page = await context.newPage();
  page.on('pageerror', () => errors.push('pageerror'));
  async function authenticate() {
    const config = await (await context.request.get(origin + '/api/auth/config')).json();
    const seconds = Math.floor(Date.now() / 1000);
    const signed = await context.request.post(origin + '/api/auth/google', { headers: { Origin: origin, 'X-CSRF-Token': config.csrfToken }, data: { credential: JSON.stringify({ iss: 'https://accounts.google.com', aud: config.clientId, sub: `real-webrtc-test-${name}`, name, email: `${name}@example.test`, email_verified: true, nonce: config.nonce, iat: seconds, exp: seconds + 3600 }) } });
    assert.equal(signed.status(), 200); const session = await signed.json();
    assert.equal((await context.request.post(origin + '/api/auth/google/confirm', { headers: { Origin: origin, 'X-CSRF-Token': session.csrfToken }, data: {} })).status(), 200);
    const created = await context.request.post(origin + '/api/auth/meetings/talk-workshop/create', { headers: { Origin: origin, 'X-CSRF-Token': session.csrfToken }, data: { approvalRequired: false } });
    assert.ok([201, 409].includes(created.status()));
  }
  return { page, context, authenticate };
}
async function stats(page) {
  return page.evaluate(async () => {
    const result = { videoFrames: 0, videoPackets: 0, audioPackets: 0, audioBytes: 0 };
    for (const pc of window.__talkTestPeers) {
      if (pc.connectionState === 'closed') continue;
      for (const report of (await pc.getStats()).values()) {
        if (report.type !== 'inbound-rtp') continue;
        if (report.kind === 'video') { result.videoFrames += report.framesDecoded || 0; result.videoPackets += report.packetsReceived || 0; }
        if (report.kind === 'audio') { result.audioPackets += report.packetsReceived || 0; result.audioBytes += report.bytesReceived || 0; }
      }
    }
    return result;
  });
}
async function audioLevel(page) {
  return page.evaluate(async () => {
    const element = document.querySelector('audio[data-audio-source="microphone"]');
    if (!element?.srcObject?.getAudioTracks().length) return 0;
    const context = new AudioContext(); await context.resume();
    try {
      const source = context.createMediaStreamSource(element.srcObject);
      const analyser = context.createAnalyser(); source.connect(analyser); analyser.fftSize = 2048;
      const data = new Float32Array(analyser.fftSize); let maximum = 0;
      for (let index = 0; index < 12; index++) {
        await new Promise(resolve => setTimeout(resolve, 30)); analyser.getFloatTimeDomainData(data);
        maximum = Math.max(maximum, Math.sqrt(data.reduce((total, value) => total + value * value, 0) / data.length));
      }
      return maximum;
    } finally { await context.close(); }
  });
}
const connected = async page => { await expect(page.locator('.live-meeting')).toHaveAttribute('data-connection-state', 'connected', { timeout: 30000 }); };
const count = (page, value) => expect(page.getByLabel('Participant count', { exact: true })).toHaveText(String(value), { timeout: 20000 });
const remote = page => page.locator('.live-participant-tile[data-local="false"]');

try {
  const alice = await member('Alice', 440), bob = await member('Bob', 660);
  const a = alice.page, b = bob.page;
  step = 'pre-join name validation and guest access';
  await a.goto(origin + '/device-test');
  await a.getByRole('link', { name: 'Join session', exact: true }).click();
  assert.equal(new URL(a.url()).pathname, '/device-test');
  assert.equal(await a.getByLabel('Your display name').evaluate(el => el.validity.valid), false);
  await a.getByLabel('Your display name').fill('Alice');
  await a.getByRole('link', { name: 'Join session', exact: true }).click();
  await a.getByRole('alert').filter({ hasText: 'Sign in to Talk' }).waitFor();
  await alice.authenticate(); await bob.authenticate();
  await a.reload({ waitUntil: 'domcontentloaded' });
  await a.getByLabel('Your display name').fill('Alice');
  step = 'existing pre-join camera/microphone/device selections';
  await a.getByRole('button', { name: 'Enable camera & microphone', exact: true }).click();
  await expect(a.getByRole('button', { name: 'Turn camera off', exact: true })).toBeVisible({timeout:15000});
  await expect(a.getByRole('button', { name: 'Mute microphone', exact: true })).toBeVisible({timeout:15000});
  for (const selector of ['#camera-select', '#mic-select']) {
    step = `pre-join selection ${selector}`;
    const options = await a.locator(selector).locator('option').all();
    if (options.length > 1) {
      await a.locator(selector).selectOption({ index: 1 });
      await expect(a.getByRole('button', { name: 'Enable camera & microphone', exact: true })).toBeEnabled();
      await expect(a.locator(selector)).toBeEnabled();
    }
  }
  step = 'pre-join selected stream and microphone meter';
  const selection = await a.locator('.camera-preview video').evaluate(el => ({ camera: el.srcObject.getVideoTracks()[0].getSettings().deviceId, mic: el.srcObject.getAudioTracks()[0].getSettings().deviceId }));
  await expect.poll(() => a.getByRole('meter', { name: 'Microphone input level' }).getAttribute('aria-valuenow')).not.toBe('0');
  step = 'existing speaker sound and full five-second recording';
  await a.getByRole('button', { name: 'Play test sound', exact: true }).click();
  await a.getByRole('button', { name: 'I can hear the sound', exact: true }).click();
  await a.getByText('Checked', { exact: true }).waitFor();
  await a.getByRole('button', { name: 'Record a 5-second mic test', exact: true }).click();
  await a.getByRole('button', { name: 'Stop recording', exact: true }).waitFor();
  await expect(a.locator('#camera-select')).toBeDisabled();
  await a.getByRole('button', { name: 'Record a 5-second mic test', exact: true }).waitFor({ timeout: 8000 });
  await a.getByLabel('Play your microphone test').waitFor();
  await a.evaluate(() => window.scrollTo(0, 0));
  await a.screenshot({ path: 'artifacts/qa/meeting-prejoin-preserved.png', fullPage: true });
  const captureCount = await a.evaluate(() => window.__talkTestCaptures.length);
  step = 'first participant real LiveKit connection and media handoff';
  await a.getByRole('link', { name: 'Join session', exact: true }).click();
  await connected(a); await count(a, 1);
  await expect(a.locator('.live-participant-tile[data-local="true"] video')).toBeVisible();
  assert.equal(await a.evaluate(() => window.__talkTestCaptures.length), captureCount);
  const inMeetingSelection = await a.locator('.live-participant-tile[data-local="true"] video').evaluate(el => ({ camera: el.srcObject.getVideoTracks()[0].getSettings().deviceId }));
  assert.equal(inMeetingSelection.camera, selection.camera);
  assert.equal(await a.evaluate(mic => window.__talkTestPeers.some(pc => pc.getSenders().some(sender => sender.track?.kind === 'audio' && sender.track.getSettings().deviceId === mic)), selection.mic), true);
  step = 'second participant joins with both devices off';
  await b.goto(origin + '/device-test'); await b.getByLabel('Your display name').fill('Bob');
  await b.getByRole('button', { name: 'Enable camera & microphone', exact: true }).click();
  await expect(b.getByRole('button', { name: 'Mute microphone', exact: true })).toBeVisible({timeout:15000});
  await b.getByRole('button', { name: 'Mute microphone', exact: true }).click();
  await b.getByRole('button', { name: 'Turn camera off', exact: true }).click();
  await b.getByRole('link', { name: 'Join session', exact: true }).click();
  await connected(b); await count(b, 2); await count(a, 2);
  await expect(b.getByRole('button', { name: 'Enable camera', exact: true })).toBeVisible();
  await expect(b.getByRole('button', { name: 'Enable microphone', exact: true })).toBeVisible();
  await expect(remote(a).getByText('Camera off', { exact: true })).toBeVisible();
  await expect.poll(async () => (await stats(b)).videoFrames, { timeout: 20000 }).toBeGreaterThan(5);
  step = 'bidirectional real camera/microphone RTP and decoded audio';
  await b.getByRole('button', { name: 'Enable camera', exact: true }).click();
  await b.getByRole('button', { name: 'Enable microphone', exact: true }).click();
  for (const page of [a, b]) {
    await expect.poll(async () => (await stats(page)).videoFrames, { timeout: 20000 }).toBeGreaterThan(5);
    await expect.poll(async () => (await stats(page)).audioPackets, { timeout: 20000 }).toBeGreaterThan(10);
    await expect.poll(() => audioLevel(page), { timeout: 15000 }).toBeGreaterThan(0.001);
    await expect(remote(page).locator('video')).toBeVisible();
    await expect.poll(() => remote(page).locator('video').evaluate(el => el.videoWidth)).toBeGreaterThan(0);
  }
  const evidence = { alice: await stats(a), bob: await stats(b), aliceAudioRms: await audioLevel(a), bobAudioRms: await audioLevel(b) };
  step = 'real signaling interruption and automatic LiveKit reconnection';
  const previousFrames = (await stats(b)).videoFrames;
  await a.evaluate(() => {
    const meeting = document.querySelector('.live-meeting'); window.__talkTestStates = [];
    new MutationObserver(() => window.__talkTestStates.push(meeting.dataset.connectionState)).observe(meeting, { attributes: true, attributeFilter: ['data-connection-state'] });
    window.__talkTestSockets.filter(socket => socket.readyState === WebSocket.OPEN).forEach(socket => socket.close(4000, 'Local reconnection test'));
  });
  step = 'reconnection status becomes visible';
  await expect.poll(() => a.evaluate(() => window.__talkTestStates.includes('reconnecting')), { timeout: 20000 }).toBe(true);
  step = 'reconnected room retains both participants';
  await connected(a); await count(a, 2); await count(b, 2);
  step = 'reconnected transport resumes decoded video and audio';
  await expect.poll(async () => (await stats(b)).videoFrames, { timeout: 20000 }).toBeGreaterThan(previousFrames);
  await expect.poll(() => audioLevel(b), { timeout: 15000 }).toBeGreaterThan(0.001);
  step = 'mute/unmute and camera off/on propagate to remote participant';
  await a.getByRole('button', { name: 'Mute microphone', exact: true }).click();
  await expect(remote(b).getByLabel('Microphone off', { exact: true })).toBeVisible();
  await expect.poll(() => audioLevel(b), { timeout: 10000 }).toBeLessThan(0.001);
  await a.getByRole('button', { name: 'Turn camera off', exact: true }).click();
  await expect(remote(b).getByText('Camera off', { exact: true })).toBeVisible();
  await a.getByRole('button', { name: 'Enable microphone', exact: true }).click();
  await a.getByRole('button', { name: 'Enable camera', exact: true }).click();
  await expect.poll(() => audioLevel(b), { timeout: 15000 }).toBeGreaterThan(0.001);
  await expect(remote(b).locator('video')).toBeVisible();
  await a.screenshot({ path: 'artifacts/qa/meeting-live-two-browsers.png', fullPage: true });
  await expect(a.getByLabel('Meeting duration')).not.toHaveText('00:00');
  step = 'leave stops captures and removes remote participant';
  await a.getByRole('button', { name: 'Leave Meeting', exact: true }).click();
  await a.waitForURL('**/device-test?room=talk-workshop'); await count(b, 1);
  assert.equal(await a.evaluate(() => window.__talkTestCaptures.every(stream => stream.getTracks().every(track => track.readyState === 'ended'))), true);
  step = 'leave/rejoin uses fresh secure access and off-state preferences';
  await a.getByRole('link', { name: 'Join session', exact: true }).click();
  await connected(a); await count(a, 2); await count(b, 2);
  await expect(a.getByRole('button', { name: 'Enable camera', exact: true })).toBeVisible();
  step = 'browser camera permission denial stays connected with camera off';
  await alice.context.clearPermissions();
  await alice.context.grantPermissions(['microphone'], { origin });
  await a.getByRole('button', { name: 'Enable camera', exact: true }).click();
  await expect(a.getByRole('alert')).toContainText('permission was blocked');
  await connected(a);
  await expect(a.getByRole('button', { name: 'Enable camera', exact: true })).toBeVisible();
  await alice.context.grantPermissions(['camera', 'microphone'], { origin });
  await a.setViewportSize({ width: 390, height: 844 });
  assert.equal(await a.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await a.screenshot({ path: 'artifacts/qa/meeting-live-mobile.png', fullPage: true });
  await a.getByRole('button', { name: 'Leave Meeting', exact: true }).click();
  await b.getByRole('button', { name: 'Leave Meeting', exact: true }).click();
  await b.waitForURL('**/device-test?room=talk-workshop');
  assert.equal(await b.evaluate(() => window.__talkTestCaptures.every(stream => stream.getTracks().every(track => track.readyState === 'ended'))), true);
  step = 'unreachable server failure and track cleanup';
  await a.getByRole('button', { name: 'Enable camera & microphone', exact: true }).click();
  await expect(a.getByRole('button', { name: 'Turn camera off', exact: true })).toBeVisible({timeout:15000});
  await alice.context.route('**/api/auth/meetings/talk-workshop/token', async route => {
    const response = await route.fetch(); const body = await response.json();
    await route.fulfill({ response, json: { ...body, serverUrl: 'ws://127.0.0.1:9' } });
  });
  await a.getByRole('link', { name: 'Join session', exact: true }).click();
  await expect(a.locator('.live-meeting')).toHaveAttribute('data-connection-state', 'error', { timeout: 30000 });
  await expect(a.getByRole('button', { name: 'Rejoin meeting', exact: true })).toBeVisible();
  assert.equal(await a.evaluate(() => window.__talkTestCaptures.every(stream => stream.getTracks().every(track => track.readyState === 'ended'))), true);
  assert.deepEqual(errors, []);
  await fs.writeFile('artifacts/qa/live-meeting-test-results.json', JSON.stringify({ transport: 'real local LiveKit + two Chrome processes', media: 'generated video devices and WAV microphone fixtures', authenticatedAccounts: 'isolated verifier fixture; real Talk session cookies', evidence, passed: true }, null, 2));
  console.log('PASS real local LiveKit transport across TWO Chrome processes: received/decoded video and audible-signal audio in both directions; pre-join tests and device handoff; actual signaling interruption/reconnection, browser camera denial, disabled-device join, mute/unmute, camera toggle, participant count, duration, leave/rejoin, unreachable-server failure and capture cleanup. Media devices/account verification and the unreachable-server URL were fixtures, not physical devices or a real Google login.');
} catch (error) {
  await fs.writeFile('artifacts/qa/meeting-browser-error.txt',error.message);
  await fs.writeFile('artifacts/qa/live-meeting-test-results.json', JSON.stringify({ passed: false, failedAt: step }));
  if (step.includes('pre-join') && browsers[0]?.contexts()[0]?.pages()[0]) {
    await browsers[0].contexts()[0].pages()[0].screenshot({path:'artifacts/qa/prejoin-check-diagnostic.png',fullPage:true});
    await fs.writeFile('artifacts/qa/prejoin-check-diagnostic.txt',error.message);
    const diagnostics = await browsers[0].contexts()[0].pages()[0].evaluate(() => ({ alerts: Array.from(document.querySelectorAll('.device-page [role="alert"]')).map(element => element.textContent),
      controls:Array.from(document.querySelectorAll('.camera-controls button')).map(button=>({label:button.getAttribute('aria-label'),display:getComputedStyle(button).display,visibility:getComputedStyle(button).visibility})),
      previewTracks: document.querySelector('.camera-preview video')?.srcObject?.getTracks().length || 0 })).catch(() => ({}));
    console.error(JSON.stringify({ prejoinDiagnostics: diagnostics, assertion: error.message.split('\n').slice(0, 3).join(' ') }));
  }
  if (step.includes('permission') && browsers[0]?.contexts()[0]?.pages()[0]) {
    const diagnostics = await browsers[0].contexts()[0].pages()[0].evaluate(() => ({ state: document.querySelector('.live-meeting')?.dataset.connectionState,
      alerts: Array.from(document.querySelectorAll('.live-meeting [role="alert"]')).map(element => element.textContent) })).catch(() => ({}));
    console.error(JSON.stringify({ permissionDiagnostics: diagnostics }));
  }
  if (step.includes('reconnect') && browsers[0]?.contexts()[0]?.pages()[0]) {
    const diagnostics = await browsers[0].contexts()[0].pages()[0].evaluate(() => ({ state: document.querySelector('.live-meeting')?.dataset.connectionState,
      transitions: window.__talkTestStates, sockets: window.__talkTestSockets?.map(socket => socket.readyState), peers: window.__talkTestPeers?.map(pc => pc.connectionState) })).catch(() => ({}));
    console.error(JSON.stringify({ reconnectionDiagnostics: diagnostics }));
  }
  console.error(`FAIL real meeting browser test at: ${step} (${error.name}). No credentials or tokens printed.`); process.exitCode = 1;
} finally {
  await Promise.all(browsers.map(browser => browser.close()));
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); auth.locals.closeAuthDatabase();
}
