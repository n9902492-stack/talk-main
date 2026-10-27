import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { expect } from '@playwright/test';
import { meetingHarness, connected, count, openPanel, panel, stats } from './helpers/live-meeting.mjs';

// The application, Talk session cookies, LiveKit signaling and WebRTC are real.
// Account verification and camera/microphone hardware are isolated fixtures.
// Only the explicit failure test replaces the SFU URL with an unreachable port.
// This script never reads production environment files or contacts auth providers.
const sizes = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'laptop', width: 1366, height: 768 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
];
const resultFile = 'artifacts/qa/meeting-studio-results.json';
const h = await meetingHarness({frontendBuild: process.env.TALK_TEST_FRONTEND_BUILD});
const pages = [];
const evidence = { viewports: sizes, snapshots: [], geometry: [] };
let step = 'launch';
await fs.writeFile(resultFile, JSON.stringify({ passed: false, status: 'running' }));

async function trackCapture(page) {
  await page.addInitScript(() => {
    window.__talkStudioCaptures = [];
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (...args) => {
      const stream = await capture(...args);
      window.__talkStudioCaptures.push(stream);
      return stream;
    };
  });
}

async function allCapturesStopped(page) {
  await expect.poll(() => page.evaluate(() => window.__talkStudioCaptures.length > 0
    && window.__talkStudioCaptures.every(stream => stream.getTracks().every(track => track.readyState === 'ended'))), {
    timeout: 15000,
    message: 'Every real fixture capture track must stop after leaving or failing to connect',
  }).toBe(true);
}

async function checkHorizontalGeometry(page, stage) {
  const geometry = await page.evaluate(() => ({
    width: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  assert.ok(geometry.scrollWidth <= geometry.width + 1, `${stage}: the page must not overflow horizontally`);
  assert.ok(geometry.bodyWidth <= geometry.width + 1, `${stage}: the body must not overflow horizontally`);
  evidence.geometry.push({ stage, ...geometry });
}

async function inViewport(locator, stage) {
  await expect(locator).toBeVisible();
  const visible = await locator.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return bounds.width > 0 && bounds.height > 0 && bounds.left >= -1
      && bounds.right <= innerWidth + 1 && bounds.top >= -1 && bounds.bottom <= innerHeight + 1;
  });
  assert.equal(visible, true, `${stage}: the control must remain inside the viewport`);
}

async function reachable(locator, stage) {
  await locator.scrollIntoViewIfNeeded();
  await inViewport(locator, stage);
}

async function snapshot(page, name, fullPage = false) {
  const filename = `artifacts/qa/meeting-studio-${name}.png`;
  await page.screenshot({ path: filename, fullPage, animations: 'disabled' });
  evidence.snapshots.push(filename);
}

async function prejoinControls(page, size, cameraOn) {
  await checkHorizontalGeometry(page, `prejoin-${cameraOn ? 'on' : 'off'}-${size.name}`);
  if (size.width >= 1100) {
    const height = await page.evaluate(() => ({ viewport: innerHeight, document: document.documentElement.scrollHeight }));
    assert.ok(height.document <= height.viewport + 1, `prejoin-${size.name}: desktop preview and Join session should fit the screen`);
  }
  await expect(page.getByLabel('Your display name')).toHaveAttribute('required', '');
  await expect(page.locator('#camera-select')).toHaveAccessibleName(/Camera/);
  await expect(page.locator('#mic-select')).toHaveAccessibleName(/Microphone/);
  for (const [name, locator] of [
    ['display-name', page.getByLabel('Your display name')],
    ['join', page.getByRole('link', { name: 'Join session', exact: true })],
    ['camera-control', page.getByRole('button', { name: cameraOn ? 'Turn camera off' : 'Enable camera', exact: true })],
    ['microphone-control', page.getByRole('button', { name: cameraOn ? 'Mute microphone' : 'Enable microphone', exact: true })],
    ['enable-devices', page.getByRole('button', { name: 'Enable camera & microphone', exact: true })],
    ['camera-selector', page.locator('#camera-select')],
    ['microphone-selector', page.locator('#mic-select')],
    ['speaker-test', page.getByRole('button', { name: 'Play test sound', exact: true })],
    ['microphone-test', page.getByRole('button', { name: 'Record a 5-second mic test', exact: true })],
  ]) await reachable(locator, `prejoin-${size.name}-${name}`);
  await expect(page.getByRole('meter', { name: 'Microphone input level' })).toBeVisible();
  await page.getByLabel('Your display name').focus();
  await expect(page.getByLabel('Your display name')).toBeFocused();
  await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector('.device-settings')?.scrollTo(0, 0); });
}

