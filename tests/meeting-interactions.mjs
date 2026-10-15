import { localChrome } from '../scripts/browser-options.mjs';
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const base = process.env.BASE_URL || 'http://localhost:3001';
const browserOptions = localChrome();
const artifactDirectory = 'artifacts/qa';
await fs.mkdir(artifactDirectory, { recursive: true });

const browser = await chromium.launch({
  ...browserOptions,
  headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--disable-gpu'],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  permissions: ['camera', 'microphone'],
});

// Keep native camera/microphone streams observable. Only the screen chooser is
// replaced: a real canvas MediaStream exercises the application's media wiring.
await context.addInitScript(() => {
  const observations = window.__meetingTest = { mediaStreams: [], screenStreams: [] };
  const nativeGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async constraints => {
    const stream = await nativeGetUserMedia(constraints);
    observations.mediaStreams.push(stream);
    return stream;
  };
  Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', {
    configurable: true,
    value: async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 360;
      const drawing = canvas.getContext('2d');
      let frame = 0;
      const paint = () => {
        drawing.fillStyle = frame++ % 2 ? '#795900' : '#5b4bb7';
        drawing.fillRect(0, 0, canvas.width, canvas.height);
        drawing.fillStyle = '#ffffff';
        drawing.font = '24px sans-serif';
        drawing.fillText('Screen sharing test', 24, 48);
      };
      paint();
      const stream = canvas.captureStream(15);
      const timer = setInterval(paint, 67);
      observations.screenStreams.push(stream);
      for (const track of stream.getTracks()) {
        const nativeStop = track.stop.bind(track);
        track.stop = () => {
          nativeStop();
          if (stream.getTracks().every(item => item.readyState === 'ended')) clearInterval(timer);
        };
      }
      return stream;
    },
  });
});

const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
let activeCheck = '';
const check = async (name, run) => {
  activeCheck = name;
  console.log(`RUN  ${name}`);
  await run();
  console.log(`PASS ${name}`);
};
const button = name => page.getByRole('button', { name, exact: true });
const recording = page.locator('.workshop-video');
const selfVideo = page.locator('.self-tile video');
const strokes = page.locator('.drawing-layer path');

async function drawStroke(offset = 0) {
  const bounds = await page.locator('.drawing-layer').boundingBox();
  assert.ok(bounds, 'The drawing canvas must be visible');
  const x = bounds.x + bounds.width * 0.18;
  const y = bounds.y + bounds.height * 0.7 + offset;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + bounds.width * 0.08, y - 12, { steps: 4 });
  await page.mouse.move(x + bounds.width * 0.16, y + 8, { steps: 4 });
  await page.mouse.up();
}

async function assertNoOverflow(label) {
  const dimensions = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert.ok(dimensions.document <= dimensions.viewport + 1 && dimensions.body <= dimensions.viewport + 1,
    `${label} has horizontal overflow: ${JSON.stringify(dimensions)}`);
}

