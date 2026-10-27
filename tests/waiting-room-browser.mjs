import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { expect } from '@playwright/test';
import { meetingHarness, connected, count, openPanel, panel, stats } from './helpers/live-meeting.mjs';

// Genuine loopback LiveKit SFU and separate Chrome processes. Camera/microphone
// inputs and the account-provider verifier are isolated fixtures. This does not
// exercise LiveKit Cloud, real email/SMS, or devices on different networks.
const h = await meetingHarness({ approvalRequired: true, frontendBuild: process.env.TALK_TEST_FRONTEND_BUILD });
const resultPath = 'artifacts/qa/waiting-room-browser-results.json';
const evidence = {};
let step = 'launch', failHttp = false;
const pages = [];
const originalLookup = h.meetings.admin.listParticipants;
await fs.writeFile(resultPath, JSON.stringify({ passed: false, status: 'running' }));

async function state(context) {
  const response = await context.request.get(h.origin + '/api/auth/meetings/talk-workshop/state');
  assert.equal(response.status(), 200); return response.json();
}
async function assertPrivateWaiting(member) {
  const snapshot = await state(member.context);
  assert.equal(snapshot.admission, 'pending');
  for (const field of ['members', 'pending', 'reactions']) assert.deepEqual(snapshot[field], []);
  assert.equal(snapshot.token, undefined);
  assert.equal(await member.page.evaluate(() => window.__talkTestSockets.length), 0);
  assert.equal(await member.page.locator('audio[data-audio-source], .live-camera-video').count(), 0);
  assert.equal(await member.page.evaluate(() => window.__talkTestPeers.length), 0);
}

