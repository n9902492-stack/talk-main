import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const base = process.env.BASE_URL || 'http://localhost:3001';
const executablePath = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const artifactDirectory = 'artifacts/qa';
const mediaTimeout = 45000;

// The bottom-right person's bounds measured independently in decoded source
// frames. The cover may overlap the person by one source pixel at its edges.
const participantSlots = {
  12: { x: 1014 / 1280, y: 450 / 720, width: 242 / 1280, height: 145 / 720 },
  16: { x: 1014 / 1280, y: 445 / 720, width: 242 / 1280, height: 150 / 720 },
  19: { x: 1014 / 1280, y: 478 / 720, width: 242 / 1280, height: 146 / 720 },
};

await fs.mkdir(artifactDirectory, { recursive: true });
const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-gpu',
  ],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  permissions: ['camera', 'microphone'],
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));

const button = name => page.getByRole('button', { name, exact: true });
const recording = page.locator('.workshop-video');
const frame = page.locator('.session-video-frame');
const selfTile = page.locator('.embedded-self-tile');
const selfVideo = selfTile.locator('video');
let activeCheck = 'Meeting setup';
const check = async (name, run) => {
  activeCheck = name;
  console.log(`RUN  ${name}`);
  await run();
  console.log(`PASS ${name}`);
};

async function seek(time) {
  await recording.evaluate((video, target) => {
    video.pause();
    video.currentTime = target;
  }, time);
  await expect.poll(() => recording.evaluate(video => !video.seeking && video.readyState >= 2), { timeout: mediaTimeout }).toBe(true);
  await expect.poll(() => recording.evaluate((video, target) => Math.abs(video.currentTime - target), time), { timeout: mediaTimeout }).toBeLessThan(0.15);
  assert.equal(await recording.evaluate(video => video.paused), true, 'Geometry is checked on a paused, decoded recording frame');
}

async function assertEmbeddedAlignment(label) {
  const time = Math.round(await recording.evaluate(video => video.currentTime));
  const participantSlot = participantSlots[time];
  assert.ok(participantSlot, `${label}: source slot measurement is required for ${time}s`);
  await expect(selfTile).toBeVisible();
  await expect.poll(async () => {
    return page.evaluate(slot => {
      const wrapper = document.querySelector('.session-video-frame');
      const tile = document.querySelector('.embedded-self-tile');
      if (!wrapper || !tile) return false;
      const outer = wrapper.getBoundingClientRect();
      const inner = tile.getBoundingClientRect();
      const tolerance = Math.max(2, outer.width * 0.004);
      return Object.entries({
        x: inner.x - outer.x,
        y: inner.y - outer.y,
        width: inner.width,
        height: inner.height,
      }).every(([key, actual]) => Math.abs(actual - slot[key] * (key === 'y' || key === 'height' ? outer.height : outer.width)) <= tolerance);
    }, participantSlot);
  }).toBe(true);

  const geometry = await page.evaluate(() => {
    const wrapper = document.querySelector('.session-video-frame');
    const tile = document.querySelector('.embedded-self-tile');
    const video = document.querySelector('.workshop-video');
    const outer = wrapper.getBoundingClientRect();
    const inner = tile.getBoundingClientRect();
    const source = video.getBoundingClientRect();
    return {
      contained: wrapper.contains(tile),
      frame: { x: outer.x, y: outer.y, width: outer.width, height: outer.height },
      tile: { x: inner.x, y: inner.y, width: inner.width, height: inner.height },
      source: { x: source.x, y: source.y, width: source.width, height: source.height },
      normalized: {
        x: (inner.x - outer.x) / outer.width,
        y: (inner.y - outer.y) / outer.height,
        width: inner.width / outer.width,
        height: inner.height / outer.height,
      },
    };
  });
  assert.equal(geometry.contained, true, `${label}: You must be inside the uploaded video wrapper`);
  assert.ok(Math.abs(geometry.frame.width / geometry.frame.height - 16 / 9) < 0.015, `${label}: video wrapper must preserve the recording's 16:9 aspect ratio`);
  assert.ok(geometry.tile.x >= geometry.frame.x - 1 && geometry.tile.y >= geometry.frame.y - 1
    && geometry.tile.x + geometry.tile.width <= geometry.frame.x + geometry.frame.width + 1
    && geometry.tile.y + geometry.tile.height <= geometry.frame.y + geometry.frame.height + 1,
  `${label}: You must stay entirely inside the uploaded video`);
  for (const key of ['x', 'y', 'width', 'height']) {
    assert.ok(Math.abs(geometry.source[key] - geometry.frame[key]) <= 2, `${label}: recording ${key} must match its wrapper`);
  }
  assert.equal(await selfVideo.evaluate(video => video === window.__embeddedTest.selfVideo), true, `${label}: resizing and seeking must preserve the live camera element`);
  console.log(`INFO ${label}: ${JSON.stringify(geometry.normalized)}`);
  return geometry;
}

