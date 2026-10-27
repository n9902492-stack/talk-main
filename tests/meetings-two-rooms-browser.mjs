import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { expect } from '@playwright/test';
import { meetingHarness, connected, count, panel, stats } from './helpers/live-meeting.mjs';

// Five separate Chromium processes, the real Talk backend/gateway and local
// LiveKit SFU. Camera/microphone hardware and Google identity verification are
// fixtures. This does not verify remote physical devices, TURN or cloud hosting.
const h = await meetingHarness({ approvalRequired: true, rawAudio: true, lowResourceMedia: true });
const resultPath = 'artifacts/qa/two-room-meeting-results.json';
const evidence = { transport: 'real local LiveKit', browserProcesses: 5,
  hardware: 'generated camera/microphone fixtures', identityProvider: 'isolated Google verifier with real Talk session cookies',
  cameraFixture: '640x360 at up to 10fps to bound local laptop CPU usage',
  joinWorkflow: 'all five join with camera/microphone off, then enable real media through the in-meeting controls',
  remotePhysicalDevices: false, cloudDeployment: false };
let step = 'launch five browsers';
const pages = [];
const warnings = new Map();
const mark = label => { step = label; console.log(`CHECK: ${label}`); };
const state = async (member, roomId) => (await member.context.request.get(`${h.origin}/api/auth/meetings/${roomId}/state`)).json();
const action = (member, roomId, name, target) => h.api(member.context, name, target, {}, roomId);
async function assertRtp(page) {
  await expect.poll(async () => (await stats(page)).frames, { timeout: 30000 }).toBeGreaterThan(5);
  await expect.poll(async () => (await stats(page)).audioPackets, { timeout: 30000 }).toBeGreaterThan(5);
  await expect.poll(() => audioEnergy(page), { timeout: 30000 }).toBeGreaterThan(0);
}
async function audioEnergy(page) {
  return page.evaluate(async () => {
    let energy = 0;
    for (const peer of window.__talkTestPeers) {
      if (peer.connectionState === 'closed') continue;
      for (const report of (await peer.getStats()).values()) {
        if (report.type === 'inbound-rtp' && report.kind === 'audio') energy += report.totalAudioEnergy || 0;
      }
    }
    return energy;
  });
}
async function chat(page, message) {
  await openChat(page);
  await panel(page).getByLabel('Message everyone').fill(message);
  await panel(page).getByRole('button', { name: 'Send message' }).click();
}
async function openChat(page) {
  const button = page.getByRole('button', { name: /^Chat(?: \(\d+ unread\))?$/ });
  if (await button.getAttribute('aria-expanded') !== 'true') await button.click();
}
async function closePanel(page) {
  const close = panel(page).getByRole('button', { name: 'Close meeting panel' });
  if (await close.count()) await close.click();
}
async function requestToken(member, roomId) {
  const config = await (await member.context.request.get(`${h.origin}/api/auth/meetings/${roomId}`)).json();
  return member.context.request.post(`${h.origin}/api/auth/meetings/${roomId}/token`, {
    headers: { Origin: h.origin, 'X-CSRF-Token': config.csrfToken }, data: { displayName: 'Cross-room authorization probe' },
  });
}
async function diagnostics(page) {
  return page.evaluate(() => ({
    state: document.querySelector('.live-meeting')?.dataset.connectionState,
    peers: window.__talkTestPeers.map(peer => ({ connection: peer.connectionState, ice: peer.iceConnectionState, signaling: peer.signalingState })),
    sockets: window.__talkTestSockets.map(socket => socket.readyState),
  }));
}
async function connectAdmitted(members) {
  const outcomes = await Promise.allSettled(members.map(member => connected(member.page)));
  for (const [index, outcome] of outcomes.entries()) {
    if (outcome.status === 'fulfilled') continue;
    const page = members[index].page;
    const diagnostic = await diagnostics(page);
    evidence.initialConnectionFailures ||= [];
    evidence.initialConnectionFailures.push({ user: index + 1, ...diagnostic, warningCategories: [...(warnings.get(page) || [])] });
    console.log(`RECOVERY: user ${index + 1} has state ${diagnostic.state}; trying the existing Rejoin button once.`);
    const rejoin = page.getByRole('button', { name: 'Rejoin meeting', exact: true });
    if (diagnostic.state !== 'error' || !await rejoin.isVisible()) throw outcome.reason;
    await rejoin.click(); await connected(page);
  }
}
await fs.writeFile(resultPath, JSON.stringify({ passed: false, status: 'running', ...evidence }));
try {
  const members = [];
  // Sequential launches keep browser setup deterministic on a small laptop;
  // every participant remains connected simultaneously for the checks below.
  for (let index = 1; index <= 5; index++) {
    const member = await h.member(`TeamUser${index}`, 350 + index * 110);
    members.push(member); pages.push(member.page);
    warnings.set(member.page, new Set());
    member.page.on('console', message => {
      if (!['warning', 'error'].includes(message.type())) return;
      const text = message.text().toLowerCase();
      const category = text.includes('timeout') || text.includes('timed out') ? 'timeout'
        : text.includes('websocket') ? 'websocket'
          : text.includes('ice') ? 'ice'
            : text.includes('connection') ? 'connection'
              : text.includes('permission') || text.includes('denied') ? 'permission' : 'other';
      warnings.get(member.page).add(category); // Never retain raw SDK messages.
    });
  }
  const [u1, u2, u3, u4, u5] = members;
  const roomA = await h.createMeeting(u1.context, 'Team test A', true);
  const roomB = await h.createMeeting(u4.context, 'Team test B', true);
  assert.notEqual(roomA.id, roomB.id);
  assert.notEqual(h.roomName(roomA.id), h.roomName(roomB.id));
  mark('two authenticated owners join independent meetings');
  await h.join(u1.page, 'User 1', false, roomA.id);
  await h.join(u4.page, 'User 4', false, roomB.id);
  assert.equal((await state(u1, roomA.id)).role, 'host');
  assert.equal((await state(u4, roomB.id)).role, 'host');
  mark('waiting participants receive no room media or information');
  for (const [member, name, room] of [[u2, 'User 2', roomA], [u3, 'User 3', roomA], [u5, 'User 5', roomB]]) {
    await h.join(member.page, name, false, room.id, false);
    await expect(member.page.getByRole('heading', { name: 'Waiting for host to let you in.' })).toBeVisible({ timeout: 20000 });
    assert.equal(await member.page.locator('.live-meeting-canvas, audio[data-audio-source]').count(), 0);
    assert.equal(await member.page.evaluate(() => window.__talkTestSockets.length), 0);
    const waiting = await state(member, room.id);
    assert.deepEqual(waiting.members, []); assert.deepEqual(waiting.reactions, []);
    console.log(`CHECK: ${name} waits without a LiveKit socket or private room information.`);
  }
  assert.equal((await action(u1, roomA.id, 'admit_all')).status(), 200);
  assert.equal((await action(u4, roomB.id, 'admit_all')).status(), 200);
  mark('admitted participants connect with at most one explicit recovery');
  await connectAdmitted(members);
  for (const member of [u1, u2, u3]) await count(member.page, 3);
  for (const member of [u4, u5]) await count(member.page, 2);
  mark('five camera-off participants occupy exactly two real SFU rooms');
  const participantsA = await h.service.listParticipants(h.roomName(roomA.id));
  const participantsB = await h.service.listParticipants(h.roomName(roomB.id));
  assert.equal(participantsA.length, 3); assert.equal(participantsB.length, 2);
  assert.equal(new Set([...participantsA, ...participantsB].map(participant => participant.identity)).size, 5);
  assert.deepEqual(participantsA.map(participant => participant.name).sort(), ['User 1', 'User 2', 'User 3']);
  assert.deepEqual(participantsB.map(participant => participant.name).sort(), ['User 4', 'User 5']);
  evidence.simultaneousSfuParticipants = { meetingA: participantsA.length, meetingB: participantsB.length };
  mark('enable each microphone and camera through the existing meeting controls');
  for (const [index, member] of members.entries()) {
    await member.page.getByRole('button', { name: 'Enable microphone', exact: true }).click();
    await expect(member.page.getByRole('button', { name: 'Mute microphone', exact: true })).toBeVisible({ timeout: 30000 });
    await member.page.getByRole('button', { name: 'Enable camera', exact: true }).click();
    await expect(member.page.getByRole('button', { name: 'Turn camera off', exact: true })).toBeVisible({ timeout: 30000 });
    console.log(`CHECK: user ${index + 1} enabled their own microphone and camera.`);
  }
  mark('five simultaneous participants decode real WebRTC frames and nonzero audio energy');
  await Promise.all(members.map(member => assertRtp(member.page)));
  for (const member of [u1, u2, u3]) {
    await expect(member.page.locator('.live-participant-tile')).toHaveCount(3);
    await expect(member.page.locator('audio[data-audio-source="microphone"]')).toHaveCount(2);
    await expect(member.page.locator('.live-meeting-canvas')).not.toContainText('User 4');
    await expect(member.page.locator('.live-meeting-canvas')).not.toContainText('User 5');
  }
  for (const member of [u4, u5]) {
    await expect(member.page.locator('.live-participant-tile')).toHaveCount(2);
    await expect(member.page.locator('audio[data-audio-source="microphone"]')).toHaveCount(1);
    await expect(member.page.locator('.live-meeting-canvas')).not.toContainText('User 1');
    await expect(member.page.locator('.live-meeting-canvas')).not.toContainText('User 2');
    await expect(member.page.locator('.live-meeting-canvas')).not.toContainText('User 3');
  }
  evidence.rtp = await Promise.all(members.map(async (member, index) => ({ user: index + 1, ...await stats(member.page), receivedAudioEnergy: await audioEnergy(member.page) })));
  mark('cross-room tokens and host actions remain unauthorized');
  assert.deepEqual((await state(u1, roomB.id)).members, []);
  assert.equal((await action(u1, roomB.id, 'lock')).status(), 403);
  assert.equal((await action(u4, roomA.id, 'end')).status(), 403);
  const unauthorized = await requestToken(u1, roomB.id);
  assert.equal(unauthorized.status(), 202);
  const pending = await unauthorized.json();
  assert.equal(pending.joinState, 'waiting'); assert.equal(pending.token, undefined);
  const pendingOtherRoom = (await state(u4, roomB.id)).pending.find(person => person.name === 'Cross-room authorization probe');
  assert.ok(pendingOtherRoom);
  assert.equal((await action(u4, roomB.id, 'deny', pendingOtherRoom.accountId)).status(), 200);
  assert.equal((await requestToken(u1, roomB.id)).status(), 403);
  assert.equal((await action(u1, roomA.id, 'lock')).status(), 200);
  assert.equal((await requestToken(u5, roomA.id)).status(), 423);
  assert.equal((await state(u4, roomB.id)).locked, false);
  assert.equal((await action(u1, roomA.id, 'unlock')).status(), 200);
  evidence.roomAuthorization = 'cross-room token denied pending admission; host privileges and lock isolated';
  mark('real chat reaches only the intended room');
  await chat(u1.page, 'Meeting A private message');
  for (const member of [u2, u3]) {
    await openChat(member.page);
    await expect(panel(member.page).getByRole('log')).toContainText('Meeting A private message');
  }
  await chat(u4.page, 'Meeting B private message');
  await openChat(u5.page);
  await expect(panel(u5.page).getByRole('log')).toContainText('Meeting B private message');
  for (const member of [u1, u2, u3]) await expect(panel(member.page).getByRole('log')).not.toContainText('Meeting B private message');
  for (const member of [u4, u5]) await expect(panel(member.page).getByRole('log')).not.toContainText('Meeting A private message');
  await Promise.all(members.map(member => closePanel(member.page)));
  evidence.chat = 'real LiveKit data-channel messages isolated between both rooms';
  mark('native screen sharing reaches room A without leaking to room B');
  const presentation = await u1.context.newPage(); await presentation.goto(h.origin + '/test-presentation');
  await u1.page.bringToFront(); await u1.page.getByRole('button', { name: 'Share screen', exact: true }).click();
  await expect(u1.page.getByRole('button', { name: 'Stop sharing', exact: true })).toBeVisible({ timeout: 20000 });
  for (const member of [u2, u3]) {
    const screen = member.page.locator('.live-presentation-tile video');
    await expect(screen).toBeVisible({ timeout: 20000 });
    await expect.poll(() => screen.evaluate(video => {
      if (!video.videoWidth) return false;
      const canvas = document.createElement('canvas'); canvas.width = 10; canvas.height = 10;
      const context = canvas.getContext('2d'); context.drawImage(video, 0, 0, 10, 10);
      const blue = context.getImageData(1, 1, 1, 1).data, coral = context.getImageData(9, 9, 1, 1).data;
      return blue[2] > 180 && blue[0] < 60 && coral[0] > 180 && coral[2] < 100;
    }), { timeout: 20000 }).toBe(true);
  }
  assert.equal((await h.service.listParticipants(h.roomName(roomA.id))).some(person => person.tracks.some(track => track.source === 3)), true);
  assert.equal((await h.service.listParticipants(h.roomName(roomB.id))).some(person => person.tracks.some(track => track.source === 3)), false);
  for (const member of [u4, u5]) await expect(member.page.locator('.live-presentation-tile')).toHaveCount(0);
  await u1.page.getByRole('button', { name: 'Stop sharing', exact: true }).click();
  await presentation.close();
  evidence.screenShare = 'native tab capture decoded fixture pixels in both room A receivers; no screen track in room B';
  mark('signaling interruption reconnects without crossing rooms');
  await u2.page.evaluate(() => {
    window.__twoRoomStates = []; const meeting = document.querySelector('.live-meeting');
    new MutationObserver(() => window.__twoRoomStates.push(meeting.dataset.connectionState)).observe(meeting, { attributes: true, attributeFilter: ['data-connection-state'] });
    window.__talkTestSockets.filter(socket => socket.readyState === WebSocket.OPEN).forEach(socket => socket.close(4000, 'Two-room reconnect test'));
  });
  await expect.poll(() => u2.page.evaluate(() => window.__twoRoomStates.includes('reconnecting')), { timeout: 20000 }).toBe(true);
  await connected(u2.page); await count(u2.page, 3); await assertRtp(u2.page);
  assert.equal((await state(u2, roomA.id)).role, 'member');
  assert.equal((await h.service.listParticipants(h.roomName(roomA.id))).length, 3);
  assert.equal((await h.service.listParticipants(h.roomName(roomB.id))).length, 2);
  evidence.reconnection = 'real signaling closure recovered media in original room';
  mark('ending room A leaves room B connected and functional');
  assert.equal((await action(u1, roomA.id, 'end')).status(), 200);
  for (const member of [u1, u2, u3]) await expect(member.page.locator('.live-meeting')).toHaveAttribute('data-connection-state', 'ended', { timeout: 20000 });
  for (const member of [u4, u5]) { await connected(member.page); await count(member.page, 2); await assertRtp(member.page); }
  await chat(u4.page, 'Meeting B continues after Meeting A ended');
  await openChat(u5.page);
  await expect(panel(u5.page).getByRole('log')).toContainText('Meeting B continues after Meeting A ended');
  evidence.endIsolation = 'backend end-for-everyone in A preserves real WebRTC and chat in B';
  assert.deepEqual(h.errors, []);
  await fs.writeFile(resultPath, JSON.stringify({ passed: true, ...evidence }, null, 2));
  console.log('PASS: five separate Chromium processes in two real local LiveKit rooms (3+2), waiting-room privacy/admission, backend room authorization, decoded audio/video, isolated chat and native screen share, reconnect and isolated end-for-everyone. Hardware and provider identities are fixtures; remote devices, TURN and deployment remain unverified.');
} catch (failure) {
  evidence.connectionDiagnostics = await Promise.all(pages.map(async (page, index) => ({ user: index + 1, ...await diagnostics(page).catch(() => ({})), warningCategories: [...(warnings.get(page) || [])] })));
  await fs.writeFile(resultPath, JSON.stringify({ passed: false, failedAt: step, ...evidence }, null, 2));
  for (const [index, page] of pages.entries()) await page.screenshot({ path: `artifacts/qa/two-room-failure-${index + 1}.png`, timeout: 5000 }).catch(() => {});
  console.error(`FAIL two-room test at ${step}: ${String(failure.message).split('\n').slice(0, 6).join(' ')}. No credentials or tokens printed.`);
  process.exitCode = 1;
} finally { await h.close(); }
