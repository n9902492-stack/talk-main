import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
import sharp from 'sharp';
import { expect } from '@playwright/test';
import { meetingHarness, connected, count, openPanel, panel } from './helpers/live-meeting.mjs';

// Only model delivery is delayed/failed. Camera capture, processing, publication
// and transport are the real browser/LiveKit implementations with test hardware.
await fs.mkdir('artifacts/qa', { recursive: true });
const fixture = path.resolve('artifacts/qa/video-effects-lifecycle-camera.png');
await sharp('tests/fixtures/astronaut.png').resize(640, 360, { fit: 'contain', background: '#269dce' }).png().toFile(fixture);
const cameraFile = path.resolve('artifacts/qa/video-effects-lifecycle-camera.y4m');
execFileSync(ffmpeg.path, ['-y', '-loop', '1', '-i', fixture, '-t', '2', '-r', '15', '-pix_fmt', 'yuv420p', cameraFile], { stdio: 'ignore', windowsHide: true });
const h = await meetingHarness({ cameraFile });
const evidence = {};
let step = 'startup', mainPage;
const modelPattern = '**/vendor/backgrounds/selfie-segmenter-v1.tflite';

async function observeCapture(context, fallback = false) {
  await context.addInitScript(({ fallback }) => {
    window.__talkLifecycleRaw = [];
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (...args) => {
      const stream = await capture(...args); window.__talkLifecycleRaw.push(...stream.getTracks()); return stream;
    };
    const canvasCapture = HTMLCanvasElement.prototype.captureStream;
    if (canvasCapture) HTMLCanvasElement.prototype.captureStream = function (...args) {
      const stream = canvasCapture.apply(this, args); window.__talkBackgroundOutputs.push(...stream.getVideoTracks()); return stream;
    };
    if (fallback) {
      Object.defineProperty(window, 'MediaStreamTrackProcessor', { value: undefined, configurable: true });
      Object.defineProperty(window, 'MediaStreamTrackGenerator', { value: undefined, configurable: true });
    }
  }, { fallback });
}
async function delayedModel(context) {
  let requests = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const handler = async route => { requests++; await gate; await route.abort('failed').catch(() => {}); };
  await context.route(modelPattern, handler);
  return {
    requested: () => expect.poll(() => requests, { timeout: 60000 }).toBeGreaterThan(0),
    release: async () => { release(); await context.unroute(modelPattern, handler); },
  };
}
async function failedModel(context) {
  let requests = 0;
  const handler = route => { requests++; return route.abort('failed'); };
  await context.route(modelPattern, handler);
  return { requests: () => requests, remove: () => context.unroute(modelPattern, handler) };
}
async function rawStopped(page) {
  await expect.poll(() => page.evaluate(() => window.__talkLifecycleRaw.length > 0 && window.__talkLifecycleRaw.every(track => track.readyState === 'ended')), { timeout: 15000 }).toBe(true);
}
async function outputsStopped(page) {
  await expect.poll(() => page.evaluate(() => window.__talkBackgroundOutputs.length > 0 && window.__talkBackgroundOutputs.every(track => track.readyState === 'ended')), { timeout: 20000 }).toBe(true);
}
async function snapshots(page) {
  return page.evaluate(() => ({ raw: window.__talkLifecycleRaw.map(track => ({ kind: track.kind, state: track.readyState })), outputs: window.__talkBackgroundOutputs.map(track => track.readyState), canvases: document.querySelectorAll('canvas[data-livekit-processor]').length }));
}
async function startCamera(page, name) {
  await page.goto(h.origin + '/device-test'); await page.getByLabel('Your display name').fill(name);
  await page.locator('.talk-prejoin-backgrounds > summary').click();
  await page.getByRole('button', { name: 'Reset All Effects', exact: true }).click();
  await page.getByRole('button', { name: 'Enable camera & microphone', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Turn camera off', exact: true })).toBeVisible({ timeout: 20000 });
  await expect.poll(() => page.getByLabel('Your camera preview').evaluate(video => video.videoWidth), { timeout: 20000 }).toBeGreaterThan(0);
}
async function chooseBlur(where) {
  const blur = where.getByRole('group', { name: 'Background choices' }).getByRole('button', { name: 'Blur', exact: true });
  await expect(blur).toBeEnabled({ timeout: 30000 }); await blur.click();
}
async function chroma(video) {
  return video.evaluate(element => {
    const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90;
    const context = canvas.getContext('2d'); context.drawImage(element, 0, 0, 160, 90);
    const pixels = context.getImageData(0, 0, 160, 90).data; let sum = 0;
    for (let i = 0; i < pixels.length; i += 4) sum += Math.abs(pixels[i] - pixels[i + 1]) + Math.abs(pixels[i + 1] - pixels[i + 2]) + Math.abs(pixels[i + 2] - pixels[i]);
    return sum / (160 * 90);
  });
}

try {
  let a;
  if (!process.argv.includes('--fallback-only')) {
  const alice = await h.member('LifecycleAlice'); await observeCapture(alice.context);
  a = alice.page; mainPage = a;
  step = 'stop prejoin devices while model initialization is pending';
  await startCamera(a, 'Alice');
  const delayedPreview = await delayedModel(alice.context);
  await chooseBlur(a); await delayedPreview.requested();
  await a.getByRole('button', { name: 'Stop devices', exact: true }).click(); await rawStopped(a);
  await delayedPreview.release(); await outputsStopped(a);
  await expect.poll(() => a.locator('canvas[data-livekit-processor]').count(), { timeout: 10000 }).toBe(0);
  evidence.pendingPrejoinStopped = await snapshots(a);
  console.log('PASS stopping prejoin devices cancels pending effect initialization and ends captures/outputs.');

  step = 'failed effect initialization never publishes an unprocessed camera';
  await a.close(); ({ page: a } = await h.member('LifecycleAlice', 440, alice.context)); mainPage = a;
  await startCamera(a, 'Alice'); const failed = await failedModel(alice.context);
  await chooseBlur(a);
  await expect(a.locator('[data-background-state="error"]')).toContainText('Reset All Effects', { timeout: 60000 });
  await a.getByRole('link', { name: 'Join session', exact: true }).click(); await connected(a);
  await expect(a.getByRole('button', { name: 'Enable camera', exact: true })).toBeEnabled({ timeout: 60000 });
  await expect.poll(() => failed.requests(), { timeout: 60000 }).toBeGreaterThanOrEqual(2);
  await expect(a.locator('.live-meeting-notice.is-error')).toBeVisible({ timeout: 20000 });
  const participants = await h.service.listParticipants(h.roomName());
  assert.equal(participants.length, 1);
  assert.equal(participants[0].tracks.some(track => track.source === 1), false, 'failed effects must not publish a raw camera track');
  assert.ok(participants[0].tracks.some(track => track.source === 2), 'working microphone remains published');
  await outputsStopped(a); evidence.failedCameraNotPublished = { modelRequests: failed.requests(), sources: participants[0].tracks.map(track => track.source), ...await snapshots(a) };
  await failed.remove();

  step = 'reset after failed effects restores normal outgoing camera';
  const bob = await h.member('LifecycleBob', 660); await h.join(bob.page, 'Bob', false); await count(a, 2); await count(bob.page, 2);
  await openPanel(a, 'Settings'); await panel(a).getByRole('button', { name: 'Backgrounds', exact: true }).click();
  await panel(a).getByRole('button', { name: 'Reset All Effects', exact: true }).click();
  await a.getByRole('button', { name: 'Enable camera', exact: true }).click();
  const remote = bob.page.locator('.live-participant-tile[data-local="false"] video');
  await expect.poll(() => remote.evaluate(video => video.videoWidth), { timeout: 30000 }).toBeGreaterThan(0);
  await expect.poll(() => chroma(remote), { timeout: 20000 }).toBeGreaterThan(10);
  evidence.recoveredRemoteChroma = await chroma(remote);
  console.log('PASS failed effect publishes no raw camera; Reset All Effects restores real remote camera video.');

  step = 'leave during pending fresh camera processor initialization';
  await a.getByRole('button', { name: 'Turn camera off', exact: true }).click();
  const delayedMeeting = await delayedModel(alice.context);
  await chooseBlur(panel(a)); await a.getByRole('button', { name: 'Enable camera', exact: true }).click();
  await delayedMeeting.requested();
  await a.getByRole('button', { name: 'Leave Meeting', exact: true }).click(); await a.waitForURL('**/device-test?room=talk-workshop');
  await rawStopped(a); await delayedMeeting.release(); await outputsStopped(a);
  await expect.poll(() => a.locator('canvas[data-livekit-processor]').count(), { timeout: 10000 }).toBe(0);
  await count(bob.page, 1); evidence.pendingMeetingStopped = await snapshots(a);
  await bob.page.close(); await a.close();
  console.log('PASS leaving during fresh camera effect initialization ends captures/outputs and leaves LiveKit.');
  }

  step = 'canvas fallback processes actual camera pixels and cleans up';
  const fallback = await h.member('LifecycleFallback', 880); await observeCapture(fallback.context, true);
  a = fallback.page; mainPage = a; await startCamera(a, 'Fallback');
  const preview = a.getByLabel('Your camera preview');
  await expect.poll(() => chroma(preview), { timeout: 20000 }).toBeGreaterThan(10); const rawChroma = await chroma(preview);
  await a.getByRole('button', { name: 'Video Filters', exact: true }).click(); await a.getByRole('button', { name: 'Black & White', exact: true }).click();
  await expect(a.locator('[data-background-state="active"]')).toBeVisible({ timeout: 60000 });
  await expect.poll(() => chroma(preview), { timeout: 30000 }).toBeLessThan(rawChroma * .25);
  evidence.canvasFallback = { rawChroma, processedChroma: await chroma(preview), processorAbsent: await a.evaluate(() => typeof window.MediaStreamTrackProcessor === 'undefined') };
  await a.getByRole('button', { name: 'Stop devices', exact: true }).click(); await rawStopped(a); await outputsStopped(a);
  assert.equal(await a.locator('canvas[data-livekit-processor]').count(), 0);
  step = 'canvas fallback preserves original capture during prejoin handoff';
  await a.getByRole('button', { name: 'Enable camera & microphone', exact: true }).click();
  await expect(a.locator('[data-background-state="active"]')).toBeVisible({ timeout: 60000 });
  await expect.poll(() => chroma(preview), { timeout: 30000 }).toBeLessThan(rawChroma * .25);
  const capturesBeforeJoin = await a.evaluate(() => window.__talkLifecycleRaw.filter(track => track.kind === 'video').length);
  await a.getByRole('link', { name: 'Join session', exact: true }).click(); await connected(a);
  await expect(a.getByRole('button', { name: 'Turn camera off', exact: true })).toBeEnabled({ timeout: 30000 });
  assert.equal(await a.evaluate(() => window.__talkLifecycleRaw.filter(track => track.kind === 'video').length), capturesBeforeJoin, 'prejoin processing must not replace the owned capture stream or reopen the selected camera on Join');
  const observer = await h.member('FallbackObserver', 990); await h.join(observer.page, 'Observer', false); await count(a, 2); await count(observer.page, 2);
  const fallbackRemote = observer.page.locator('.live-participant-tile[data-local="false"] video');
  await expect.poll(() => fallbackRemote.evaluate(video => video.videoWidth), { timeout: 30000 }).toBeGreaterThan(0);
  await expect.poll(() => chroma(fallbackRemote), { timeout: 30000 }).toBeLessThan(rawChroma * .25);
  evidence.canvasFallback.capturesBeforeJoin = capturesBeforeJoin;
  evidence.canvasFallback.capturesAfterJoin = await a.evaluate(() => window.__talkLifecycleRaw.filter(track => track.kind === 'video').length);
  evidence.canvasFallback.remoteChroma = await chroma(fallbackRemote);
  await a.getByRole('button', { name: 'Leave Meeting', exact: true }).click(); await a.waitForURL('**/device-test?room=talk-workshop');
  await rawStopped(a); await outputsStopped(a); await count(observer.page, 1);
  assert.deepEqual(h.errors, []);
  await fs.writeFile('artifacts/qa/video-effects-lifecycle-results.json', JSON.stringify({ passed: true, fallbackOnly: process.argv.includes('--fallback-only'), actualCameraProcessing: true, networkFailureFixtures: true, realLiveKitRecovery: true, evidence }, null, 2));
  console.log('PASS forced canvas fallback grades actual camera pixels, preserves prejoin capture, reaches a real remote LiveKit participant, and releases processing resources.');
} catch (error) {
  if (mainPage && !mainPage.isClosed()) {
    evidence.failureCapture = await snapshots(mainPage).catch(() => null);
    console.error('Lifecycle capture state:', JSON.stringify(evidence.failureCapture));
    await mainPage.screenshot({ path: 'artifacts/qa/video-effects-lifecycle-failure.png', fullPage: true }).catch(() => {});
  }
  console.error('FAIL video effects lifecycle:', step, error.message);
  await fs.writeFile('artifacts/qa/video-effects-lifecycle-results.json', JSON.stringify({ passed: false, step, message: error.message, evidence }, null, 2)); process.exitCode = 1;
} finally { await h.close(); }