try {
  await page.goto(`${base}/meeting`, { waitUntil: 'domcontentloaded' });
  await page.locator('.room-stage').waitFor();

  await check('Uploaded MP4 loads, plays, pauses, seeks, and survives whiteboard toggles', async () => {
    await expect(recording).toHaveAttribute('src', '/reference/meeting-uploaded.mp4');
    assert.equal(await recording.evaluate(video => video.controls), true, 'Native playback/seek controls must remain available');
    await expect.poll(() => recording.evaluate(video => video.readyState >= 2 && video.videoWidth > 0 && Number.isFinite(video.duration) && video.duration > 0)).toBe(true);
    await expect.poll(() => recording.evaluate(video => !video.paused && video.currentTime > 0.1)).toBe(true);
    await recording.evaluate(video => { window.__meetingTest.recording = video; });
    await button('Pause').click();
    await expect.poll(() => recording.evaluate(video => video.paused)).toBe(true);
    const target = await recording.evaluate(video => {
      const time = Math.min(12, video.duration / 2);
      video.currentTime = time;
      return time;
    });
    await expect.poll(() => recording.evaluate(video => !video.seeking && video.readyState >= 2)).toBe(true);
    assert.ok(Math.abs(await recording.evaluate(video => video.currentTime) - target) < 0.15, 'The recording must seek to the requested time');
    await button('Whiteboard').click();
    await expect(page.locator('.whiteboard')).toBeVisible();
    await expect(recording).not.toBeVisible();
    await button('Whiteboard').click();
    await expect(recording).toBeVisible();
    assert.equal(await recording.evaluate(video => video === window.__meetingTest.recording), true, 'Whiteboard must preserve the recording element');
    assert.equal(await recording.evaluate(video => video.paused), true, 'Returning from whiteboard must retain the paused state');
    assert.ok(Math.abs(await recording.evaluate(video => video.currentTime) - target) < 0.15, 'Whiteboard must preserve the seek position');
    await button('Play').click();
    await expect.poll(() => recording.evaluate(video => !video.paused)).toBe(true);
    const resumeAt = await recording.evaluate(video => video.currentTime);
    await expect.poll(() => recording.evaluate(video => video.currentTime)).toBeGreaterThan(resumeAt + 0.1);
    await button('Whiteboard').click();
    await expect.poll(() => recording.evaluate(video => video.paused)).toBe(true);
    const boardTime = await recording.evaluate(video => video.currentTime);
    await button('Whiteboard').click();
    await expect.poll(() => recording.evaluate(video => !video.paused)).toBe(true);
    assert.equal(await recording.evaluate(video => video === window.__meetingTest.recording), true);
    assert.ok(await recording.evaluate(video => video.currentTime) >= boardTime - 0.15, 'Playing video must resume from its retained position');
  });

  await check('Raise/lower hand appears on the self tile and participants list', async () => {
    // Pin a recording frame that contains the participant being replaced. The
    // intro and later layouts may hide that embedded tile during device setup.
    await button('Pause').click();
    await expect.poll(() => recording.evaluate(video => video.paused)).toBe(true);
    await recording.evaluate(video => { video.currentTime = 12; });
    await expect.poll(() => recording.evaluate(video => !video.seeking && video.readyState >= 2 && Math.abs(video.currentTime - 12) < 0.15)).toBe(true);
    await expect(page.locator('.self-tile')).toBeVisible();
    await button('Raise hand').click();
    await expect(page.locator('.self-tile .raised-hand')).toBeVisible();
    await button('Participants').click();
    await expect(page.locator('.participant-list .raised-hand')).toBeVisible();
    await button('Lower hand').click();
    await expect(page.locator('.self-tile .raised-hand')).toHaveCount(0);
    await expect(page.locator('.participant-list .raised-hand')).toHaveCount(0);
    await button('Close side panel').click();
  });

  await check('Self-tile camera and microphone use live tracks and toggle correctly', async () => {
    await button('Enable camera').click();
    await expect(selfVideo).toBeVisible({ timeout: 45000 });
    await expect.poll(() => selfVideo.evaluate(video => video.srcObject instanceof MediaStream && video.srcObject.getVideoTracks()[0]?.readyState === 'live' && video.videoWidth > 0), { timeout: 45000 }).toBe(true);
    console.log(`INFO Camera frame delivery: ${JSON.stringify(await selfVideo.evaluate(video => ({ width: video.videoWidth, readyState: video.readyState })))}`);
    const originalCamera = await selfVideo.evaluateHandle(video => video.srcObject.getVideoTracks()[0]);
    await button('Enable microphone').click();
    await expect.poll(() => selfVideo.evaluate(video => video.srcObject?.getTracks().length), { timeout: 30000 }).toBe(2);
    await expect.poll(() => selfVideo.evaluate(video => video.videoWidth > 0 && video.readyState >= 2), { timeout: 30000 }).toBe(true);
    assert.equal(await originalCamera.evaluate(track => track.readyState), 'ended', 'Replaced camera streams must release their tracks');
    await originalCamera.dispose();
    await button('Mute microphone').click();
    assert.equal(await selfVideo.evaluate(video => video.srcObject.getAudioTracks()[0].enabled), false);
    await button('Enable microphone').click();
    assert.equal(await selfVideo.evaluate(video => video.srcObject.getAudioTracks()[0].enabled), true);
    await button('Turn camera off').click();
    await expect(selfVideo).not.toBeVisible();
    await expect(page.locator('.self-avatar')).toBeVisible();
    assert.equal(await selfVideo.evaluate(video => video.srcObject.getVideoTracks()[0].enabled), false);
    await button('Enable camera').click();
    await expect(selfVideo).toBeVisible();
    assert.equal(await selfVideo.evaluate(video => video.srcObject.getVideoTracks()[0].enabled), true);
  });

  await check('Whiteboard draws, undoes, clears, changes color, and retains strokes', async () => {
    await button('Whiteboard').click();
    await drawStroke();
    await expect(strokes).toHaveCount(1);
    assert.match(await strokes.first().getAttribute('d'), /^M.+ L.+/);
    await button('Draw in #5b4bb7').click();
    await drawStroke(25);
    await expect(strokes).toHaveCount(2);
    await expect(strokes.last()).toHaveAttribute('stroke', '#5b4bb7');
    await button('Undo last stroke').click();
    await expect(strokes).toHaveCount(1);
    const savedStroke = await strokes.first().getAttribute('d');
    await button('Whiteboard').click();
    await expect(recording).toBeVisible();
    await button('Whiteboard').click();
    await expect(page.locator('.whiteboard')).toBeVisible();
    await expect(strokes).toHaveCount(1);
    await expect(strokes.first()).toHaveAttribute('d', savedStroke);
    await drawStroke(25);
    await expect(strokes).toHaveCount(2);
    await button('Clear drawing').click();
    await expect(strokes).toHaveCount(0);
    await button('Whiteboard').click();
  });

  await check('Chat and Q&A send, preserve messages, and toggle votes', async () => {
    await button('Chat').click();
    await expect(button('Send message')).toBeDisabled();
    await page.getByRole('textbox', { name: 'Chat message' }).fill('Meeting interaction test message');
    await button('Send message').click();
    await expect(page.locator('.chat-message').filter({ hasText: 'Meeting interaction test message' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Chat message' })).toHaveValue('');
    await button('Q&A').click();
    await page.getByRole('textbox', { name: 'Your question' }).fill('How can we compare our marketing tools?');
    await button('Send question').click();
    await expect(page.locator('.question')).toContainText('How can we compare our marketing tools?');
    await page.locator('.question button').click();
    await expect(page.locator('.question button')).toContainText('1 Voted');
    await page.locator('.question button').click();
    await expect(page.locator('.question button')).toContainText('0 Upvote');
    await button('Chat').click();
    await expect(page.locator('.chat-message').filter({ hasText: 'Meeting interaction test message' })).toBeVisible();
    await button('Close side panel').click();
  });

  await check('Reactions display and expire without leaving the picker open', async () => {
    await button('Reactions').click();
    const reaction = page.locator('.reaction-picker button').first();
    const value = await reaction.innerText();
    await reaction.click();
    await expect(page.locator('.floating-reaction')).toHaveText(value);
    await expect(page.locator('.reaction-picker')).toHaveCount(0);
    await expect(page.locator('.floating-reaction')).toHaveCount(0, { timeout: 5000 });
  });

  await check('Screen sharing attaches a real stream and releases tracks on stop and external end', async () => {
    await button('Play').click();
    await expect.poll(() => recording.evaluate(video => !video.paused)).toBe(true);
    await button('Share').click();
    const sharedVideo = page.getByLabel('Your shared screen', { exact: true });
    await expect(sharedVideo).toBeVisible();
    await expect.poll(() => sharedVideo.evaluate(video => video.srcObject instanceof MediaStream && video.videoWidth === 640 && video.srcObject.getVideoTracks()[0]?.readyState === 'live')).toBe(true);
    await expect(page.locator('.stage-caption-label')).toContainText('You are sharing your screen');
    await expect(page.locator('.self-tile')).not.toBeVisible();
    await expect.poll(() => recording.evaluate(video => video.paused)).toBe(true);
    await button('Stop sharing').click();
    await expect(sharedVideo).not.toBeVisible();
    assert.equal(await page.evaluate(() => window.__meetingTest.screenStreams[0].getTracks().every(track => track.readyState === 'ended')), true);
    await expect(recording).toBeVisible();
    await expect.poll(() => recording.evaluate(video => !video.paused)).toBe(true);
    await button('Share').click();
    await expect(sharedVideo).toBeVisible();
    await page.evaluate(() => {
      const stream = window.__meetingTest.screenStreams.at(-1);
      for (const track of stream.getTracks()) track.stop();
      stream.getVideoTracks()[0].dispatchEvent(new Event('ended'));
    });
    await expect(button('Share')).toBeVisible();
    await expect(sharedVideo).not.toBeVisible();
    await expect(recording).toBeVisible();
    assert.equal(await recording.evaluate(video => video === window.__meetingTest.recording), true, 'Sharing must preserve the recording element');
  });

  await check('Leaving releases active camera, microphone, and shared screen tracks', async () => {
    await button('Share').click();
    await expect(page.getByLabel('Your shared screen', { exact: true })).toBeVisible();
    assert.equal(await page.evaluate(() => window.__meetingTest.mediaStreams.at(-1).getTracks().every(track => track.readyState === 'live')), true);
    await page.screenshot({ path: `${artifactDirectory}/meeting-interactions-desktop.png`, fullPage: true });
    await page.getByRole('link', { name: 'Leave', exact: true }).click();
    await page.waitForURL('**/device-test');
    await expect.poll(() => page.evaluate(() => [...window.__meetingTest.mediaStreams, ...window.__meetingTest.screenStreams].every(stream => stream.getTracks().every(track => track.readyState === 'ended')))).toBe(true);
  });

  await check('Meeting and whiteboard fit a mobile viewport with usable footer controls', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/meeting`, { waitUntil: 'domcontentloaded' });
    await expect(recording).toBeVisible();
    await assertNoOverflow('Mobile meeting');
    await button('Whiteboard').click();
    await expect(page.locator('.whiteboard')).toBeVisible();
    await drawStroke();
    await expect(strokes).toHaveCount(1);
    await assertNoOverflow('Mobile whiteboard');
    await button('Raise hand').click();
    await expect(page.locator('.self-tile .raised-hand')).not.toBeVisible();
    await expect(page.getByRole('status')).toHaveText('Your hand is raised');
    await button('Participants').click();
    await expect(page.locator('.participant-list .raised-hand')).toBeVisible();
    await assertNoOverflow('Mobile participants panel');
    await button('Close side panel').click();
    await page.screenshot({ path: `${artifactDirectory}/meeting-interactions-mobile.png`, fullPage: true });
  });

  assert.deepEqual(errors, [], 'The interaction flow must not cause uncaught browser errors');
  console.log('PASS All meeting interaction checks; no uncaught browser errors');
} catch (error) {
  console.error(`FAIL ${activeCheck || 'Meeting setup'}`);
  console.error(JSON.stringify(await page.evaluate(() => ({
    url: location.href,
    videos: [...document.querySelectorAll('video')].map(video => ({
      label: video.getAttribute('aria-label'), src: video.getAttribute('src'),
      paused: video.paused, readyState: video.readyState, currentTime: video.currentTime,
      videoWidth: video.videoWidth,
      tracks: video.srcObject instanceof MediaStream ? video.srcObject.getTracks().map(track => ({ kind: track.kind, enabled: track.enabled, readyState: track.readyState })) : [],
      mediaError: video.error?.message,
    })),
    alerts: [...document.querySelectorAll('[role="alert"]')].map(element => element.textContent),
  })).catch(() => ({ url: page.url() })), null, 2));
  await page.screenshot({ path: `${artifactDirectory}/meeting-interactions-failure.png`, fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
