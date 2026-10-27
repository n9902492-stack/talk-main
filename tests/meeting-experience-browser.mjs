import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { expect } from '@playwright/test';
import { meetingHarness, connected, count, openPanel, panel, stats } from './helpers/live-meeting.mjs';

// Genuine local SFU and two Chrome processes. Account verifier and camera/mic
// hardware are fixtures. Screen capture calls the native browser API.
const h = await meetingHarness();
let step = 'launch';
const evidence = {};
const pages = [];
await fs.writeFile('artifacts/qa/phase-two-meeting-results.json', JSON.stringify({ passed: false, status: 'running' }));
try {
  const alice = await h.member('Alice2', 440), bob = await h.member('Bob2', 660);
  const a = alice.page, b = bob.page;
  pages.push(a, b);
  step = 'real two-browser room and RTP';
  await h.join(a, 'Alice', true); await count(a, 1);
  await h.join(b, 'Bob', true); await count(a, 2); await count(b, 2);
  for (const page of [a, b]) {
    await expect.poll(async () => (await stats(page)).frames, { timeout: 20000 }).toBeGreaterThan(5);
    await expect.poll(async () => (await stats(page)).audioPackets, { timeout: 20000 }).toBeGreaterThan(5);
  }
  evidence.rtp = { alice: await stats(a), bob: await stats(b) };
  step = 'host, status, copy link and information';
  await openPanel(a, 'Participants');
  await expect(panel(a).getByRole('heading', { level: 2 })).toHaveText('Participants (2)');
  await expect(panel(a).locator('li').filter({ hasText: 'Alice' })).toContainText('Host');
  await panel(a).getByRole('button', { name: 'Copy Meeting Link', exact: true }).click();
  assert.equal(await a.evaluate(() => navigator.clipboard.readText()), h.origin + '/device-test?room=talk-workshop');
  await openPanel(a, 'Meeting information');
  await expect(panel(a)).toContainText('Social Media Marketing Workshop');
  await expect(panel(a)).toContainText('talk-workshop');
  await expect(panel(a).getByLabel('Meeting link', { exact: true })).toHaveValue(h.origin + '/device-test?room=talk-workshop');
  await panel(a).getByRole('button', { name: 'Close meeting panel' }).click();
  step = 'pin, focused speaker, active speaker and stable remote audio';
  const audio = await a.locator('audio[data-audio-source="microphone"]').elementHandle();
  await a.getByRole('button', { name: 'Pin Bob', exact: true }).click({ force: true });
  await expect(a.locator('.live-focus-stage')).toContainText('Bob');
  assert.equal(await audio.evaluate(element => element.isConnected && !!element.srcObject), true);
  await a.getByRole('button', { name: 'Unpin Bob', exact: true }).click();
  await a.getByRole('button', { name: 'Focus speaker', exact: true }).click();
  await expect(a.locator('[data-layout="speaker"]')).toBeVisible();
  await expect.poll(() => a.locator('.is-speaking').count(), { timeout: 15000 }).toBeGreaterThan(0);
  await a.getByRole('button', { name: 'Grid view', exact: true }).click();
  step = 'real LiveKit chat bidirectional, unread, empty rejection and plaintext';
  await openPanel(a, 'Chat');
  await expect(panel(a).getByRole('button', { name: 'Send message' })).toBeDisabled();
  await panel(a).getByLabel('Message everyone').fill('Hello from Alice');
  await panel(a).getByRole('button', { name: 'Send message' }).click();
  await expect(b.getByRole('button', { name: 'Chat (1 unread)', exact: true })).toBeVisible();
  await b.getByRole('button', { name: 'Chat (1 unread)', exact: true }).click();
  await expect(panel(b).getByRole('log')).toContainText('Hello from Alice');
  await expect(b.getByRole('button', { name: 'Chat', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await panel(b).getByLabel('Message everyone').fill('<img src=x onerror=alert(1)> from Bob');
  await panel(b).getByLabel('Message everyone').press('Enter');
  await expect(panel(a).getByRole('log')).toContainText('<img src=x onerror=alert(1)> from Bob');
  assert.equal(await panel(a).getByRole('log').locator('img,script').count(), 0);
  for (const text of ['Ordered one', 'Ordered two', 'Ordered three']) { await panel(a).getByLabel('Message everyone').fill(text); await panel(a).getByLabel('Message everyone').press('Enter'); }
  await expect(panel(b).getByRole('log')).toContainText('Ordered three');
  assert.deepEqual(await panel(a).locator('.live-chat-message p').allTextContents(), await panel(b).locator('.live-chat-message p').allTextContents());
  await panel(a).getByLabel('Message everyone').fill('x'.repeat(2000));
  await expect(panel(a)).toContainText('2000/2000');
  await panel(a).getByLabel('Message everyone').fill('Draft kept during reconnect');
  step = 'actual signaling interruption, draft and chat after reconnect';
  await a.evaluate(() => {
    window.__states = []; const meeting = document.querySelector('.live-meeting');
    new MutationObserver(() => window.__states.push(meeting.dataset.connectionState)).observe(meeting, { attributes: true, attributeFilter: ['data-connection-state'] });
    window.__talkTestSockets.filter(socket => socket.readyState === WebSocket.OPEN).forEach(socket => socket.close(4000, 'Phase two reconnect test'));
  });
  await expect.poll(() => a.evaluate(() => window.__states.includes('reconnecting')), { timeout: 20000 }).toBe(true);
  await connected(a); await count(a, 2);
  await expect(panel(a).getByLabel('Message everyone')).toHaveValue('Draft kept during reconnect');
  await panel(a).getByRole('button', { name: 'Send message' }).click();
  await expect(panel(b).getByRole('log')).toContainText('Draft kept during reconnect');
  await panel(a).getByRole('button', { name: 'Close meeting panel' }).click();
  await panel(b).getByRole('button', { name: 'Close meeting panel' }).click();
  step = 'actual browser tab capture and remote presentation decoding';
  const presentation = await alice.context.newPage(); await presentation.goto(h.origin + '/test-presentation');
  await a.bringToFront();
  await a.getByRole('button', { name: 'Share screen', exact: true }).click();
  await expect(a.getByRole('button', { name: 'Stop sharing', exact: true })).toBeVisible({ timeout: 20000 });
  await expect(b.locator('[data-layout="presentation"]')).toBeVisible({ timeout: 20000 });
  const display = await a.evaluate(() => {
    const track = window.__talkTestDisplays.at(-1)?.getVideoTracks()[0];
    return { surface: track?.getSettings().displaySurface, label: track?.label, live: track?.readyState === 'live' };
  });
  assert.equal(display.live, true); assert.equal(display.surface, 'browser');
  const remoteScreen = b.locator('.live-presentation-tile video');
  await expect.poll(() => remoteScreen.evaluate(video => video.videoWidth), { timeout: 20000 }).toBeGreaterThan(0);
  // Check the actual test-tab colors; generated camera frames cannot satisfy this.
  const sampleColors = () => remoteScreen.evaluate(video => {
    const canvas = document.createElement('canvas'); canvas.width = 10; canvas.height = 10; const ctx = canvas.getContext('2d'); ctx.drawImage(video, 0, 0, 10, 10);
    return [Array.from(ctx.getImageData(1, 1, 1, 1).data), Array.from(ctx.getImageData(9, 9, 1, 1).data)];
  });
  await expect.poll(async () => { const [blue, coral] = await sampleColors(); return blue[2] > 180 && blue[0] < 60 && coral[0] > 180 && coral[2] < 100; }, { timeout: 15000 }).toBe(true);
  evidence.screenShare = { nativeApi: true, surface: display.surface, remoteDecodedWidth: await remoteScreen.evaluate(video => video.videoWidth), fixturePixelsVerified: true };
  await b.screenshot({ path: 'artifacts/qa/phase-two-presentation.png', fullPage: true });
  await openPanel(b, 'Participants'); await expect(panel(b).locator('li').filter({ hasText: 'Alice' })).toContainText('Presenting');
  await panel(b).getByRole('button', { name: 'Close meeting panel' }).click();
  await a.getByRole('button', { name: 'Stop sharing', exact: true }).click();
  await expect(b.locator('[data-layout="grid"]')).toBeVisible();
  assert.equal(await a.evaluate(() => window.__talkTestDisplays.every(stream => stream.getTracks().every(track => track.readyState === 'ended'))), true);
  step = 'browser ending the captured tab stops the remote presentation';
  await a.getByRole('button', { name: 'Share screen', exact: true }).click();
  await expect(b.locator('[data-layout="presentation"]')).toBeVisible({ timeout: 20000 });
  await presentation.close();
  await expect(a.getByRole('button', { name: 'Share screen', exact: true })).toBeVisible({ timeout: 20000 });
  await expect(b.locator('[data-layout="grid"]')).toBeVisible();
  step = 'settings switch devices without enabling muted media';
  await a.getByRole('button', { name: 'Mute microphone', exact: true }).click();
  await a.getByRole('button', { name: 'Turn camera off', exact: true }).click();
  await openPanel(a, 'Settings');
  for (const kind of ['videoinput', 'audioinput', 'audiooutput']) {
    const select = a.locator(`#live-${kind}`);
    if (await select.isEnabled()) {
      const values = await select.locator('option').evaluateAll(options => options.map(option => option.value).filter(Boolean));
      if (values.length) { await select.selectOption(values.at(-1)); await expect(select).toBeEnabled(); }
    }
  }
  await expect(a.getByRole('button', { name: 'Enable microphone', exact: true })).toBeVisible();
  await expect(a.getByRole('button', { name: 'Enable camera', exact: true })).toBeVisible();
  await expect(b.locator('.live-participant-tile[data-local="false"]')).toContainText('Camera off');
  await a.getByRole('button', { name: 'Enable camera', exact: true }).click();
  await a.getByRole('button', { name: 'Enable microphone', exact: true }).click();
  await expect(b.locator('.live-participant-tile[data-local="false"] video')).toBeVisible();
  for (const kind of ['videoinput', 'audioinput']) {
    const select = a.locator(`#live-${kind}`);
    const values = await select.locator('option').evaluateAll(options => options.map(option => option.value).filter(Boolean));
    if (values.length) { await select.selectOption(values[0]); await expect(select).toBeEnabled(); }
  }
  await expect(a.getByRole('button', { name: 'Turn camera off', exact: true })).toBeVisible();
  await expect(a.getByRole('button', { name: 'Mute microphone', exact: true })).toBeVisible();
  await panel(a).getByRole('button', { name: 'Close meeting panel' }).click();
  step = 'real joining/leaving with four and nine participant grids';
  // Media transport and device switching were verified above. Keep this layout
  // check independent of decoding the same two fixture videos in nine tabs.
  for (const page of [a, b]) {
    const camera = page.getByRole('button', { name: 'Turn camera off', exact: true });
    if (await camera.count()) await camera.click();
    const microphone = page.getByRole('button', { name: 'Mute microphone', exact: true });
    if (await microphone.count()) await microphone.click();
  }
  const extra = [];
  for (let index = 3; index <= 9; index++) {
    const participant = await h.member(`Member${index}`, 440, alice.context); extra.push(participant.page); pages.push(participant.page);
    await h.join(participant.page, `Member ${index}`); await count(a, index);
    if (index === 4 || index === 9) {
      await expect(a.locator('.live-meeting-grid')).toHaveAttribute('data-participants', String(index));
      const bounds = await a.locator('.live-meeting-grid').evaluate(grid => {
        const box = grid.getBoundingClientRect(); return [...grid.children].every(tile => { const r = tile.getBoundingClientRect(); return r.width > 80 && r.height > 60 && r.right <= box.right + 1 && r.bottom <= box.bottom + 1; });
      });
      assert.equal(bounds, true);
    }
  }
  await a.setViewportSize({ width: 1366, height: 768 });
  await expect.poll(() => a.locator('.live-meeting-canvas').evaluate(canvas => Math.round(canvas.getBoundingClientRect().height))).toBeLessThan(768);
  const avatarsFit = await a.locator('.live-meeting-grid .live-participant-placeholder').evaluateAll(placeholders => placeholders.every(placeholder => {
    const tile = placeholder.closest('.live-participant-tile');
    const name = tile.querySelector('.live-participant-name').getBoundingClientRect();
    const avatar = placeholder.querySelector('.talk-avatar').getBoundingClientRect();
    const caption = placeholder.querySelector('p').getBoundingClientRect();
    return avatar.top >= tile.getBoundingClientRect().top && avatar.bottom <= name.top && caption.bottom <= name.top;
  }));
  assert.equal(avatarsFit, true, 'Nine-person camera-off avatars and captions must not overlap participant names on a laptop');
  await a.setViewportSize({ width: 1440, height: 1000 });
  await a.screenshot({ path: 'artifacts/qa/phase-two-nine-participants.png', fullPage: true });
  // New joiners do not receive earlier session-only chat.
  await openPanel(extra[0], 'Chat'); await expect(panel(extra[0]).getByRole('log')).toContainText('Start the conversation');
  await panel(extra[0]).getByRole('button', { name: 'Close meeting panel' }).click();
  for (const [index, page] of extra.entries()) {
    step = `leaving additional LiveKit connection ${index + 3}`;
    await page.bringToFront();
    const beforeLeave = await page.evaluate(() => ({ width: innerWidth, state: document.querySelector('.live-meeting')?.getAttribute('data-connection-state'), toolbarInert: Boolean(document.querySelector('.live-meeting-controls')?.closest('[inert]')), leaveButtons: document.querySelectorAll('button[aria-label="Leave Meeting"]').length }));
    evidence[`leave${index + 3}`] = beforeLeave;
    await page.getByRole('button', { name: 'Leave Meeting', exact: true }).click({ timeout: 10000 });
    await page.waitForURL('**/device-test?room=talk-workshop', { timeout: 15000 });
  }
  await count(a, 2);
  step = 'mobile/tablet geometry, accessible panels and focus restoration';
  for (const width of [768, 390, 320]) {
    await a.setViewportSize({ width, height: 844 });
    assert.equal(await a.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await openPanel(a, 'Participants'); await expect(panel(a)).toBeVisible();
    if (width < 700) { await expect(panel(a)).toHaveAttribute('role', 'dialog'); await expect(panel(a)).toHaveAttribute('aria-modal', 'true'); }
    await a.keyboard.press('Escape'); await expect(panel(a)).toHaveCount(0);
    await expect(a.getByRole('button', { name: 'Participants', exact: true })).toBeFocused();
  }
  await a.screenshot({ path: 'artifacts/qa/phase-two-mobile.png', fullPage: true });
  step = 'pin clears after departure, creator ownership persists and rejoin';
  await a.setViewportSize({ width: 1440, height: 1000 });
  await a.getByRole('button', { name: 'Pin Bob', exact: true }).click({ force: true });
  await b.getByRole('button', { name: 'Leave Meeting', exact: true }).click(); await count(a, 1);
  await expect(a.locator('[data-layout="grid"]')).toBeVisible();
  await h.join(b, 'Bob'); await count(a, 2);
  await a.getByRole('button', { name: 'Leave Meeting', exact: true }).click(); await count(b, 1);
  await openPanel(b, 'Participants'); await expect(panel(b).locator('li').filter({ hasText: 'Bob' })).not.toContainText('Host');
  step = 'server termination gives meeting-ended state and cleans up';
  const identity = await b.locator('.live-participant-tile[data-local="true"]').getAttribute('data-identity');
  await h.service.removeParticipant(h.roomName(), identity);
  await expect(b.locator('.live-meeting')).toHaveAttribute('data-connection-state', 'ended', { timeout: 15000 });
  await expect(b.getByRole('heading', { name: 'Meeting ended' })).toBeVisible();
  assert.deepEqual(h.errors, []);
  await fs.writeFile('artifacts/qa/phase-two-meeting-results.json', JSON.stringify({ passed: true, transport: 'real local LiveKit; two Chrome processes plus seven real additional connections', cameraMicrophone: 'generated fixture hardware', authentication: 'isolated verifier; real Talk session cookies', ...evidence }, null, 2));
  console.log('PASS Phase 2: real two-browser RTP, native tab screen capture with remote fixture pixels verified, real LiveKit data-channel chat, unread/plaintext/order/reconnect, host/count/link/info, pin/speaker/grid, 4/9 real connections, device switching with muted states, mobile panels/focus, leave/rejoin and server-ended state. Camera/mic and account verification are fixtures. No deployment or paid resources.');
} catch (error) {
  await fs.writeFile('artifacts/qa/phase-two-meeting-results.json', JSON.stringify({ passed: false, failedAt: step, ...evidence }));
  for (const page of pages.slice(0, 2)) {
    await page.screenshot({ path: `artifacts/qa/phase-two-failure-${pages.indexOf(page)}.png`, fullPage: false, timeout: 5000 }).catch(() => {});
    console.error(JSON.stringify(await page.evaluate(() => ({ state: document.querySelector('.live-meeting')?.dataset.connectionState, alerts: [...document.querySelectorAll('[role="alert"]')].map(element => element.textContent) })).catch(() => ({}))));
  }
  console.error(`FAIL Phase 2 at ${step}: ${error.message.split('\n').slice(0, 7).join(' ')}. No credentials or tokens printed.`); process.exitCode = 1;
} finally { await h.close(); }
