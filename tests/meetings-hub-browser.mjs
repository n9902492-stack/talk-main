import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { chromium, expect } from '@playwright/test';
import { createAuthApp } from '../backend/src/auth.mjs';
import { openAuthDatabase } from '../backend/src/database.mjs';
import { createMeetingService } from '../backend/src/meetings.mjs';
import { createRecordingStorage } from '../backend/src/recording-storage.mjs';
import { localChrome } from '../scripts/browser-options.mjs';

// Real Talk application, session cookies, database and HTTP authorization.
// Identities, meeting history, audio and transcript contents are isolated fixtures.
// LiveKit administration is a no-network fixture: this is NOT a media/SFU test.
// No environment files, SMTP, Google/Firebase services or paid resources are used.
// Only the explicit loading/503 probes intercept an API response.
const qa = path.resolve('artifacts/qa');
const directory = path.join(qa, `meetings-hub-${randomUUID()}`);
await fs.mkdir(directory, { recursive: true });
const resultPath = path.join(qa, 'meetings-hub-results.json');
const frontendBuild = path.resolve(process.env.TALK_TEST_FRONTEND_BUILD || 'frontend/dist');
const evidence = { viewports: [], screenshots: [], checks: [] };
const database = openAuthDatabase();
const storage = createRecordingStorage({ RECORDING_LOCAL_PATH: directory });
const meetings = createMeetingService({ NODE_ENV: 'development', LIVEKIT_URL: 'ws://127.0.0.1:1', LIVEKIT_API_KEY: 'hub-fixture-key', LIVEKIT_API_SECRET: 'hub-fixture-secret-never-used-for-network' });
meetings.admin = {
  listParticipants: async () => [], sendData: async () => {},
  removeParticipant: async () => {}, updateParticipant: async () => {}, deleteRoom: async () => {},
};
const app = express(), server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const auth = createAuthApp({
  clientId: 'meetings-hub-fixture.apps.googleusercontent.com', origins: [origin], database,
  verifyCredential: async credential => JSON.parse(credential), meetings,
  recordings: { configured: false, name: 'History fixture only', storage, transcriber: { configured: false } },
});
app.use(auth);
app.use(express.static(frontendBuild));
app.get('*', (_request, response) => response.sendFile(path.join(frontendBuild, 'index.html')));
let browser, page, step = 'startup';
const errors = [];
await fs.writeFile(resultPath, JSON.stringify({ passed: false, status: 'running' }));

async function account(name) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const config = await (await context.request.get(origin + '/api/auth/config')).json();
  const seconds = Math.floor(Date.now() / 1000);
  const result = await context.request.post(origin + '/api/auth/google', {
    headers: { Origin: origin, 'X-CSRF-Token': config.csrfToken },
    data: { credential: JSON.stringify({ iss: 'https://accounts.google.com', aud: config.clientId, sub: `hub-${name}`, name, email: `${name.replaceAll(' ', '').toLowerCase()}@example.test`, email_verified: true, nonce: config.nonce, iat: seconds, exp: seconds + 3600 }) },
  });
  assert.equal(result.status(), 200);
  const session = await result.json();
  assert.equal((await context.request.post(origin + '/api/auth/google/confirm', { headers: { Origin: origin, 'X-CSRF-Token': session.csrfToken }, data: {} })).status(), 200);
  const request = (route, data) => context.request[data === undefined ? 'get' : 'post'](origin + '/api/auth/' + route, data === undefined ? {} : { headers: { Origin: origin, 'X-CSRF-Token': session.csrfToken }, data });
  return { context, request, id: session.user.id };
}

async function create(owner, title, ageDays = 0, ended = false, approvalRequired = true) {
  const response = await owner.request('meetings', { title, approvalRequired });
  assert.equal(response.status(), 201);
  const { meeting } = await response.json();
  const createdAt = Date.now() - ageDays * 86400000;
  database.prepare('UPDATE talk_meetings SET created_at=?,status=?,ended_at=? WHERE id=?').run(createdAt, ended ? 'ended' : 'active', ended ? createdAt + 25 * 60000 : null, meeting.id);
  return meeting;
}

function addMember(meeting, account, role = 'member') {
  database.prepare("INSERT INTO talk_meeting_members(meeting_id,account_id,role,admission,display_name,updated_at) VALUES (?,?,?,'admitted',?,?)").run(meeting.id, account.id, role, role === 'cohost' ? 'Hub Co-host' : 'Hub Participant', Date.now());
}