try {
  const host = await h.member('WaitingHost', 440);
  const guest = await h.member('WaitingGuest', 660);
  const denied = await h.member('WaitingDenied', 880);
  const a = host.page, b = guest.page, c = denied.page;
  pages.push(a, b, c);
  step = 'host connects to the genuine local SFU';
  await h.join(a, 'Host', true); await count(a, 1);
  await expect.poll(async () => (await state(host.context)).role).toBe('host');

  step = 'HTTP refresh failures are visible while a guest waits privately';
  failHttp = true;
  await a.route('**/api/auth/meetings/talk-workshop/state', route => failHttp
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'fixture_unavailable', message: 'Isolated controls outage' }) })
    : route.continue());
  const refreshWarning = a.getByRole('alert').filter({ hasText: 'Meeting controls could not refresh.' });
  await expect(refreshWarning).toBeVisible({ timeout: 15000 });
  await expect(a.getByRole('button', { name: 'Retry meeting controls', exact: true })).toBeVisible();
  await connected(a);
  let guestAccess;
  b.on('response', async response => {
    if (response.url().endsWith('/talk-workshop/token') && response.status() === 202) guestAccess = await response.json();
  });
  await h.join(b, 'Pending teammate', true, 'talk-workshop', false);
  await expect(b.getByRole('heading', { name: 'Waiting for host to let you in.', exact: true })).toBeVisible({ timeout: 15000 });
  await expect.poll(() => guestAccess?.joinState).toBe('waiting');
  assert.equal(guestAccess.token, undefined); assert.equal(guestAccess.serverUrl, undefined);
  await assertPrivateWaiting(guest);
  evidence.pendingPrivacy = true;
  await b.screenshot({path:'artifacts/qa/waiting-room-reference-desktop.png'});
  await b.setViewportSize({width:390,height:844});
  assert.equal(await b.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  await b.screenshot({path:'artifacts/qa/waiting-room-reference-mobile.png'});
  await b.setViewportSize({width:1440,height:1000});

  step = 'provider presence failure does not hide admission requests';
  h.meetings.admin.listParticipants = async () => { throw new Error('Isolated browser participant lookup outage'); };
  failHttp = false;
  await a.getByRole('button', { name: 'Retry meeting controls', exact: true }).click();
  await expect(refreshWarning).toHaveCount(0, { timeout: 15000 });
  await expect(a.getByText('Participant presence is temporarily unavailable.', { exact: false })).toBeVisible();
  await expect(a.locator('#live-waiting-request-notice')).toContainText('Waiting room (1)');
  await expect(a.getByLabel('1 waiting for approval', { exact: true })).toBeVisible();
  await expect(panel(a).getByRole('heading', { level: 2 })).toHaveText('Participants (1)');
  await expect(panel(a).getByRole('button', { name: 'Admit Pending teammate', exact: true })).toBeVisible();
  await expect(panel(a).getByRole('button', { name: 'Deny Pending teammate', exact: true })).toBeVisible();
  await connected(a);
  const outage = await state(host.context);
  assert.equal(outage.participantSync, 'unavailable');
  assert.equal(outage.pending.filter(person => person.admission === 'pending').length, 1);
  await a.screenshot({ path: 'artifacts/qa/waiting-room-desktop.png', fullPage: false });
  evidence.queueDuringProviderOutage = true;

  step = 'host admission automatically connects the waiting browser with real RTP';
  await panel(a).getByRole('button', { name: 'Admit Pending teammate', exact: true }).click();
  await connected(b); await count(a, 2); await count(b, 2);
  for (const page of [a, b]) {
    await expect.poll(async () => (await stats(page)).frames, { timeout: 25000 }).toBeGreaterThan(5);
    await expect.poll(async () => (await stats(page)).audioPackets, { timeout: 25000 }).toBeGreaterThan(5);
  }
  evidence.localRtp = { host: await stats(a), guest: await stats(b) };
  await expect(a.locator('#live-waiting-request-notice')).toHaveCount(0, { timeout: 10000 });

  step = 'new requests preserve an open chat and its draft';
  await openPanel(a, 'Chat');
  await panel(a).getByLabel('Message everyone').fill('Keep this draft while reviewing admission.');
  await h.join(c, 'Declined teammate', false, 'talk-workshop', false);
  await expect(c.getByRole('heading', { name: 'Waiting for host to let you in.', exact: true })).toBeVisible({ timeout: 15000 });
  await assertPrivateWaiting(denied);
  await expect(a.locator('#live-waiting-request-notice')).toContainText('Waiting room (1)', { timeout: 15000 });
  await expect(panel(a).getByRole('heading', { level: 2 })).toHaveText('In-meeting chat');
  await expect(panel(a).getByLabel('Message everyone')).toHaveValue('Keep this draft while reviewing admission.');
  await expect(a.getByLabel('1 waiting for approval', { exact: true })).toBeVisible();
  evidence.chatDraftPreserved = true;
  await a.locator('#live-waiting-request-notice').click();
  await expect(panel(a).getByRole('button', { name: 'Deny Declined teammate', exact: true })).toBeVisible();

  step = 'mobile host queue remains usable and denial is enforced';
  await a.setViewportSize({ width: 390, height: 844 });
  await expect(panel(a)).toHaveAttribute('role', 'dialog');
  await expect(panel(a).getByRole('button', { name: 'Admit Declined teammate', exact: true })).toBeVisible();
  assert.equal(await a.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
  await a.screenshot({ path: 'artifacts/qa/waiting-room-mobile.png', fullPage: false });
  await panel(a).getByRole('button', { name: 'Deny Declined teammate', exact: true }).click();
  await expect(c.locator('.live-meeting')).toHaveAttribute('data-connection-state', 'ended', { timeout: 15000 });
  await expect(c.getByText('The host did not admit your account.', { exact: false })).toBeVisible();
  const details = await (await denied.context.request.get(h.origin + '/api/auth/meetings/talk-workshop')).json();
  const retry = await denied.context.request.post(h.origin + '/api/auth/meetings/talk-workshop/token', {
    headers: { Origin: h.origin, 'X-CSRF-Token': details.csrfToken }, data: { displayName: 'Declined teammate' },
  });
  assert.equal(retry.status(), 403); assert.equal((await retry.json()).token, undefined);
  assert.equal(await c.evaluate(() => window.__talkTestSockets.length), 0);
  evidence.mobileAndDenial = true;

  step = 'presence and host badges recover without reconnecting media';
  h.meetings.admin.listParticipants = originalLookup;
  await a.setViewportSize({ width: 1440, height: 1000 });
  await expect.poll(async () => (await state(host.context)).participantSync, { timeout: 10000 }).toBe('live');
  await expect(a.getByText('Participant presence is temporarily unavailable.', { exact: false })).toHaveCount(0, { timeout: 15000 });
  const hostRow = panel(a).locator('.live-people-list > li').filter({ has: a.getByText('Host (You)', { exact: true }) });
  await expect(hostRow.locator('strong')).toHaveText('Host (You)');
  await expect(hostRow.locator('span').filter({ hasText: /^Host ·/ })).toBeVisible();
  await connected(a); await connected(b); await count(a, 2); await count(b, 2);
  assert.deepEqual(h.errors, []);
  evidence.presenceRecovered = true;
  await fs.writeFile(resultPath, JSON.stringify({ passed: true, verification: 'real local LiveKit and Chrome; synthetic account/device fixtures; no remote networks', evidence }, null, 2));
  console.log(JSON.stringify({ passed: true, localLiveKit: true, syntheticDevices: true, remoteNetworkTest: false, evidence }));
} catch (error) {
  await fs.writeFile(resultPath, JSON.stringify({ passed: false, step, error: error instanceof Error ? error.message : 'Browser check failed', evidence }, null, 2));
  for (const [index, page] of pages.entries()) await page.screenshot({ path: `artifacts/qa/waiting-room-failed-${index}.png` }).catch(() => {});
  throw error;
} finally {
  h.meetings.admin.listParticipants = originalLookup;
  await h.close();
}