async function assertCameraFrames() {
  await expect(selfVideo).toBeVisible({ timeout: mediaTimeout });
  await expect.poll(() => selfVideo.evaluate(video => video.srcObject instanceof MediaStream
    && video.srcObject.getVideoTracks()[0]?.readyState === 'live'
    && video.srcObject.getVideoTracks()[0]?.enabled
    && video.videoWidth > 0 && video.readyState >= 2), { timeout: mediaTimeout }).toBe(true);
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

async function drawStroke() {
  const bounds = await page.locator('.drawing-layer').boundingBox();
  assert.ok(bounds, 'Whiteboard must provide a visible drawing canvas');
  const x = bounds.x + bounds.width * 0.18;
  const y = bounds.y + bounds.height * 0.72;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + bounds.width * 0.1, y - 10, { steps: 4 });
  await page.mouse.move(x + bounds.width * 0.2, y + 8, { steps: 4 });
  await page.mouse.up();
}

try {
  await page.goto(`${base}/meeting`, { waitUntil: 'domcontentloaded' });
  await page.locator('.room-stage').waitFor();
  await expect(recording).toHaveAttribute('src', '/reference/meeting-uploaded.mp4');
  await expect.poll(() => recording.evaluate(video => video.readyState >= 2 && video.videoWidth > 0 && video.duration > 19), { timeout: mediaTimeout }).toBe(true);
  assert.equal(await recording.evaluate(video => video.controls), true, 'Uploaded video keeps its native playback and seeking controls');
  await expect(frame).toHaveCount(1);
  await expect(page.locator('.self-tile')).toHaveCount(1);
  await expect(selfVideo).toHaveCount(1);
  await expect(page.locator('.stage-self-tile')).toHaveCount(0);
  await expect(page.locator('.participant-strip .self-tile')).toHaveCount(0);
  await page.evaluate(() => {
    window.__embeddedTest = {
      recording: document.querySelector('.workshop-video'),
      selfVideo: document.querySelector('.embedded-self-tile video'),
    };
  });

  await check('You is hidden during the intro and replaces the bottom-right recorded participant', async () => {
    await seek(2);
    await expect(recording).toBeVisible();
    await expect(selfTile).not.toBeVisible();
    assert.equal(await selfVideo.evaluate(video => video === window.__embeddedTest.selfVideo), true, 'Intro hiding must keep the camera element mounted');
    for (const time of [12, 16, 19]) {
      await seek(time);
      await assertEmbeddedAlignment(`Desktop ${time}s`);
    }
  });

  await check('Live camera, microphone, and raised hand remain in the embedded participant tile', async () => {
    await button('Enable camera').click();
    await assertCameraFrames();
    await button('Enable microphone').click();
    await expect.poll(() => selfVideo.evaluate(video => video.srcObject?.getAudioTracks()[0]?.readyState === 'live'), { timeout: mediaTimeout }).toBe(true);
    await assertCameraFrames();
    await button('Mute microphone').click();
    assert.equal(await selfVideo.evaluate(video => video.srcObject.getAudioTracks()[0].enabled), false, 'Mute controls the live audio track');
    await button('Enable microphone').click();
    assert.equal(await selfVideo.evaluate(video => video.srcObject.getAudioTracks()[0].enabled), true);
    await button('Turn camera off').click();
    await expect(selfVideo).not.toBeVisible();
    await expect(selfTile.locator('.self-avatar')).toBeVisible();
    assert.equal(await selfVideo.evaluate(video => video.srcObject.getVideoTracks()[0].enabled), false);
    await button('Enable camera').click();
    await assertCameraFrames();
    await seek(2);
    await expect(selfTile).not.toBeVisible();
    assert.equal(await selfVideo.evaluate(video => video === window.__embeddedTest.selfVideo
      && video.srcObject.getVideoTracks()[0].readyState === 'live'), true, 'Seeking into the intro hides the tile without replacing or stopping the camera');
    await seek(19);
    await assertCameraFrames();
    await button('Raise hand').click();
    await expect(selfTile.locator('.raised-hand')).toBeVisible();
    await expect(selfTile).toContainText('You');
    await assertEmbeddedAlignment('Desktop camera and raised hand');
    await page.evaluate(() => { window.__embeddedTest.liveStream = window.__embeddedTest.selfVideo.srcObject; });
    await page.screenshot({ path: `${artifactDirectory}/embedded-participant-desktop.png`, fullPage: true });
  });

  await check('Panel resizing preserves camera alignment and the participants hand indicator', async () => {
    const original = await frame.boundingBox();
    await button('Participants').click();
    await expect(page.locator('.participant-list .raised-hand')).toBeVisible();
    await assertEmbeddedAlignment('Desktop participants panel');
    const narrowed = await frame.boundingBox();
    assert.ok(narrowed.width < original.width, 'Desktop side panel must actually resize the video for this alignment check');
    await button('Close side panel').click();
    await assertEmbeddedAlignment('Desktop panel closed');
    await button('Chat').click();
    await assertEmbeddedAlignment('Desktop chat panel');
    await button('Close side panel').click();
  });

  await check('The custom fullscreen control keeps the live participant aligned', async () => {
    await button('Full screen stage').click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement?.classList.contains('room-stage'))).toBe(true);
    await assertEmbeddedAlignment('Desktop fullscreen');
    await assertCameraFrames();
    await expect(selfTile.locator('.raised-hand')).toBeVisible();
    await page.screenshot({ path: `${artifactDirectory}/embedded-participant-fullscreen.png`, fullPage: true });
    await page.evaluate(() => document.exitFullscreen());
    await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
    await assertEmbeddedAlignment('Desktop fullscreen exit');
  });

  await check('Whiteboard drawing and returning preserve both video and live camera', async () => {
    await seek(19);
    await button('Whiteboard').click();
    await expect(page.locator('.whiteboard')).toBeVisible();
    await expect(recording).not.toBeVisible();
    await expect(selfTile).not.toBeVisible();
    await drawStroke();
    const strokes = page.locator('.drawing-layer path');
    await expect(strokes).toHaveCount(1);
    const path = await strokes.first().getAttribute('d');
    assert.match(path, /^M.+ L.+ L.+/);
    await button('Whiteboard').click();
    await assertEmbeddedAlignment('Desktop whiteboard return');
    await assertCameraFrames();
    assert.equal(await recording.evaluate(video => video === window.__embeddedTest.recording), true, 'Whiteboard preserves the recording element');
    assert.equal(await recording.evaluate(video => video.paused), true, 'Whiteboard preserves the paused state');
    assert.ok(Math.abs(await recording.evaluate(video => video.currentTime) - 19) < 0.15, 'Whiteboard preserves the selected frame');
    assert.equal(await selfVideo.evaluate(video => video.srcObject === window.__embeddedTest.liveStream), true, 'Whiteboard preserves the live camera stream');
    await expect(selfTile.locator('.raised-hand')).toBeVisible();
    await button('Whiteboard').click();
    await expect(strokes.first()).toHaveAttribute('d', path);
    await button('Whiteboard').click();
  });

  await check('Mobile video, live face, hand badge, and panels fit and stay aligned', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await assertNoOverflow('Mobile meeting');
    for (const time of [12, 16, 19]) {
      await seek(time);
      await assertEmbeddedAlignment(`Mobile ${time}s`);
    }
    await assertCameraFrames();
    await expect(selfTile.locator('.raised-hand')).toBeVisible();
    const bounds = await frame.boundingBox();
    assert.ok(bounds.x >= -1 && bounds.x + bounds.width <= 391, 'Mobile video stays inside the viewport');
    await page.screenshot({ path: `${artifactDirectory}/embedded-participant-mobile.png`, fullPage: true });
    await button('Participants').click();
    await expect(page.locator('.participant-list .raised-hand')).toBeVisible();
    await assertEmbeddedAlignment('Mobile participants panel');
    await assertNoOverflow('Mobile participants panel');
    await button('Close side panel').click();
    await button('Whiteboard').click();
    await drawStroke();
    await expect(page.locator('.drawing-layer path')).toHaveCount(2);
    await assertNoOverflow('Mobile whiteboard');
    await button('Whiteboard').click();
    await assertEmbeddedAlignment('Mobile whiteboard return');
    await assertCameraFrames();
    assert.equal(await selfVideo.evaluate(video => video.srcObject === window.__embeddedTest.liveStream), true);
    await button('Lower hand').click();
    await expect(selfTile.locator('.raised-hand')).toHaveCount(0);
  });

  assert.deepEqual(errors, [], 'Embedded participant interactions must not cause uncaught browser errors');
  console.log('PASS All embedded participant checks; no uncaught browser errors');
} catch (error) {
  console.error(`FAIL ${activeCheck}`);
  console.error(JSON.stringify(await page.evaluate(() => ({
    url: location.href,
    videos: [...document.querySelectorAll('video')].map(video => ({
      label: video.getAttribute('aria-label'),
      src: video.getAttribute('src'),
      hidden: video.hidden,
      paused: video.paused,
      readyState: video.readyState,
      currentTime: video.currentTime,
      videoWidth: video.videoWidth,
      tracks: video.srcObject instanceof MediaStream ? video.srcObject.getTracks().map(track => ({ kind: track.kind, enabled: track.enabled, readyState: track.readyState })) : [],
      mediaError: video.error?.message,
    })),
    alerts: [...document.querySelectorAll('[role="alert"]')].map(element => element.textContent),
  })).catch(() => ({ url: page.url() })), null, 2));
  await page.screenshot({ path: `${artifactDirectory}/embedded-participant-failure.png`, fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