async function meetingControls(page, size, mediaOn, stage) {
  await checkHorizontalGeometry(page, `${stage}-${size.name}`);
  await expect(page.locator('.studio-brand-mark svg')).toBeVisible();
  assert.equal(await page.locator('.studio-brand-mark').evaluate(element => getComputedStyle(element).color), 'rgb(210, 177, 106)', 'The redesigned meeting uses the reference gold Talk mark');
  for (const name of [mediaOn ? 'Mute microphone' : 'Enable microphone', mediaOn ? 'Turn camera off' : 'Enable camera', 'Leave Meeting']) {
    await inViewport(page.getByRole('button', { name, exact: true }), `${stage}-${size.name}-${name}`);
  }
  await expect(page.getByLabel('Meeting duration', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Participant count', { exact: true })).toBeVisible();
}

try {
  const alice = await h.member('StudioAlice', 440);
  const bob = await h.member('StudioBob', 660);
  const a = alice.page, b = bob.page;
  pages.push(a, b);
  await trackCapture(a); await trackCapture(b);

  step = 'prejoin camera-off layouts and accessible controls';
  await a.goto(h.origin + '/device-test?room=talk-workshop', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await a.getByLabel('Your display name').fill('Alice Studio');
  for (const size of sizes) {
    await a.setViewportSize({ width: size.width, height: size.height });
    await expect(a.getByText('Your camera is off', { exact: true })).toBeVisible();
    await prejoinControls(a, size, false);
    await snapshot(a, `prejoin-off-${size.name}`, true);
  }

  step = 'real prejoin camera frames and camera-on layouts';
  await a.setViewportSize({ width: sizes[0].width, height: sizes[0].height });
  await a.getByRole('button', { name: 'Enable camera & microphone', exact: true }).click();
  await expect(a.getByRole('button', { name: 'Turn camera off', exact: true })).toBeVisible({ timeout: 30000 });
  await expect.poll(() => a.getByLabel('Your camera preview', { exact: true }).evaluate(video => video.videoWidth), { timeout: 20000 }).toBeGreaterThan(0);
  for (const size of sizes) {
    await a.setViewportSize({ width: size.width, height: size.height });
    await prejoinControls(a, size, true);
    await snapshot(a, `prejoin-on-${size.name}`, true);
  }
  await a.getByRole('button', { name: 'Stop devices', exact: true }).click();
  await allCapturesStopped(a);

  step = 'actual solo LiveKit connection with camera-off avatar';
  await a.getByRole('link', { name: 'Join session', exact: true }).click();
  await connected(a); await count(a, 1);
  await expect(a.locator('.live-participant-tile[data-local="true"]').getByText('Camera off', { exact: true })).toBeVisible();
  for (const size of sizes) {
    await a.setViewportSize({ width: size.width, height: size.height });
    await meetingControls(a, size, false, 'solo');
    await snapshot(a, `solo-avatar-${size.name}`);
  }

  step = 'fullscreen keeps meeting controls and panels available';
  await a.setViewportSize({ width: sizes[0].width, height: sizes[0].height });
  if (await a.evaluate(() => document.fullscreenEnabled)) {
    await a.getByRole('button', { name: 'Enter fullscreen', exact: true }).click();
    await expect.poll(() => a.evaluate(() => document.fullscreenElement?.classList.contains('meeting-studio'))).toBe(true);
    assert.equal(await a.locator('.live-meeting-controls').evaluate(element => document.fullscreenElement?.contains(element)), true, 'Fullscreen must include media/leave controls and recording disclosures');
    await meetingControls(a, sizes[0], false, 'fullscreen');
    await openPanel(a, 'Participants');
    await expect(panel(a)).toBeVisible();
    await panel(a).getByRole('button', { name: 'Close meeting panel' }).click();
    await a.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
    await expect.poll(() => a.evaluate(() => document.fullscreenElement === null)).toBe(true);
  }

  step = 'actual two-browser video and audio transport';
  await a.setViewportSize({ width: sizes[0].width, height: sizes[0].height });
  await a.getByRole('button', { name: 'Enable camera', exact: true }).click();
  await a.getByRole('button', { name: 'Enable microphone', exact: true }).click();
  await h.join(b, 'Bob Studio', true);
  await count(a, 2); await count(b, 2);
  for (const page of [a, b]) {
    await expect.poll(async () => (await stats(page)).frames, { timeout: 25000 }).toBeGreaterThan(5);
    await expect.poll(async () => (await stats(page)).audioPackets, { timeout: 25000 }).toBeGreaterThan(5);
    await expect.poll(() => page.locator('.live-participant-tile[data-local="false"] video').evaluate(video => video.videoWidth), { timeout: 20000 }).toBeGreaterThan(0);
  }
  evidence.rtp = { alice: await stats(a), bob: await stats(b) };

  step = 'responsive real meeting canvas and accessible panels';
  for (const size of sizes) {
    await a.setViewportSize({ width: size.width, height: size.height });
    await meetingControls(a, size, true, 'two-participants');
    await snapshot(a, `two-participants-${size.name}`);
    for (const name of ['Participants', 'Settings']) {
      await openPanel(a, name);
      await expect(panel(a)).toBeVisible();
      await checkHorizontalGeometry(a, `panel-${name}-${size.name}`);
      await inViewport(panel(a).getByRole('button', { name: 'Close meeting panel' }), `close-${name}-${size.name}`);
      if (size.width < 700) {
        await expect(panel(a)).toHaveAttribute('role', 'dialog');
        await expect(panel(a)).toHaveAttribute('aria-modal', 'true');
      }
      if (name === 'Participants') await expect(panel(a)).toContainText('Bob Studio');
      if (name === 'Settings') {
        await expect(a.locator('#live-videoinput')).toBeVisible();
        await expect(a.locator('#live-audioinput')).toBeVisible();
      }
      await snapshot(a, `${name.toLowerCase()}-${size.name}`);
      await a.keyboard.press('Escape');
      await expect(panel(a)).toHaveCount(0);
      await expect(a.getByRole('button', { name, exact: true })).toBeFocused();
    }
  }

  step = 'camera-off avatar propagation and leaving releases captures';
  await a.getByRole('button', { name: 'Turn camera off', exact: true }).click();
  await expect(b.locator('.live-participant-tile[data-local="false"]').getByText('Camera off', { exact: true })).toBeVisible();
  await a.getByRole('button', { name: 'Leave Meeting', exact: true }).click();
  await a.waitForURL('**/device-test?room=talk-workshop');
  await count(b, 1); await allCapturesStopped(a);
  await b.getByRole('button', { name: 'Leave Meeting', exact: true }).click();
  await b.waitForURL('**/device-test?room=talk-workshop');
  await allCapturesStopped(b);

  step = 'unreachable meeting server produces the redesigned failure stage';
  await a.setViewportSize({ width: sizes[0].width, height: sizes[0].height });
  await a.getByRole('button', { name: 'Enable camera & microphone', exact: true }).click();
  await expect(a.getByRole('button', { name: 'Turn camera off', exact: true })).toBeVisible({ timeout: 30000 });
  const failureEndpoint = '**/api/auth/meetings/talk-workshop/token';
  const failServer = async route => {
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, serverUrl: 'ws://127.0.0.1:9' } });
  };
  await a.route(failureEndpoint, failServer);
  await a.getByRole('link', { name: 'Join session', exact: true }).click();
  await expect(a.locator('.live-meeting')).toHaveAttribute('data-connection-state', 'error', { timeout: 35000 });
  await expect(a.getByRole('heading', { name: 'Unable to join the meeting', exact: true })).toBeVisible();
  await expect(a.getByRole('alert')).toContainText('Could not connect to the meeting server');
  await allCapturesStopped(a);
  for (const size of sizes) {
    await a.setViewportSize({ width: size.width, height: size.height });
    await meetingControls(a, size, false, 'connection-error');
    await inViewport(a.getByRole('button', { name: 'Rejoin meeting', exact: true }), `retry-${size.name}`);
    await inViewport(a.getByRole('link', { name: 'Back to pre-join', exact: true }), `back-${size.name}`);
    await expect(a.getByRole('button', { name: 'Enable camera', exact: true })).toBeDisabled();
    await expect(a.getByRole('button', { name: 'Enable microphone', exact: true })).toBeDisabled();
    await snapshot(a, `connection-error-${size.name}`);
  }

  step = 'removing failure fixture allows real reconnection and clean leave';
  await a.unroute(failureEndpoint, failServer);
  await a.getByRole('button', { name: 'Rejoin meeting', exact: true }).click();
  await connected(a); await count(a, 1);
  await a.getByRole('button', { name: 'Leave Meeting', exact: true }).click();
  await a.waitForURL('**/device-test?room=talk-workshop');
  await allCapturesStopped(a);
  assert.deepEqual(h.errors, []);

  await fs.writeFile(resultFile, JSON.stringify({
    passed: true,
    transport: 'real local LiveKit with two separate Chrome processes',
    fixtures: 'isolated account verification, generated camera/microphone hardware; explicit unreachable SFU only for failure stage',
    ...evidence,
  }, null, 2));
  console.log('PASS Talk meeting studio: four responsive prejoin camera-off/on layouts, solo avatar, two-browser real video/audio RTP, panels and keyboard focus, remote camera-off avatar, error/rejoin states and media cleanup. Account identities and camera/microphone hardware are fixtures. No deployment or external authentication calls.');
} catch (error) {
  for (const [index, page] of pages.entries()) await page.screenshot({ path: `artifacts/qa/meeting-studio-failure-${index}.png`, fullPage: true }).catch(() => {});
  // Only assertion messages are useful for geometry diagnostics; network errors
  // may contain headers. Keep those private and redact URL/JWT text regardless.
  const diagnostic = /^(?:AssertionError|Error)$/.test(error?.name || '') && !/request\.|headers|authorization|credential|token=/i.test(error?.message || '')
    ? String(error.message).replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[token withheld]').replace(/https?:\/\/[^\s)]+/g, '[URL withheld]').slice(0, 1400)
    : 'See the failure screenshot and failed stage.';
  await fs.writeFile(resultFile, JSON.stringify({ passed: false, failedAt: step, diagnostic, ...evidence }, null, 2));
  console.error(`FAIL Talk meeting studio at ${step} (${error?.name || 'Error'}): ${diagnostic}`);
  process.exitCode = 1;
} finally {
  await h.close();
}