function audioFixture() {
  const count = 16000 * 4, value = Buffer.alloc(44 + count * 2);
  value.write('RIFF', 0); value.writeUInt32LE(value.length - 8, 4); value.write('WAVEfmt ', 8);
  value.writeUInt32LE(16, 16); value.writeUInt16LE(1, 20); value.writeUInt16LE(1, 22);
  value.writeUInt32LE(16000, 24); value.writeUInt32LE(32000, 28); value.writeUInt16LE(2, 32); value.writeUInt16LE(16, 34);
  value.write('data', 36); value.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) value.writeInt16LE(Math.round(3000 * Math.sin(2 * Math.PI * 440 * i / 16000)), 44 + i * 2);
  return value;
}

async function recordingFixture(meeting, owner, completeTranscript = false) {
  const id = randomUUID(), output = await storage.allocate(id), bytes = audioFixture();
  await fs.writeFile(output, bytes);
  const committed = await storage.commit(id, { path: output, mimeType: 'audio/wav' });
  database.prepare("INSERT INTO talk_recordings(id,meeting_id,requested_by,mode,language,status,created_at,duration_ms,bytes,mime_type,storage_key,recorder_identity,expires_at,transcript_status,transcript_language) VALUES (?,?,?,'audio','en','completed',?,4000,?,'audio/wav',?,?,?,?,'en')").run(id, meeting.id, owner.id, Date.now() - 3600000, bytes.length, committed.key, `fixture-${id}`, Date.now() + 7 * 86400000, completeTranscript ? 'completed' : 'not_started');
  if (completeTranscript) database.prepare('INSERT INTO talk_transcript_segments(recording_id,segment_index,start_ms,end_ms,text,speaker,language) VALUES (?,0,1000,2500,?,NULL,\'en\')').run(id, 'Fixture decision: deliver the project update on Friday.');
  return id;
}

async function history(account) {
  const response = await account.request('meeting-history');
  assert.equal(response.status(), 200);
  return (await response.json()).meetings;
}

