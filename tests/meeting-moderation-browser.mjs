import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { WebSocket } from 'ws';
import { SignalResponse } from '@livekit/protocol';
import { expect } from '@playwright/test';
import { meetingHarness, connected, count, openPanel, panel, stats } from './helpers/live-meeting.mjs';

// Real local SFU, Talk APIs/database/gateway and separate Chrome processes.
// Hardware and account-provider verification are isolated fixtures.
const h = await meetingHarness({ approvalRequired: true });
let step = 'launch';
const evidence = {}, pages = [], refreshedTickets = [];
let bobTicket;
async function state(context) { return (await context.request.get(h.origin + '/api/auth/meetings/talk-workshop/state')).json(); }
async function requestJoin(page, name) {
  await page.goto(h.origin + '/device-test'); await page.getByLabel('Your display name').fill(name);
  await page.getByRole('button', { name: 'Enable camera & microphone', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Turn camera off', exact: true })).toBeVisible({ timeout: 15000 });
  await page.getByRole('link', { name: 'Join session', exact: true }).click();
}
async function deniedSocket(url, ticket) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url + '?access_token=' + encodeURIComponent(ticket), { origin: h.origin, handshakeTimeout: 5000 });
    socket.once('unexpected-response', (_request, response) => { const status = response.statusCode; response.resume(); socket.terminate(); resolve(status); });
    socket.once('open', () => { socket.close(); reject(new Error('A revoked ticket unexpectedly connected')); });
    socket.on('error', () => reject(new Error('Authorization probe could not complete')));
  });
}
async function manage(page, name) {
  await openPanel(page, 'Participants');
  const item = panel(page).locator('.live-people-list > li').filter({ hasText: name });
  const details = item.locator('.live-participant-actions');
  if (await details.getAttribute('open') === null) await details.locator('summary').click();
  return details;
}
await fs.writeFile('artifacts/qa/phase-three-meeting-results.json', JSON.stringify({ passed: false, status: 'running' }));
try {
  const host = await h.member('ModerationHost', 440), bob = await h.member('ModerationBob', 660);
  const a = host.page, b = bob.page; pages.push(a, b);
  b.on('response', async response => {
    if (response.url().endsWith('/talk-workshop/token') && response.status() === 200) { const value = await response.json().catch(() => null); if (value?.token) bobTicket = value.token; }
  });
  b.on('websocket', socket => {
    if (!socket.url().includes('/meeting-signal/rtc')) return;
    socket.on('framereceived', frame => {
      try { const message = typeof frame.payload === 'string' ? SignalResponse.fromJsonString(frame.payload) : SignalResponse.fromBinary(frame.payload);
        if (message.message.case === 'refreshToken') refreshedTickets.push(message.message.value); } catch { /* Other frame kinds carry no test evidence. */ }
    });
  });
  step = 'creator joins; participant waits without a LiveKit connection';
  await h.join(a, 'Host', true); await count(a, 1);
  await requestJoin(b, 'Bob');
  await expect(b.getByRole('heading', { name: 'Waiting for host to let you in.' })).toBeVisible({ timeout: 15000 });
  assert.equal(await b.locator('.live-meeting-canvas, audio[data-audio-source]').count(), 0);
  assert.equal(await b.evaluate(() => window.__talkTestSockets.length), 0);
  const waiting = await state(bob.context); assert.deepEqual(waiting.members, []); assert.deepEqual(waiting.reactions, []);
  await expect(a.getByRole('button', { name: 'Waiting room (1) — review admission requests', exact: true })).toBeVisible({ timeout: 15000 });
  await openPanel(a, 'Participants'); await panel(a).getByRole('button', { name: 'Admit Bob', exact: true }).click();
  await connected(b); await count(a, 2); await count(b, 2);
  await expect.poll(async () => (await stats(b)).frames, { timeout: 20000 }).toBeGreaterThan(5);
  await expect.poll(async () => (await stats(a)).audioPackets, { timeout: 20000 }).toBeGreaterThan(5);
  let data = await state(host.context); const bobAccount = data.members.find(person => person.name === 'Bob').accountId;
  assert.equal(data.role, 'host'); assert.equal((await state(bob.context)).role, 'member');
  assert.equal((await h.api(bob.context, 'lock')).status(), 403);
  step = 'real mute request requires the participant choice';
  let controls = await manage(a, 'Bob'); await controls.getByRole('button', { name: 'Request microphone mute', exact: true }).click();
  await expect(b.getByText('The host or a co-host asks you to mute your microphone.', { exact: true })).toBeVisible({ timeout: 10000 });
  await expect(b.getByRole('button', { name: 'Mute microphone', exact: true })).toBeVisible();
  await b.getByRole('button', { name: 'Mute my microphone', exact: true }).click();
  await expect(b.getByRole('button', { name: 'Enable microphone', exact: true })).toBeVisible();
  await b.getByRole('button', { name: 'Enable microphone', exact: true }).click();
  step = 'server-enforced microphone restriction and restoration without activation';
  await controls.getByRole('button', { name: 'Disable microphone publishing', exact: true }).click();
  await expect(b.getByRole('button', { name: 'Enable microphone', exact: true })).toBeDisabled({ timeout: 10000 });
  data = await state(bob.context);
  const bobIdentity = data.members.find(person => person.accountId === bobAccount).identity;
  // The participant UI observes the committed policy before the SFU's
  // asynchronous permission update necessarily arrives. Check the actual SFU
  // state eventually, rather than treating that propagation interval as a pass.
  await expect.poll(async () => (await h.service.getParticipant(h.roomName(), bobIdentity)).permission.canPublishSources.includes(2), { timeout: 10000 }).toBe(false);
  await expect.poll(async () => (await h.service.getParticipant(h.roomName(), bobIdentity)).tracks.some(track => track.source === 2 && !track.muted), { timeout: 10000 }).toBe(false);
  await controls.getByRole('button', { name: 'Restore microphone permission', exact: true }).click();
  await expect(b.getByRole('button', { name: 'Enable microphone', exact: true })).toBeEnabled();
  await expect(b.getByRole('button', { name: 'Mute microphone', exact: true })).toHaveCount(0);
  await b.getByRole('button', { name: 'Enable microphone', exact: true }).click();
  step = 'server-enforced camera restriction and restoration without activation';
  await controls.getByRole('button', { name: 'Disable camera & screen publishing', exact: true }).click();
  await expect(b.getByRole('button', { name: 'Enable camera', exact: true })).toBeDisabled({ timeout: 10000 });
  await expect.poll(async () => (await h.service.getParticipant(h.roomName(), bobIdentity)).permission.canPublishSources.includes(1), { timeout: 10000 }).toBe(false);
  await controls.getByRole('button', { name: 'Restore camera & screen permission', exact: true }).click();
  await expect(b.getByRole('button', { name: 'Enable camera', exact: true })).toBeEnabled();
  await expect(b.getByRole('button', { name: 'Turn camera off', exact: true })).toHaveCount(0);
  await b.getByRole('button', { name: 'Enable camera', exact: true }).click();
  step = 'raised hands and reactions synchronize through backend state and real LiveKit notifications';
  await b.getByRole('button', { name: 'Raise hand', exact: true }).click();
  await expect(panel(a).getByRole('region', { name: 'Raised hands' })).toContainText('Bob');
  await panel(a).getByRole('button', { name: "Lower Bob's hand", exact: true }).click();
  await expect(b.getByRole('button', { name: 'Raise hand', exact: true })).toBeVisible();
  await openPanel(b, 'Reactions'); await panel(b).getByRole('button', { name: 'React 🎉', exact: true }).click();
  await expect(a.getByRole('img', { name: 'Bob reacted 🎉', exact: true })).toBeVisible({ timeout: 10000 });
  await panel(b).getByRole('button', { name: 'Close meeting panel' }).click();
  step = 'co-host assignment, reconnection and revocation retain backend authority';
  await controls.getByRole('button', { name: 'Make co-host', exact: true }).click();
  await expect.poll(async () => (await state(bob.context)).role).toBe('cohost');
  const before = (await stats(b)).frames;
  await b.evaluate(() => {
    window.__moderationStates = []; const meeting = document.querySelector('.live-meeting');
    new MutationObserver(() => window.__moderationStates.push(meeting.dataset.connectionState)).observe(meeting, { attributes: true, attributeFilter: ['data-connection-state'] });
    window.__talkTestSockets.filter(socket => socket.readyState === WebSocket.OPEN).forEach(socket => socket.close(4000, 'Moderation reconnect test'));
  });
  await expect.poll(() => b.evaluate(() => window.__moderationStates.includes('reconnecting')), { timeout: 15000 }).toBe(true);
  await connected(b); await count(b, 2);
  await expect.poll(async () => (await stats(b)).frames, { timeout: 20000 }).toBeGreaterThan(before);
  assert.equal((await state(bob.context)).role, 'cohost');
  assert.equal((await h.api(bob.context, 'end')).status(), 403);
  await controls.getByRole('button', { name: 'Remove co-host role', exact: true }).click();
  assert.equal((await h.api(bob.context, 'remove', data.members.find(person => person.role === 'host')?.accountId)).status(), 403);
  step = 'meeting lock blocks new accounts; denial and explicit reauthorization';
  await openPanel(a, 'More options'); await panel(a).getByRole('button', { name: 'Lock meeting', exact: true }).click();
  const visitor = await h.member('ModerationVisitor', 880); const c = visitor.page; pages.push(c);
  await requestJoin(c, 'Visitor'); await expect(c.getByRole('alert')).toContainText('locked');
  await panel(a).getByRole('button', { name: 'Unlock meeting', exact: true }).click();
  await c.getByRole('link', { name: 'Join session', exact: true }).click();
  await expect(c.getByRole('heading', { name: 'Waiting for host to let you in.' })).toBeVisible();
  await openPanel(a, 'Participants'); await panel(a).getByRole('button', { name: 'Deny Visitor', exact: true }).click();
  await expect(c.locator('.live-meeting')).toHaveAttribute('data-connection-state', 'ended');
  const blocked = panel(a).getByText('Denied or removed accounts', { exact: true }); await blocked.click();
  await panel(a).getByRole('button', { name: 'Authorize Visitor again', exact: true }).click();
  await panel(a).getByRole('button', { name: 'Admit All', exact: true }).click();
  try { await h.join(c, 'Visitor'); }
  catch (failure) {
    // A real transport timeout is not an admission success. Exercise the
    // existing user-visible recovery once and record it explicitly; backend
    // admission and the following SFU/authorization assertions still apply.
    const connectionState = await c.locator('.live-meeting').getAttribute('data-connection-state');
    const retry = c.getByRole('button', { name: 'Rejoin meeting', exact: true });
    if (connectionState !== 'error' || !await retry.isVisible()) throw failure;
    evidence.reauthorizedJoinNeededRejoin = true;
    await retry.click(); await connected(c);
  }
  await count(a, 3);
  step = 'removed participant disconnects and both gateway and direct-SFU ticket replay fail';
  controls = await manage(a, 'Bob'); await controls.getByRole('button', { name: 'Remove participant', exact: true }).click();
  await controls.getByRole('button', { name: 'Confirm removal', exact: true }).click();
  await expect(b.locator('.live-meeting')).toHaveAttribute('data-connection-state', 'ended', { timeout: 15000 }); await count(a, 2);
  assert.ok(bobTicket && !bobTicket.includes('.'));
  assert.equal(await deniedSocket(h.origin.replace('http:', 'ws:') + '/api/auth/meeting-signal/rtc', bobTicket), 403);
  assert.ok([401, 403].includes(await deniedSocket('ws://127.0.0.1:7880/rtc', bobTicket)));
  const detail = await (await bob.context.request.get(h.origin + '/api/auth/meetings/talk-workshop')).json();
  assert.equal((await bob.context.request.post(h.origin + '/api/auth/meetings/talk-workshop/token', { headers: { Origin: h.origin, 'X-CSRF-Token': detail.csrfToken }, data: { displayName: 'Bob' } })).status(), 403);
  assert.ok(refreshedTickets.length > 0); assert.equal(refreshedTickets.every(ticket => /^[\w-]{43}$/.test(ticket)), true);
  evidence.revokedReplay = { gatewayDenied: true, directSfuDenied: true, refreshedTokensStayedOpaque: true };
  await a.screenshot({ path: 'artifacts/qa/phase-three-host-controls.png', fullPage: true });
  step = 'mobile moderation is accessible and leaving does not end the room';
  await panel(a).getByRole('button', { name: 'Close meeting panel' }).click();
  await a.setViewportSize({ width: 390, height: 844 }); await openPanel(a, 'More options');
  await expect(panel(a)).toHaveAttribute('role', 'dialog');
  assert.equal(await a.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await a.screenshot({ path: 'artifacts/qa/phase-three-mobile-controls.png', fullPage: true });
  await a.keyboard.press('Escape'); await a.getByRole('button', { name: 'Leave Meeting', exact: true }).click();
  await count(c, 1); assert.equal((await state(visitor.context)).status, 'active'); assert.equal((await state(visitor.context)).role, 'member');
  await a.setViewportSize({ width: 1440, height: 1000 }); await h.join(a, 'Host'); await count(c, 2);
  step = 'host ends for everyone; all connections close and future admissions fail';
  await openPanel(a, 'More options'); await panel(a).getByRole('button', { name: 'End meeting for everyone', exact: true }).click();
  await panel(a).getByRole('button', { name: 'Confirm end for everyone', exact: true }).click();
  for (const page of [a, c]) await expect(page.locator('.live-meeting')).toHaveAttribute('data-connection-state', 'ended', { timeout: 15000 });
  assert.equal((await state(visitor.context)).status, 'ended');
  assert.deepEqual(h.errors, []);
  await fs.writeFile('artifacts/qa/phase-three-meeting-results.json', JSON.stringify({ passed: true, transport: 'real local LiveKit and Talk signaling gateway', mediaAndAccounts: 'generated hardware and isolated provider verifier', realBackendModerationVerified: true, ...evidence }, null, 2));
  console.log('PASS Phase 3 real-browser/backend moderation: private waiting room/admission/denial, actual SFU microphone/camera restrictions, consent-only mute request, persistent co-host/reconnection/revocation, lock, raise-hand/reaction sync, account removal with gateway/direct-SFU replay rejection, opaque refresh tokens, mobile controls, leave versus end for everyone. Hardware/account-provider verification are fixtures; moderation and transport are real.');
} catch (error) {
  await fs.writeFile('artifacts/qa/phase-three-meeting-results.json', JSON.stringify({ passed: false, failedAt: step }));
  for (const page of pages) { await page.screenshot({ path: `artifacts/qa/phase-three-failure-${pages.indexOf(page)}.png`, fullPage: true }).catch(() => {}); }
  console.error(`FAIL Phase 3 at ${step}: ${error.message.split('\n').slice(0, 8).join(' ')}. Credentials and tickets withheld.`); process.exitCode = 1;
} finally { await h.close(); }
