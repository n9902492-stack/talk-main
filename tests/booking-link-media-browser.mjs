// Same restricted adapter/build as public test; disposable loopback DB + SFU.
// OTP is captured in memory only. Never connects to SMTP or LiveKit Cloud.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import dotenv from 'dotenv';
import { chromium, expect } from '@playwright/test';
import { RoomServiceClient } from 'livekit-server-sdk';
import { createMeetingService } from '../backend/src/meetings.mjs';
import { prepareBookingTest, createBookingTestApp } from '../backend/src/scheduling/booking-link-test.mjs';
import { createEmailLinks } from '../backend/src/scheduling/email-links.mjs';
import { localSfu } from './helpers/local-sfu.mjs';
import { connected, stats, openPanel, panel } from './helpers/live-meeting.mjs';
import { localChrome } from '../scripts/browser-options.mjs';

let sfu, runtime, server, browser, hostPage, guestPage, stage = 'loopback fixture';
const report = { passed: false, checks: [], realEmails: 0, realOtpRequests: 0, media: 'Actual loopback LiveKit with synthetic camera/microphone', publicCloudMediaTested: false };
const pass = check => { report.checks.push(check); console.log('PASS ' + check); };
try {
  sfu = await localSfu(); server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const emails = dotenv.parse(fs.readFileSync('.env.tunnel-test.local')).TUNNEL_TEST_EMAILS.split(',').map(value => value.trim().toLowerCase());
  assert.equal(emails.length, 5); assert.equal(emails[1], 'niknikhil.sharma22@gmail.com');
  const config = { root: process.cwd(), origin, publicMode: false, emails, links: createEmailLinks({ baseUrl: origin, secret: randomBytes(32).toString('base64url') }), frontendPath: path.resolve('artifacts/qa/booking-link-frontend') };
  const fixture = await prepareBookingTest(config), mailbox = [];
  const meetings = createMeetingService({ NODE_ENV: 'development', LIVEKIT_URL: sfu.config.url, LIVEKIT_API_KEY: sfu.config.apiKey, LIVEKIT_API_SECRET: sfu.config.apiSecret, MEETING_SIGNAL_URL: origin.replace('http:', 'ws:') + '/api/auth/meeting-signal' });
  meetings.admin = new RoomServiceClient(sfu.config.url.replace('ws:', 'http:'), sfu.config.apiKey, sfu.config.apiSecret);
  // Only this newly created disposable fixture uses a join-window test clock.
  let testNow = Date.now();
  runtime = createBookingTestApp(config, fixture, { meetings, localMockMailbox: mailbox, now: () => testNow });
  server.on('request', runtime.app); runtime.attach(server);
  const row = runtime.raw.prepare('SELECT b.*,o.starts_at,o.ends_at FROM scheduling_bookings b JOIN scheduling_occurrences o ON o.id=b.occurrence_id WHERE b.id=?').get(fixture.bookingId);
  testNow = row.starts_at - 10 * 60000;
  const invitation = config.links.inviteeUrl(row), room = runtime.raw.prepare('SELECT room_name FROM talk_meetings WHERE id=?').get(fixture.meetingId).room_name;
  assert.equal((await meetings.admin.listRooms()).length, 0);
  browser = await chromium.launch({ ...localChrome(), headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--enable-usermedia-screen-capturing', '--allow-http-screen-capture', '--auto-select-tab-capture-source-by-title=Talk synthetic E2E presentation'] });
  const errors = [];
  async function context() {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['camera', 'microphone', 'local-network-access'], reducedMotion: 'reduce' });
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await context.addInitScript(() => {
      window.__talkTestPeers = []; const Peer = window.RTCPeerConnection;
      window.RTCPeerConnection = class extends Peer { constructor(...args) { args[0] = { ...args[0], iceServers: [] }; super(...args); window.__talkTestPeers.push(this); } };
    });
    return context;
  }
  const hostContext = await context(), guestContext = await context();
  hostPage = await hostContext.newPage(); guestPage = await guestContext.newPage();
  for (const page of [hostPage, guestPage]) page.on('pageerror', () => errors.push('pageerror'));
  const guestPath = `/api/auth/scheduling/guest/meetings/${fixture.meetingId}`;
  const unauthorized = await guestContext.request.post(origin + guestPath + '/token', { headers: { Origin: origin }, data: { displayName: 'Unverified guest' } });
  assert.equal(unauthorized.status(), 401);
  stage = 'confirmation and mock guest email proof';
  await guestPage.goto(invitation);
  await expect(guestPage.getByRole('heading', { name: 'Booking confirmed', exact: true })).toBeVisible();
  await guestPage.getByRole('button', { name: 'Send email code', exact: true }).click();
  assert.equal(mailbox.length, 1); assert.equal(mailbox[0].to, 'niknikhil.sharma22@gmail.com');
  await guestPage.getByLabel('Verification code', { exact: true }).fill(mailbox[0].code);
  await guestPage.getByRole('button', { name: 'Verify and check my devices', exact: true }).click();
  await expect(guestPage.getByRole('link', { name: 'Join session', exact: true })).toBeVisible({ timeout: 20000 });
  assert.equal(new URL(guestPage.url()).searchParams.get('guest'), '1');
  pass('Compiled confirmation -> in-memory OTP -> scoped guest pre-join; unauthenticated guest token rejected');
  stage = 'synthetic host password authentication and media';
  const hostAccess = JSON.parse(fs.readFileSync(path.join(fixture.directory, 'host-access.private.json')));
  const cfg = await (await hostContext.request.get(origin + '/api/auth/config')).json();
  const login = await hostContext.request.post(origin + '/api/auth/email/login', { headers: { Origin: origin, 'X-CSRF-Token': cfg.csrfToken }, data: { email: hostAccess.email, password: hostAccess.password } });
  assert.equal(login.status(), 200);
  const hostCsrf = (await login.json()).csrfToken;
  const hostApi = (route, data) => hostContext.request[data === undefined ? 'get' : 'post'](origin + `/api/auth/meetings/${fixture.meetingId}` + route, data === undefined ? {} : { headers: { Origin: origin, 'X-CSRF-Token': hostCsrf }, data });
  async function devices(page, name) {
    await page.getByLabel('Your display name', { exact: true }).fill(name);
    await page.getByRole('button', { name: 'Enable camera & microphone', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Enable camera & microphone', exact: true })).toBeEnabled({ timeout: 30000 });
    await page.getByRole('link', { name: 'Join session', exact: true }).click();
  }
  await hostPage.goto(origin + '/device-test?room=' + fixture.meetingId);
  await devices(hostPage, 'Synthetic Host'); await connected(hostPage);
  await devices(guestPage, 'Synthetic Guest');
  await expect(guestPage.locator('.live-meeting')).toHaveAttribute('data-connection-state', 'waiting', { timeout: 20000 });
  assert.equal((await meetings.admin.listParticipants(room)).length, 1);
  stage = 'host participant panel admission';
  await openPanel(hostPage, 'Participants');
  const admit = panel(hostPage).getByRole('button', { name: 'Admit Synthetic Test Invitee', exact: true });
  await expect(admit).toBeVisible({ timeout: 15000 });
  await admit.click(); await connected(guestPage);
  await expect.poll(async () => (await meetings.admin.listParticipants(room)).length).toBe(2);
  const pending = runtime.raw.prepare('SELECT id FROM scheduling_attendees WHERE meeting_id=?').get(fixture.meetingId);
  assert.equal(runtime.raw.prepare('SELECT admission FROM scheduling_attendees WHERE id=?').get(pending.id).admission, 'admitted');
  pass('Guest waits without media access; actual host panel admits only the intended guest');
  stage = 'real received media and controls';
  for (const page of [hostPage, guestPage]) await expect.poll(async () => { const value = await stats(page); return value.frames > 0 && value.audioPackets > 0; }, { timeout: 30000 }).toBe(true);
  report.receivedMedia = { host: await stats(hostPage), guest: await stats(guestPage) };
  const guestIdentity = await guestPage.locator('.live-participant-tile[data-local="true"]').getAttribute('data-identity');
  await guestPage.getByRole('button', { name: 'Mute microphone', exact: true }).click();
  await expect.poll(async () => (await meetings.admin.getParticipant(room, guestIdentity)).tracks.find(track => track.source === 2)?.muted).toBe(true);
  await guestPage.getByRole('button', { name: 'Enable microphone', exact: true }).click();
  await expect.poll(async () => (await meetings.admin.getParticipant(room, guestIdentity)).tracks.find(track => track.source === 2)?.muted).toBe(false);
  await guestPage.getByRole('button', { name: 'Turn camera off', exact: true }).click();
  await expect(hostPage.locator(`.live-participant-tile[data-identity="${guestIdentity}"] .live-participant-placeholder`)).toBeVisible();
  await guestPage.getByRole('button', { name: 'Enable camera', exact: true }).click();
  await expect(hostPage.locator(`.live-participant-tile[data-identity="${guestIdentity}"] video`)).not.toHaveClass(/is-hidden/);
  pass('Actual received audio/video packets and frames; microphone mute/unmute and camera off/on work');
  stage = 'synthetic tab screen sharing and chat';
  const presentation = await hostContext.newPage(); await presentation.goto(origin + '/');
  await presentation.evaluate(() => { document.title = 'Talk synthetic E2E presentation'; document.body.innerHTML = '<main style="background:#1679c4;color:white;font:48px sans-serif;height:90vh">Fictional Talk screen-share test</main>'; });
  await hostPage.bringToFront(); await hostPage.getByRole('button', { name: 'Share screen', exact: true }).click();
  await expect(guestPage.locator('[data-layout="presentation"]')).toBeVisible({ timeout: 20000 });
  await hostPage.getByRole('button', { name: 'Stop sharing', exact: true }).click(); await presentation.close();
  await openPanel(hostPage, 'Chat');
  await hostPage.getByLabel('Message everyone', { exact: true }).fill('Fictional isolated booking test message');
  await hostPage.getByRole('button', { name: 'Send message', exact: true }).click(); await openPanel(guestPage, 'Chat');
  await expect(panel(guestPage).getByRole('log')).toContainText('Fictional isolated booking test message', { timeout: 15000 });
  pass('Real synthetic tab sharing and data-channel chat received by admitted guest');
  stage = 'guest reconnect, isolation and host removal';
  await guestPage.reload(); await connected(guestPage);
  assert.equal((await guestContext.request.get(origin + '/api/auth/scheduling/dashboard')).status(), 404);
  assert.equal((await guestContext.request.get(origin + '/api/auth/scheduling/guest/meetings/other/state')).status(), 404);
  const denied = await guestContext.request.post(origin + `/api/auth/meetings/${fixture.meetingId}/actions`, { headers: { Origin: origin }, data: { action: 'admit', target: pending.id } });
  assert.equal(denied.status(), 401);
  assert.equal((await hostApi('/actions', { action: 'remove', target: pending.id })).status(), 200);
  await expect(guestPage.locator('.live-meeting')).toHaveAttribute('data-connection-state', 'ended', { timeout: 20000 });
  pass('Scoped cookie reconnect succeeds; unrelated routes and guest moderation rejected; host removal terminates guest media');
  stage = 'browser error and mailbox audit';
  assert.deepEqual(errors, []); assert.equal(mailbox.length, 1);
  stage = 'cancelled outbox audit';
  assert.equal(runtime.raw.prepare("SELECT COUNT(*) n FROM scheduling_jobs WHERE status<>'cancelled'").get().n, 0);
  stage = 'disabled outbox transport audit';
  assert.equal(typeof runtime.auth.locals.scheduling.transport.send, 'undefined');
  assert.equal((await runtime.auth.locals.schedulingJobs.tick()).sent, 0);
  report.passed = true; report.mockOtpMessages = mailbox.length;
} catch { report.failedStage = stage; process.exitCode = 1; console.error('FAIL isolated booking media at ' + stage + '; private diagnostics withheld.'); }
finally {
  await browser?.close();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await runtime?.close(); await sfu?.stop();
  fs.writeFileSync('artifacts/qa/phase11-booking-link-media-results.json', JSON.stringify(report, null, 2));
}