const cards = target => target.locator('.meetings-hub-card');
async function openHub(target = page) {
  await target.goto(origin + '/meeting-history', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await expect(target.getByRole('heading', { name: 'Meetings', exact: true })).toBeVisible();
  await expect(target.getByLabel('Search meetings by title or host', { exact: true })).toBeVisible();
}

async function screenshot(name) {
  const filename = path.join(qa, `meetings-hub-${name}.png`);
  await page.screenshot({ path: filename, fullPage: true, animations: 'disabled' });
  evidence.screenshots.push(filename);
}

async function geometry(name) {
  const result = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(result.document <= result.width + 1 && result.body <= result.width + 1, `${name}: horizontal layout must fit viewport`);
  evidence.viewports.push({ name, ...result });
}

async function cardColumns() {
  const boxes = await cards(page).evaluateAll(elements => elements.map(element => {
    const { x, y, bottom } = element.getBoundingClientRect();
    return { x, y, bottom };
  }));
  return { boxes, columns: new Set(boxes.map(box => Math.round(box.x / 4))).size };
}

function pass(check) { evidence.checks.push(check); console.log('PASS ' + check); }

try {
  browser = await chromium.launch({ ...localChrome(), headless: true });
  const alice = await account('Hub Alice'), bob = await account('Hub Bob'), member = await account('Hub Member'), empty = await account('Hub Empty');
  const alpha = await create(alice, 'Alpha Strategy Review', 20, true);
  const daily = await create(alice, 'Daily Delivery Standup', 1);
  const zeta = await create(alice, 'Zeta Quarterly Planning With Product, Engineering and Customer Success', 2, true);
  const shared = await create(bob, 'Project Handoff', 5);
  const privateMeeting = await create(bob, 'Private Finance Review', 3, true);
  addMember(alpha, member); addMember(zeta, bob); addMember(shared, alice, 'cohost'); addMember(privateMeeting, alice);
  const recordingId = await recordingFixture(alpha, alice, true);
  await recordingFixture(zeta, alice);
  const expectedTitles = [daily, zeta, shared, alpha].map(meeting => meeting.title);

  step = 'actual history authorization and counts';
  const rows = await history(alice);
  assert.deepEqual(rows.map(meeting => meeting.title), expectedTitles);
  assert.equal(rows.find(meeting => meeting.id === alpha.id).participantCount, 2);
  assert.equal(rows.reduce((total, meeting) => total + meeting.recordingCount, 0), 2);
  assert.equal(rows.reduce((total, meeting) => total + meeting.transcriptCount, 0), 1);
  assert.deepEqual(await history(member), []);
  assert.deepEqual(await history(empty), []);
  assert.equal((await alice.request('meeting-history/' + privateMeeting.id)).status(), 404);
  assert.equal((await member.request('recordings/' + recordingId + '/playback')).status(), 404);
  assert.equal((await alice.request('meeting-history/' + shared.id)).status(), 200);
  const outsider = await browser.newContext();
  assert.equal((await outsider.request.get(origin + '/api/auth/meeting-history')).status(), 401);
  await outsider.close();
  pass('Real history API excludes ordinary members and unauthenticated accounts; admitted co-hosts retain private access and accurate counts');

  page = await alice.context.newPage();
  page.on('pageerror', () => errors.push('pageerror'));

  step = 'Recordings navigation and saved library';
  await page.goto(origin + '/dashboard');
  const recordingsNav = page.getByRole('navigation', { name: 'Workspace navigation' }).getByRole('link', { name: 'Recordings', exact: true });
  await recordingsNav.click();
  await expect(page).toHaveURL(origin + '/recordings');
  await expect(recordingsNav).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: 'Recordings', exact: true })).toBeVisible();
  const recordingCards = page.getByRole('list', { name: 'Recorded meetings' }).getByRole('listitem');
  await expect(recordingCards).toHaveCount(2);
  await expect(page.getByRole('region', { name: 'Recording library totals' })).toContainText('Ready recordings');
  const recordingSearch = page.getByRole('searchbox', { name: 'Search recordings by meeting or host' });
  await recordingSearch.fill('Alpha'); await expect(recordingCards).toHaveCount(1);
  await recordingSearch.fill('');
  await page.getByLabel('Recording library view', { exact: true }).selectOption('all');
  await expect(recordingCards).toHaveCount(4);
  await page.getByRole('link', { name: 'Open recordings for ' + daily.title, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No recordings', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Back to recordings', exact: true }).click();
  await page.getByRole('link', { name: 'Open recordings for ' + alpha.title, exact: true }).click();
  await expect(recordingsNav).toHaveAttribute('aria-current', 'page');
  const libraryPlayer = page.getByLabel('Meeting recording', { exact: true });
  await expect(libraryPlayer).toBeVisible();
  await expect.poll(() => libraryPlayer.evaluate(element => element.readyState)).toBeGreaterThanOrEqual(1);
  await libraryPlayer.evaluate(element => element.play());
  await expect.poll(() => libraryPlayer.evaluate(element => element.currentTime)).toBeGreaterThan(.1);
  await libraryPlayer.evaluate(element => element.pause());
  await expect(page.getByRole('link', { name: 'Download recording', exact: true })).toHaveAttribute('href', `/api/auth/recordings/${recordingId}/playback?download=1`);
  await page.getByRole('link', { name: 'Back to recordings', exact: true }).click();
  await page.getByRole('link', { name: 'Read transcripts for ' + alpha.title, exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Transcript', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Search transcript', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download TXT', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download PDF', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Transcript', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('link', { name: 'Back to recordings', exact: true }).click();
  await expect(recordingCards).toHaveCount(2);
  await page.screenshot({ path: path.join(qa, 'recordings-workspace-desktop.png'), fullPage: true });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Recordings library fits mobile');
    await expect(page.getByRole('link', { name: 'Open recordings for ' + alpha.title, exact: true })).toBeVisible();
  }
  await page.screenshot({ path: path.join(qa, 'recordings-workspace-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 960 });
  const privateLibrary = await member.context.newPage();
  await privateLibrary.goto(origin + '/recordings');
  await expect(privateLibrary.getByRole('heading', { name: 'No saved recordings yet', exact: true })).toBeVisible();
  await privateLibrary.goto(origin + `/recordings?meeting=${alpha.id}`);
  await expect(privateLibrary.getByRole('alert')).toContainText('not available');
  await expect(privateLibrary.getByLabel('Meeting recording', { exact: true })).toHaveCount(0);
  await privateLibrary.close();
  pass('Recordings sidebar/library preserves real private playback, downloads, transcript shortcuts/reload, all-meeting status access and mobile layout; ordinary members cannot access host recordings');
  step = 'real API-backed hub and search';
  await openHub();
  await expect(cards(page)).toHaveCount(4);
  await expect(page.getByLabel('4 meetings in library', { exact: true })).toHaveText('4');
  await expect(page.getByLabel('2 recordings available', { exact: true })).toHaveText('2');
  await expect(page.getByLabel('1 transcripts ready', { exact: true })).toHaveText('1');
  for (const meeting of [alpha, daily, zeta, shared]) await expect(cards(page).filter({ has: page.getByRole('heading', { name: meeting.title, exact: true }) })).toHaveCount(1);
  await expect(page.getByText(privateMeeting.title, { exact: true })).toHaveCount(0);
  const viewControls = page.getByRole('group', { name: 'Meeting view', exact: true });
  const cardView = viewControls.getByRole('button', { name: 'Card view', exact: true });
  const listView = viewControls.getByRole('button', { name: 'List view', exact: true });
  await expect(cardView).toHaveAttribute('aria-pressed', 'true');
  await expect(listView).toHaveAttribute('aria-pressed', 'false');
  assert.ok((await cardColumns()).columns >= 2, 'The default 1440px card view must display at least two columns');
  const alignment=await cards(page).evaluateAll(elements=>elements.map(card=>{
    const box=card.getBoundingClientRect(),footer=card.querySelector('.meetings-hub-card-bottom').getBoundingClientRect(),title=card.querySelector('h3').getBoundingClientRect();
    return {height:box.height,footer:footer.top-box.top,title:title.top-box.top};
  }));
  for(const key of ['height','footer','title'])assert.ok(Math.max(...alignment.map(b=>b[key]))-Math.min(...alignment.map(b=>b[key]))<=1,`All four meeting cards align their ${key}, including long titles and different resources`);
  const recordingOnly=cards(page).filter({has:page.getByRole('heading',{name:zeta.title,exact:true})});
  await expect(recordingOnly.getByRole('link',{name:`Open recordings for ${zeta.title}`,exact:true})).toBeVisible();
  await expect(recordingOnly.getByRole('link',{name:`Open transcripts for ${zeta.title}`,exact:true})).toHaveCount(0);
  await expect(recordingOnly.locator('.meetings-hub-host-line')).toHaveText('Hosted by Hub Alice');
  pass('Four cards have equal heights, aligned titles/footers and accurate recording-only resource links');
  const search = page.getByLabel('Search meetings by title or host', { exact: true });
  await search.fill('  strategy  '); await expect(cards(page)).toHaveCount(1); await expect(cards(page)).toContainText(alpha.title);
  await search.fill('Hub Bob'); await expect(cards(page)).toHaveCount(1); await expect(cards(page)).toContainText(shared.title);
  await search.fill('no such project'); await expect(cards(page)).toHaveCount(0);
  await expect(page.getByText('No meetings match your filters', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).first().click(); await expect(cards(page)).toHaveCount(4);
  pass('Actual meeting cards, trimmed title/host search, no-results state and filter reset');

  step = 'filters and ordering';
  await page.getByRole('button', { name: /^With recordings\b/ }).click(); await expect(cards(page)).toHaveCount(2);
  await page.getByRole('button', { name: /^With transcripts\b/ }).click(); await expect(cards(page)).toHaveCount(1); await expect(cards(page)).toContainText(alpha.title);
  await page.getByRole('button', { name: /^All meetings\b/ }).click(); await expect(cards(page)).toHaveCount(4);
  await page.getByLabel('Created date', { exact: true }).selectOption('7'); await expect(cards(page)).toHaveCount(3);
  await page.getByLabel('Created date', { exact: true }).selectOption('all');
  await page.getByLabel('Host', { exact: true }).selectOption('Hub Bob'); await expect(cards(page)).toHaveCount(1); await expect(cards(page)).toContainText(shared.title);
  await page.getByLabel('Host', { exact: true }).selectOption('');
  await page.getByLabel('Sort by', { exact: true }).selectOption('title');
  assert.deepEqual(await cards(page).locator('h3').allTextContents(), [alpha.title, daily.title, shared.title, zeta.title]);
  await page.getByLabel('Sort by', { exact: true }).selectOption('oldest');
  assert.deepEqual(await cards(page).locator('h3').allTextContents(), [...expectedTitles].reverse());
  await page.getByLabel('Sort by', { exact: true }).selectOption('newest');
  pass('Recording/transcript filters, date and host selection, alphabetical and chronological ordering');

  step = 'card/list switching preserves selected filters';
  await page.getByRole('button', { name: /^With recordings\b/ }).click();
  await search.fill('Strategy'); await expect(cards(page)).toHaveCount(1);
  for (const toggle of [listView, cardView]) {
    await toggle.click(); await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(cards(page)).toHaveCount(1); await expect(cards(page)).toContainText(alpha.title);
    await expect(search).toHaveValue('Strategy');
    await expect(page.getByRole('button', { name: /^With recordings\b/ })).toHaveAttribute('aria-pressed', 'true');
  }
  await page.getByRole('button', { name: 'Clear filters', exact: true }).first().click();
  await expect(cards(page)).toHaveCount(4);
  pass('Card and list view toggles retain search and category filters');

  step = 'responsive layout and accessible navigation';
  for (const size of [{ width: 1440, height: 960 }, { width: 768, height: 1024 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
    await page.setViewportSize(size);
    for (const [mode, toggle] of [['cards', cardView], ['list', listView]]) {
      await toggle.click(); await expect(toggle).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByRole('list', { name: 'Meeting list', exact: true })).toHaveClass(mode === 'cards' ? /\bis-grid\b/ : /\bis-list\b/);
      await geometry(`${size.width}-${mode}`);
      const { boxes, columns } = await cardColumns();
      if (mode === 'cards' && size.width === 1440) assert.ok(columns >= 2, 'Desktop cards must form a multi-column grid');
      if (mode === 'list') {
        assert.equal(columns, 1, 'List rows must share one aligned column');
        assert.ok(boxes.every((box, index) => index === 0 || box.y >= boxes[index - 1].bottom - 1), 'List rows must flow vertically without overlapping');
      }
      const firstCard = cards(page).first();
      if (mode === 'cards') {
        const footerIssues = await cards(page).evaluateAll(elements => elements.flatMap(card => {
          const cardBox = card.getBoundingClientRect();
          const controls = [...card.querySelectorAll('.meetings-hub-member-count, .meetings-hub-card-primary, .meetings-hub-card-secondary-actions > a, .meetings-hub-card-secondary-actions > button')].filter(element => element.getClientRects().length);
          const issues = [];
          controls.forEach((element, index) => {
            const box = element.getBoundingClientRect();
            if (box.left < cardBox.left || box.right > cardBox.right || box.bottom > cardBox.bottom) issues.push('Footer control outside card');
            for (const other of controls.slice(index + 1)) {
              const next = other.getBoundingClientRect();
              if (Math.min(box.right, next.right) - Math.max(box.left, next.left) > 1 && Math.min(box.bottom, next.bottom) - Math.max(box.top, next.top) > 1) issues.push('Footer controls overlap');
            }
          });
          return issues;
        }));
        assert.deepEqual(footerIssues, [], `${size.width}: all card footer controls fit without overlap`);
      }
      for (const locator of [firstCard.getByRole('heading', { name: daily.title, exact: true }), firstCard.locator('.meetings-hub-host-line').filter({hasText:'Hosted by Hub Alice'}), firstCard.getByRole('link', { name: 'Join ' + daily.title, exact: true })]) {
        await locator.scrollIntoViewIfNeeded(); await expect(locator).toBeVisible();
        const legibility = await locator.evaluate(element => {
          const bounds = element.getBoundingClientRect(), style = getComputedStyle(element);
          return { width: bounds.width, height: bounds.height, fontSize: parseFloat(style.fontSize), left: bounds.left, right: bounds.right };
        });
        assert.ok(legibility.width > 0 && legibility.height > 0 && legibility.fontSize >= 12, `${size.width}-${mode}: title, host and primary action must have readable size`);
        assert.ok(legibility.left >= -1 && legibility.right <= size.width + 1, `${size.width}-${mode}: title, host and primary action must remain inside the screen`);
      }
      await screenshot(`${size.width}-${mode}`);
    }
    for (const locator of [search, page.getByRole('button', { name: 'Join meeting', exact: true }), page.getByRole('button', { name: 'New meeting', exact: true }), page.getByLabel('Sort by', { exact: true }), cards(page).first().getByRole('link', { name: /^View details for / })]) {
      await locator.scrollIntoViewIfNeeded(); await expect(locator).toBeVisible();
      assert.ok((await locator.boundingBox()).width > 0);
    }
    if (size.width === 320) {
      const joinTrigger = page.getByRole('button', { name: 'Join meeting', exact: true });
      await joinTrigger.click();
      const joinDialog = page.getByRole('dialog', { name: 'Join a meeting', exact: true });
      await expect(joinDialog).toBeVisible(); await geometry('join-dialog-320');
      await expect(joinDialog.getByLabel('Meeting link or ID', { exact: true })).toBeFocused();
      await joinDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(joinDialog).not.toBeVisible(); await expect(joinTrigger).toBeFocused();
      await page.getByRole('button', { name: 'New meeting', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Create a meeting', exact: true });
      await expect(dialog).toBeVisible(); await geometry('create-dialog-320');
      await expect(dialog.getByLabel('Meeting title', { exact: true })).toBeFocused();
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(dialog).not.toBeVisible();
    }
  }
  await cardView.click();
  await page.setViewportSize({ width: 1440, height: 960 });
  await search.focus(); await expect(search).toBeFocused();
  const navigation = page.getByRole('navigation', { name: 'Workspace navigation' });
  await expect(navigation.getByRole('link', { name: 'Meeting History', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(navigation.getByRole('link', { name: 'Overview', exact: true })).toBeVisible();
  pass('Default desktop cards form a grid, list rows align vertically, and both views fit 1440/768/390/320px with labeled controls');

  step = 'copy and prejoin destinations';
  const dailyCard = cards(page).filter({ has: page.getByRole('heading', { name: daily.title, exact: true }) });
  await expect(dailyCard.getByRole('link', { name: 'Join ' + daily.title, exact: true })).toHaveAttribute('href', '/device-test?room=' + daily.id);
  await expect(cards(page).filter({ has: page.getByRole('heading', { name: alpha.title, exact: true }) }).getByRole('link', { name: 'Join ' + alpha.title, exact: true })).toHaveCount(0);
  await page.evaluate(() => Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async () => { throw new Error('Explicit clipboard-denied fixture'); } }));
  await dailyCard.getByRole('button', { name: 'Copy link for ' + daily.title, exact: true }).click();
  const fallback = page.getByLabel('Copy the meeting link below. Access rules still apply.', { exact: true });
  await expect(fallback).toHaveValue(origin + '/device-test?room=' + daily.id);
  await fallback.focus(); await expect(fallback).toBeFocused();
  pass('Open rooms use their real pre-join URL, ended rooms have no join action, clipboard denial exposes a selectable link');

  step = 'existing private details, transcript and recording';
  await cards(page).filter({ has: page.getByRole('heading', { name: alpha.title, exact: true }) }).getByRole('link', { name: 'View details for ' + alpha.title, exact: true }).click();
  await page.waitForURL('**/meeting-history/' + alpha.id);
  await expect(page.getByRole('heading', { name: alpha.title, exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Recording', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Meeting recording', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Transcript', exact: true }).click();
  await page.getByLabel('Search transcript', { exact: true }).fill('Friday');
  await expect(page.locator('.talk-transcript-segment')).toHaveCount(1);
  await expect(page.locator('.talk-transcript-segment')).toContainText('Unattributed speaker');
  const txtResponse = await alice.request('recordings/' + recordingId + '/transcript.txt');
  assert.equal(txtResponse.status(), 200); assert.match(await txtResponse.text(), /Friday/);
  const pdfResponse = await alice.request('recordings/' + recordingId + '/transcript.pdf');
  assert.equal(pdfResponse.status(), 200); assert.equal((await pdfResponse.body()).subarray(0, 4).toString(), '%PDF');
  await expect(page.getByRole('link', { name: 'Download TXT', exact: true })).toHaveAttribute('href', '/api/auth/recordings/' + recordingId + '/transcript.txt');
  await expect(page.getByRole('link', { name: 'Download PDF', exact: true })).toHaveAttribute('href', '/api/auth/recordings/' + recordingId + '/transcript.pdf');
  await page.locator('.talk-transcript-segment button').first().click();
  await expect(page.getByRole('tab', { name: 'Recording', exact: true })).toHaveAttribute('aria-selected', 'true');
  const player = page.getByLabel('Meeting recording', { exact: true });
  await expect.poll(() => player.evaluate(element => Number.isFinite(element.duration) && element.duration > 0)).toBe(true);
  await expect.poll(() => player.evaluate(element => element.currentTime)).toBeGreaterThanOrEqual(0.9);
  await expect(page.getByRole('link', { name: 'Download recording', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete recording & transcript', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 }); await geometry('details-390'); await screenshot('details-390');
  pass('Existing protected details retain real private playback, transcript search/seek, TXT/PDF downloads and deletion control');

  step = 'direct resource links select the requested detail tab';
  // Add the newer non-transcribed segment only after checking the original API
  // totals. This proves a Transcript deep link selects the completed transcript,
  // rather than blindly selecting the newest recording segment.
  const newerRecordingId = await recordingFixture(alpha, alice);
  database.prepare('UPDATE talk_recordings SET created_at=? WHERE id=?').run(Date.now(), newerRecordingId);
  await openHub(); await page.setViewportSize({ width: 1440, height: 960 });
  const alphaCard = cards(page).filter({ has: page.getByRole('heading', { name: alpha.title, exact: true }) });
  await expect(alphaCard.getByRole('link', { name: 'Open recordings for ' + alpha.title, exact: true })).toHaveAttribute('href', '/meeting-history/' + alpha.id + '?tab=recording');
  await expect(alphaCard.getByRole('link', { name: 'Open transcripts for ' + alpha.title, exact: true })).toHaveAttribute('href', '/meeting-history/' + alpha.id + '?tab=transcript');
  await expect(alphaCard.getByRole('link', { name: 'Play recording for ' + alpha.title, exact: true })).toHaveAttribute('href', '/meeting-history/' + alpha.id + '?tab=recording');
  await alphaCard.getByRole('link', { name: 'Open transcripts for ' + alpha.title, exact: true }).click();
  await page.waitForURL('**/meeting-history/' + alpha.id + '?tab=transcript');
  await expect(page.getByRole('tab', { name: 'Transcript', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Search transcript', { exact: true })).toBeVisible();
  await expect(page.locator('.talk-transcript-segment')).toContainText('Fixture decision: deliver the project update on Friday.');
  await expect(page.getByRole('link', { name: 'Download TXT', exact: true })).toHaveAttribute('href', '/api/auth/recordings/' + recordingId + '/transcript.txt');
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await expect(page.getByRole('tab', { name: 'Transcript', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Search transcript', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download TXT', exact: true })).toHaveAttribute('href', '/api/auth/recordings/' + recordingId + '/transcript.txt');
  await page.getByLabel('Search transcript', { exact: true }).fill('Friday');
  await expect(page.locator('.talk-transcript-segment')).toHaveCount(1);
  await openHub();
  await cards(page).filter({ has: page.getByRole('heading', { name: alpha.title, exact: true }) }).getByRole('link', { name: 'Play recording for ' + alpha.title, exact: true }).click();
  await page.waitForURL('**/meeting-history/' + alpha.id + '?tab=recording');
  await expect(page.getByRole('tab', { name: 'Recording', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Meeting recording', { exact: true })).toBeVisible();
  // Model an ended room without retained recordings in the isolated database.
  // Restore the fixture immediately afterwards; no production data is touched.
  database.prepare("UPDATE talk_recordings SET status='deleted' WHERE meeting_id=?").run(zeta.id);
  await openHub();
  const endedEmpty = cards(page).filter({ has: page.getByRole('heading', { name: zeta.title, exact: true }) });
  await expect(endedEmpty.getByRole('link', { name: 'Play recording for ' + zeta.title, exact: true })).toHaveCount(0);
  await expect(endedEmpty.getByRole('link', { name: 'View details for ' + zeta.title, exact: true })).toBeVisible();
  database.prepare("UPDATE talk_recordings SET status='completed' WHERE meeting_id=?").run(zeta.id);
  pass('Resource chips and Play recording open the correct detail tab; transcript selection survives reload and picks a completed transcript over a newer untranscribed segment');

  step = 'join by link uses the existing pre-join without creating rooms or issuing tokens';
  await openHub(); await page.setViewportSize({ width: 1440, height: 960 });
  const joinTrigger = page.getByRole('button', { name: 'Join meeting', exact: true });
  const joinDialog = page.getByRole('dialog', { name: 'Join a meeting', exact: true });
  const joinInput = joinDialog.getByLabel('Meeting link or ID', { exact: true });
  await joinTrigger.click(); await expect(joinInput).toBeFocused();
  await page.keyboard.press('Escape'); await expect(joinDialog).not.toBeVisible(); await expect(joinTrigger).toBeFocused();
  const joinWrites = [];
  const onJoinRequest = request => { if (request.method() === 'POST' && /\/api\/auth\/meetings(?:\/|$)/.test(new URL(request.url()).pathname)) joinWrites.push(request.url()); };
  page.on('request', onJoinRequest);
  await joinTrigger.click();
  await joinInput.fill(''); await joinDialog.getByRole('button', { name: 'Join meeting', exact: true }).click();
  assert.equal(await joinInput.evaluate(input => input.validity.valueMissing), true);
  await expect(joinDialog).toBeVisible();
  for (const invalid of ['not-a-meeting', `https://external.example/device-test?room=${daily.id}`, `/dashboard?room=${daily.id}`, `/device-test?room=${daily.id}&room=${shared.id}`]) {
    await joinInput.fill(invalid); await joinInput.press('Enter');
    await expect(joinDialog.getByRole('alert')).toContainText('Enter a valid Talk meeting link');
    await expect(joinInput).toHaveAttribute('aria-invalid', 'true');
    await expect(joinInput).toBeFocused();
    assert.equal(new URL(page.url()).pathname, '/meeting-history');
  }
  await joinDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(joinTrigger).toBeFocused();
  for (const value of [`${origin}/device-test?room=${daily.id}`, `${origin}/meeting?live=1&room=${daily.id}`, daily.id]) {
    await joinTrigger.click(); await joinInput.fill(value); await joinInput.press('Enter');
    await page.waitForURL(origin + '/device-test?room=' + daily.id);
    await expect(page.getByLabel('Your display name', { exact: true })).toBeVisible();
    await expect(page.locator('.prejoin-meeting-title')).toContainText(daily.title);
    assert.equal(new URL(page.url()).searchParams.has('live'), false);
    await openHub();
  }
  page.off('request', onJoinRequest);
  assert.deepEqual(joinWrites, [], 'Joining by link must not create a room or request a media token before Join Session');
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM talk_meetings').get().count, 5);
  pass('Join meeting accepts valid links and IDs, rejects unsafe input, restores keyboard focus and opens the existing pre-join without creating rooms or bypassing admission');

  step = 'new meeting form and real backend creation';
  await openHub(); await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole('button', { name: 'New meeting', exact: true }).click();
  const createDialog = page.getByRole('dialog', { name: 'Create a meeting', exact: true });
  const title = createDialog.getByLabel('Meeting title', { exact: true });
  await expect(title).toHaveAttribute('required', ''); await expect(title).toHaveAttribute('maxlength', '80');
  await expect(createDialog.getByRole('checkbox')).toBeChecked();
  await title.fill('Manager Daily Delivery');
  const createdResponse = page.waitForResponse(response => response.url() === origin + '/api/auth/meetings' && response.request().method() === 'POST');
  await createDialog.getByRole('button', { name: 'Create meeting', exact: true }).click();
  const created = await createdResponse; assert.equal(created.status(), 201);
  const createdMeeting = (await created.json()).meeting;
  await page.waitForURL('**/device-test?room=' + createdMeeting.id);
  await expect(page.getByLabel('Your display name', { exact: true })).toBeVisible();
  await expect(page.locator('.prejoin-meeting-title')).toContainText('Manager Daily Delivery');
  await expect(page.locator('.join-row h3')).toHaveText('Manager Daily Delivery');
  const stored = database.prepare('SELECT title,owner_account_id,approval_required FROM talk_meetings WHERE id=?').get(createdMeeting.id);
  assert.equal(stored.title, 'Manager Daily Delivery'); assert.equal(stored.owner_account_id, alice.id); assert.equal(stored.approval_required, 1);
  pass('New meeting form retains title limits and host approval, creates the actual owned room and opens its existing pre-join screen');

  step = 'empty account state';
  const emptyPage = await empty.context.newPage();
  await openHub(emptyPage);
  await expect(emptyPage.getByText('Your next conversation starts here', { exact: true })).toBeVisible();
  await expect(cards(emptyPage)).toHaveCount(0);
  await expect(emptyPage.getByRole('button', { name: 'New meeting', exact: true })).toBeVisible();
  await emptyPage.close();
  pass('A real account without hosted/co-hosted rooms sees the usable empty state');

  step = 'simulated loading and delivery failure, real retry recovery';
  let releaseLoading;
  const loadingGate = new Promise(resolve => { releaseLoading = resolve; });
  const historyUrl = origin + '/api/auth/meeting-history';
  const delayed = async route => { await loadingGate; await route.continue(); };
  await page.route(historyUrl, delayed);
  await page.goto(origin + '/meeting-history', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await expect(page.getByRole('status').filter({ hasText: /Loading.*meeting/i }).first()).toBeVisible();
  releaseLoading(); await expect(cards(page)).toHaveCount(5); await page.unroute(historyUrl, delayed);
  let fail = true;
  const failure = route => fail ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Temporary meeting history delivery failure.' }) }) : route.continue();
  await page.route(historyUrl, failure);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await expect(page.getByRole('alert').filter({ hasText: 'Temporary meeting history delivery failure.' })).toBeVisible();
  await expect(page.getByText('Your next conversation starts here', { exact: true })).toHaveCount(0);
  fail = false; await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(cards(page)).toHaveCount(5); await page.unroute(historyUrl, failure);
  pass('Explicitly simulated loading/503 states display honest feedback and retry recovers fresh actual API data');

  assert.deepEqual(errors, []);
  await fs.writeFile(resultPath, JSON.stringify({ passed: true, realBackendAndDatabase: true, providerAndContentFixtures: true, realLiveKitMediaTest: false, ...evidence }, null, 2));
  console.log('PASS Meetings hub regression. Real application/backend/storage; isolated identity, history and media fixtures. No external services.');
} catch (failure) {
  if (page && !page.isClosed()) await Promise.race([page.screenshot({ path: path.join(qa, 'meetings-hub-failure.png'), fullPage: true, timeout: 4000 }), new Promise(resolve => setTimeout(resolve, 5000))]).catch(() => {});
  const message = failure instanceof Error ? failure.message : 'Unknown browser failure';
  console.error('FAIL Meetings hub:', step, message.slice(0, 1400));
  await fs.writeFile(resultPath, JSON.stringify({ passed: false, step, message: message.slice(0, 1400), ...evidence }, null, 2));
  process.exitCode = 1;
} finally {
  await browser?.close();
  await auth.locals.closeAuthDatabase();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  database.close();
  if (directory.startsWith(qa + path.sep)) await fs.rm(directory, { recursive: true, force: true });
}
