import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { chromium, expect } from '@playwright/test';
import { RoomServiceClient } from 'livekit-server-sdk';
import { createAuthApp } from '../../backend/src/auth.mjs';
import { createMeetingService } from '../../backend/src/meetings.mjs';
import { openAuthDatabase } from '../../backend/src/database.mjs';
import { localChrome } from '../../scripts/browser-options.mjs';
import { createRecordingRuntime } from '../../backend/src/recording-runtime.mjs';

export async function meetingHarness({ approvalRequired = false, cameraFile, cameraFiles = {}, recordings = false, audioFiles = {}, rawAudio = false, lowResourceMedia = false, frontendBuild = process.env.TALK_TEST_FRONTEND_BUILD || 'frontend/dist',whiteboardIntelligence,livekitConfig,databasePath,recordingEnv = {} } = {}) {
  const config = livekitConfig || globalThis.__talkBrowserLivekitConfig || JSON.parse(await fs.readFile('data/livekit-local.json', 'utf8'));
  const meetings = createMeetingService({ NODE_ENV: 'development', LIVEKIT_URL: config.url, LIVEKIT_API_KEY: config.apiKey, LIVEKIT_API_SECRET: config.apiSecret });
  const app = express(), server = app.listen(0, '127.0.0.1');
  // Long browser/media assertions leave API clients idle. Avoid the default
  // five-second keep-alive boundary racing a later fixture request.
  server.keepAliveTimeout=65000;server.headersTimeout=70000;
  await once(server, 'listening');
  // Windows can assign 6000 to listen(0), but Chrome rejects that X11 port.
  // Select another ephemeral port before any test routes/sessions are created.
  if(server.address().port===6000){
    await new Promise(resolve=>server.close(resolve));
    server.listen(0,'127.0.0.1');await once(server,'listening');
    assert.notEqual(server.address().port,6000,'Browser fixture requires a safe HTTP port');
  }
  const origin = `http://127.0.0.1:${server.address().port}`;
  const database = openAuthDatabase(databasePath);
  const recordingRuntime = recordings ? createRecordingRuntime({env:{WHISPER_THREADS:'1',RECORDING_LOCAL_PATH:path.resolve(`artifacts/qa/recording-browser-${Date.now()}`),...recordingEnv},service:meetings}) : undefined;
  const auth = createAuthApp({ clientId: 'phase-two-browser.apps.googleusercontent.com', origins: [origin], database, verifyCredential: async credential => JSON.parse(credential), meetings, recordings: recordingRuntime,...(whiteboardIntelligence?{whiteboardIntelligence}:{}) });
  auth.locals.attachMeetingGateway(server);
  app.use(auth);
  app.get('/test-presentation', (_req, res) => res.type('html').send('<!doctype html><title>Talk presentation fixture</title><style>html,body{margin:0;background:#ff573d;color:white;font:48px sans-serif}main{background:#005bff;width:75vw;height:80vh;display:grid;place-items:center}</style><main>Talk screen-share transport test<br><output></output></main><script>setInterval(()=>document.querySelector("output").textContent=String(Date.now()),200)</script>'));
  app.use(express.static(path.resolve(frontendBuild)));
  app.get('*', (_req, res) => res.sendFile(path.resolve(frontendBuild, 'index.html')));
  const browsers = [], errors = [];
  const service = new RoomServiceClient(config.url.replace('ws:', 'http:'), config.apiKey, config.apiSecret);
  await fs.mkdir('artifacts/qa', { recursive: true });

  async function tone(name, frequency) {
    const samples = 48000 * 8, wav = Buffer.alloc(44 + samples * 2);
    wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(96000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
    for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(12000 * Math.sin(2 * Math.PI * frequency * i / 48000)), 44 + i * 2);
    const file = path.resolve(`artifacts/qa/${name}-phase-two.wav`); await fs.writeFile(file, wav); return file;
  }
  async function member(name, frequency = 440, reuseContext) {
    let context = reuseContext;
    if (!context) {
      const memberCamera = cameraFiles[name] || cameraFile;
      const browser = await chromium.launch({ ...localChrome(), headless: true, args: [
        '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${audioFiles[name] || await tone(name, frequency)}`,
        ...(memberCamera ? [`--use-file-for-fake-video-capture=${memberCamera}`, '--enable-unsafe-swiftshader'] : []),
        '--autoplay-policy=no-user-gesture-required', '--disable-audio-track-processing', '--enable-usermedia-screen-capturing', '--allow-http-screen-capture',
        '--auto-select-tab-capture-source-by-title=Talk presentation fixture',
      ] });
      browsers.push(browser);
      // The isolated SFU advertises loopback ICE candidates. Recent Chrome
      // versions gate those behind Local Network Access independently of the
      // camera/microphone grants. This is test-only, never production bypass.
      context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['camera', 'microphone', 'local-network-access', 'clipboard-read', 'clipboard-write'], reducedMotion: 'reduce' });
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        return url.origin === origin || url.origin === config.url.replace('ws:','http:') ? route.continue() : route.abort();
      });
      await context.addInitScript(({ rawAudio, lowResourceMedia,localOnlyIce }) => {
        if(rawAudio || lowResourceMedia){const capture=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=constraints=>capture({...constraints,
          audio:rawAudio && constraints.audio?{...(typeof constraints.audio==='object'?constraints.audio:{}),echoCancellation:false,noiseSuppression:false,autoGainControl:false}:constraints.audio,
          video:lowResourceMedia && constraints.video?{...(typeof constraints.video==='object'?constraints.video:{}),width:{ideal:640,max:640},height:{ideal:360,max:360},frameRate:{ideal:10,max:10}}:constraints.video,
        });}
        window.__talkTestPeers = []; window.__talkTestSockets = []; window.__talkTestDisplays = [];
        window.__talkBackgroundOutputs = [];
        const Generator = window.MediaStreamTrackGenerator;
        if (Generator) window.MediaStreamTrackGenerator = class extends Generator { constructor(...args) { super(...args); window.__talkBackgroundOutputs.push(this); } };
        const Peer = window.RTCPeerConnection;
        window.RTCPeerConnection = class extends Peer { constructor(...args) { if(localOnlyIce)args[0]={...args[0],iceServers:[]};super(...args); window.__talkTestPeers.push(this); } };
        const Socket = window.WebSocket;
        window.WebSocket = class extends Socket { constructor(...args) { super(...args); window.__talkTestSockets.push(this); } };
        const capture = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getDisplayMedia = async (...args) => { const stream = await capture(...args); window.__talkTestDisplays.push(stream); return stream; };
      }, { rawAudio, lowResourceMedia,localOnlyIce:globalThis.__cloudEgressGuard===true });
      const cfg = await (await context.request.get(origin + '/api/auth/config')).json();
      const seconds = Math.floor(Date.now() / 1000);
      const response = await context.request.post(origin + '/api/auth/google', { headers: { Origin: origin, 'X-CSRF-Token': cfg.csrfToken }, data: { credential: JSON.stringify({ iss: 'https://accounts.google.com', aud: cfg.clientId, sub: `phase-two-${name}`, name, email: `${name}@example.test`, email_verified: true, nonce: cfg.nonce, iat: seconds, exp: seconds + 3600 }) } });
      assert.equal(response.status(), 200); const session = await response.json();
      assert.equal((await context.request.post(origin + '/api/auth/google/confirm', { headers: { Origin: origin, 'X-CSRF-Token': session.csrfToken }, data: {} })).status(), 200);
      const created = await context.request.post(origin + '/api/auth/meetings/talk-workshop/create', { headers: { Origin: origin, 'X-CSRF-Token': session.csrfToken }, data: { approvalRequired } });
      assert.ok([201, 409].includes(created.status()));
    }
    const page = await context.newPage(); page.on('pageerror', () => errors.push('pageerror'));
    return { page, context };
  }
  async function join(page, name, media = false, roomId = 'talk-workshop', waitForConnection = true) {
    await page.goto(origin + '/device-test?room=' + encodeURIComponent(roomId), { waitUntil: 'domcontentloaded', timeout: 60000 }); await page.getByLabel('Your display name').fill(name, { timeout: 45000 });
    if (media) { await page.getByRole('button', { name: 'Enable camera & microphone', exact: true }).click(); await expect(page.getByRole('button', { name: 'Turn camera off', exact: true })).toBeVisible({ timeout: 45000 }); }
    await page.getByRole('link', { name: 'Join session', exact: true }).click(); if (waitForConnection) await connected(page);
  }
  async function api(context, action, target, extra = {}, roomId = 'talk-workshop') {
    const route = origin + '/api/auth/meetings/' + encodeURIComponent(roomId);
    const config = await (await context.request.get(route)).json();
    return context.request.post(route + '/actions', { headers: { Origin: origin, 'X-CSRF-Token': config.csrfToken }, data: { action, target, ...extra } });
  }
  async function createMeeting(context, title, approvalRequired = true) {
    const config = await (await context.request.get(origin + '/api/auth/meetings/talk-workshop')).json();
    const response = await context.request.post(origin + '/api/auth/meetings', { headers: { Origin: origin, 'X-CSRF-Token': config.csrfToken }, data: { title, approvalRequired } });
    assert.equal(response.status(), 201);
    return (await response.json()).meeting;
  }
  return { origin, member, join, errors, service, meetings, api, createMeeting, database, recordingRuntime, recordingWorker: auth.locals.recordings, roomName: (roomId = 'talk-workshop') => database.prepare('SELECT room_name FROM talk_meetings WHERE id=?').get(roomId).room_name,
    close: async () => { await Promise.all(browsers.map(browser => browser.close())); await auth.locals.closeAuthDatabase(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); database.close(); } };
}
export const connected = page => expect(page.locator('.live-meeting')).toHaveAttribute('data-connection-state', 'connected', { timeout: 30000 });
export const count = (page, value) => expect(page.getByLabel('Participant count', { exact: true })).toHaveText(String(value), { timeout: 20000 });
export const panel = page => page.locator('#live-meeting-panel');
export async function openPanel(page, name) {
  if (['Settings','Reactions'].includes(name) && !await page.getByRole('button',{name,exact:true}).count()) {
    const more=page.getByRole('button',{name:'More options',exact:true});
    if(await more.getAttribute('aria-expanded')!=='true')await more.click();
  }
  // Chat's accessible name includes the real unread count after delivery.
  const button = page.getByRole('button', { name: name === 'Chat' ? /^Chat(?: \(\d+ unread\))?$/ : name, exact: true });
  if (await button.getAttribute('aria-expanded') !== 'true') await button.click();
}
export async function stats(page) {
  return page.evaluate(async () => {
    let frames = 0, audioPackets = 0;
    for (const pc of window.__talkTestPeers) {
      if (pc.connectionState === 'closed') continue;
      for (const report of (await pc.getStats()).values()) if (report.type === 'inbound-rtp') {
        if (report.kind === 'video') frames += report.framesDecoded || 0;
        if (report.kind === 'audio') audioPackets += report.packetsReceived || 0;
      }
    }
    return { frames, audioPackets };
  });
}
