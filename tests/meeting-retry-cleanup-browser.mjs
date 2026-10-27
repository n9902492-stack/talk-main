import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {expect} from '@playwright/test';
import {meetingHarness, connected} from './helpers/live-meeting.mjs';

const h = await meetingHarness({frontendBuild: process.env.TALK_TEST_FRONTEND_BUILD, lowResourceMedia: true});
let step = 'launch';
const report = {passed: false, syntheticDevices: true};
try {
  const member = await h.member('RetryCleanup'); const page = member.page;
  await page.addInitScript(() => {
    window.__retryCaptures = [];
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await original(constraints); window.__retryCaptures.push(stream);
      // Hold a genuine browser capture response across Leave, so this regression
      // exercises late device permission/capture completion deterministically.
      if (window.__holdRetryVideo && constraints.video) {
        window.__retryCameraPending = true;
        await new Promise(resolve => { window.__releaseRetryVideo = resolve; });
      }
      return stream;
    };
  });
  const endpoint = '**/api/auth/meetings/talk-workshop/token';
  const unavailable = async route => {
    const response = await route.fetch(); const body = await response.json();
    await route.fulfill({response, json: {...body, serverUrl: 'ws://127.0.0.1:9'}});
  };
  step = 'explicit unreachable server fixture';
  await page.route(endpoint, unavailable);
  await h.join(page, 'Retry cleanup', true, 'talk-workshop', false);
  await expect(page.locator('.live-meeting')).toHaveAttribute('data-connection-state', 'error', {timeout: 35000});
  await page.unroute(endpoint, unavailable);
  step = 'retry and leave while device publication is starting';
  await page.evaluate(() => { window.__holdRetryVideo = true; });
  await page.getByRole('button', {name: 'Rejoin meeting', exact: true}).click();
  await connected(page);
  await expect.poll(() => page.evaluate(() => window.__retryCameraPending === true), {timeout: 15000}).toBe(true);
  await page.getByRole('button', {name: 'Leave Meeting', exact: true}).click();
  await page.waitForURL('**/device-test?room=talk-workshop');
  await page.evaluate(() => { window.__releaseRetryVideo(); });
  try {
    await expect.poll(() => page.evaluate(() => window.__retryCaptures.every(stream => stream.getTracks().every(track => track.readyState === 'ended'))), {timeout: 15000}).toBe(true);
    report.passed = true;
  } finally {
    report.tracks = await page.evaluate(() => window.__retryCaptures.map(stream => stream.getTracks().map(track => ({kind: track.kind, state: track.readyState}))));
  }
  assert.equal(report.passed, true);
  console.log('PASS Retry/leave cleanup with real local LiveKit and generated media.');
} catch {
  report.failedAt = step; process.exitCode = 1;
  console.error('FAIL Retry/leave cleanup: ' + JSON.stringify(report));
} finally {
  await fs.writeFile('artifacts/qa/meeting-retry-cleanup-results.json', JSON.stringify(report, null, 2));
  await h.close();
}
