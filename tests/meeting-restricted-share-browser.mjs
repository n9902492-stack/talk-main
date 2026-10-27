import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { meetingHarness, count } from './helpers/live-meeting.mjs';

const h = await meetingHarness();
try {
  const host = await h.member('RestrictedShareHost'), member = await h.member('RestrictedShareMember');
  const a = host.page, b = member.page;
  await h.join(a, 'Host'); await h.join(b, 'Member'); await count(a, 2);
  const state = await (await host.context.request.get(h.origin + '/api/auth/meetings/talk-workshop/state')).json();
  const person = state.members.find(person => person.name === 'Member');
  assert.equal((await h.api(host.context, 'restrict_audio', person.accountId)).status(), 200);
  await expect(b.getByRole('button', { name: 'Enable microphone', exact: true })).toBeDisabled();
  await expect(b.getByRole('button', { name: 'Share screen', exact: true })).toBeEnabled();
  await b.evaluate(() => {
    const capture = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getDisplayMedia = options => { window.__requestedSharedAudio = options.audio; return capture(options); };
  });
  const target = await member.context.newPage(); await target.goto(h.origin + '/test-presentation'); await b.bringToFront();
  await b.getByRole('button', { name: 'Share screen', exact: true }).click();
  await expect(b.getByRole('button', { name: 'Stop sharing', exact: true })).toBeVisible({ timeout: 15000 });
  await expect(a.locator('[data-layout="presentation"]')).toBeVisible({ timeout: 15000 });
  await expect.poll(() => a.locator('.live-presentation-tile video').evaluate(video => video.videoWidth), { timeout: 15000 }).toBeGreaterThan(0);
  assert.equal(await b.evaluate(() => window.__requestedSharedAudio), false);
  const actual = await h.service.getParticipant(h.roomName(), person.identity);
  assert.equal(actual.permission.canPublishSources.includes(2), false); assert.equal(actual.permission.canPublishSources.includes(4), false);
  assert.ok(actual.tracks.some(track => track.source === 3)); assert.equal(actual.tracks.some(track => track.source === 4), false);
  await b.getByRole('button', { name: 'Stop sharing', exact: true }).click();
  await expect(a.locator('[data-layout="grid"]')).toBeVisible();
  assert.deepEqual(h.errors, []);
  assert.equal((await h.api(host.context, 'end')).status(), 200);
  console.log('PASS real native tab screen sharing with backend microphone/shared-audio restriction: remote video decoded, browser audio capture disabled, SFU sources/actual tracks verified. Account/hardware fixtures only; no simulated screen capture.');
} finally { await h.close(); }
