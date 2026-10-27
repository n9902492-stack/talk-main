import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, scryptSync, createHash } from 'node:crypto';
import { createServer, request } from 'node:http';
import { openAuthDatabase } from '../backend/src/database.mjs';
import { createMeetingService } from '../backend/src/meetings.mjs';
import { fiveUserConfiguration, prepareFiveUserDatabase, createFiveUserApp } from '../backend/src/five-user-test.mjs';

async function fixture(t, allFive = false) {
  const root = fs.mkdtempSync(path.resolve('artifacts/qa/five-public-private-'));
  fs.mkdirSync(path.join(root, 'artifacts/qa/five-user-build'), { recursive: true });
  fs.writeFileSync(path.join(root, 'artifacts/qa/five-user-build/index.html'), '<!doctype html><title>Talk five-user test</title>');
  const emails = Array.from({ length: 5 }, (_, i) => `five${i}@example.test`);
  fs.writeFileSync(path.join(root, '.env.tunnel-test.local'), `LIVEKIT_URL=wss://fixture.livekit.cloud\nLIVEKIT_API_KEY=fixture-key\nLIVEKIT_API_SECRET=${randomBytes(32).toString('base64url')}\nTUNNEL_TEST_EMAILS=${emails.join(',')}\n`);
  fs.writeFileSync(path.join(root, '.env.local'), `SCHEDULING_EMAIL_LINK_SECRET=${randomBytes(32).toString('base64url')}\nSMTP_HOST=must-not-load.invalid\nSMTP_PASSWORD=must-not-load\n`);
  const original = path.join(root, 'data/tunnel-test/talk.sqlite'), db = openAuthDatabase(original);
  const password = 'LocalFixture-Password-123', salt = randomBytes(16).toString('hex');
  const encoded = `scrypt$32768$8$1$${salt}$${scryptSync(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex')}`;
  for (let i = 0; i < 5; i++) { const email = !allFive && i === 4 ? 'outsider@example.test' : emails[i], verified = allFive || i !== 3; db.prepare('INSERT INTO accounts(id,name,email,email_verified,created_at) VALUES (?,?,?,?,?)').run('old-' + i, 'Fixture ' + i, email, verified ? 1 : 0, Date.now()); db.prepare("INSERT INTO identities(provider,provider_id,account_id,password_hash,verified_at) VALUES ('password',?,?,?,?)").run(email, 'old-' + i, encoded, verified ? Date.now() : null); }
  db.close();
  const before = fs.readFileSync(original), config = fiveUserConfiguration(root, 'https://five-local-preflight.trycloudflare.com', path.join(root, 'data/five-user-public-test/run-fixture'));
  const seeded = await prepareFiveUserDatabase(config);
  assert.deepEqual(fs.readFileSync(original), before);
  assert.equal(seeded.importedVerifiedAccounts, allFive ? 5 : 3); assert.equal(seeded.verificationRequiredAccounts, allFive ? 0 : 2);
  const service = createMeetingService({ ...config.environment, MEETING_SIGNAL_URL: config.origin.replace('https:', 'wss:') + '/api/auth/meeting-signal' });
  service.admin = { listParticipants: async () => [], sendData: async () => {}, deleteRoom: async () => {}, removeParticipant: async () => {}, updateParticipant: async () => {} };
  const runtime = createFiveUserApp(config, { meetings: service }), server = createServer(runtime.app); runtime.attach(server);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  function client() {
    const jar = new Map(); let csrf;
    return { jar, async call(route, body, extra = {}, api = true) {
      const r = await new Promise((resolve, reject) => {
        const q = request({ host: '127.0.0.1', port: server.address().port, path: (api ? '/api/auth/' : '') + route, method: body === undefined ? 'GET' : 'POST', headers: { Host: new URL(config.origin).host, 'X-Forwarded-Proto': 'https', 'CF-Connecting-IP': '192.0.2.70', Cookie: [...jar].map(([k, v]) => k + '=' + v).join('; '), ...(body === undefined ? {} : { Origin: config.origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf || '' }), ...extra } }, res => { let text = ''; res.on('data', b => text += b); res.on('end', () => { let data; try { data = JSON.parse(text); } catch {} resolve({ status: res.statusCode, data, text, headers: res.headers }); }); }); q.on('error', reject); q.end(body === undefined ? undefined : JSON.stringify(body));
      });
      for (const item of r.headers['set-cookie'] || []) { const [k, v] = item.split(';')[0].split('='); jar.set(k, v); }
      if (r.data?.csrfToken) csrf = r.data.csrfToken;
      return r;
    } };
  }
  const login = async (index) => { const c = client(); await c.call('config'); assert.equal((await c.call('email/login', { email: emails[index], password })).status, 200); return c; };
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await runtime.close(); assert.deepEqual(fs.readFileSync(original), before); assert.ok(root.startsWith(path.resolve('artifacts/qa') + path.sep)); fs.rmSync(root, { recursive: true, force: true }); });
  return { config, seeded, client, login, runtime, emails, password };
}

test('five-user runtime copies only verified allowlisted test identities, keeps mail off and rejects private routes', async t => {
  const h = await fixture(t), c = h.client();
  assert.equal((await c.call('/healthz', undefined, {}, false)).data.smtp, false);
  const cfg = await c.call('config'); assert.equal(cfg.status, 200);
  assert.ok(cfg.headers['set-cookie'].every(v => v.startsWith('fiveuser_talk_') && /; Secure/.test(v) && /; HttpOnly/.test(v) && /SameSite=Lax/.test(v)));
  assert.equal(cfg.data.configured, false); assert.equal((await c.call('email/config')).data.configured, false);
  assert.equal((await c.call('email/signup', { email: h.emails[3], name: 'Unverified', password: h.password })).status, 503);
  assert.equal((await c.call('email/signup', { email: 'outside@example.test', name: 'Outside', password: h.password })).status, 403);
  assert.equal((await c.call('email/login', { email: h.emails[3], password: h.password })).status, 401);
  for (const p of ['/sign-in', '/sign-up', '/dashboard', '/bookings', '/meetings', '/booking-confirmation', '/device-test', '/meeting']) assert.equal((await c.call(p, undefined, {}, false)).status, 200);
  for (const p of ['/analytics', '/recordings', '/whiteboards', '/.env.local', '/backend/src/auth.mjs', '/assets/x.js.map', '/api/auth/admin', '/api/auth/recordings/test', '/api/auth/whiteboards', '/api/auth/scheduling/google-calendar/callback']) assert.equal((await c.call(p, undefined, {}, false)).status, 404);
  assert.equal((await c.call('scheduling/dashboard')).status, 401);
  assert.equal((await c.call('/healthz', undefined, { Host: 'other.trycloudflare.com' }, false)).status, 403);
  assert.equal((await c.call('/healthz', undefined, { 'X-Forwarded-Proto': 'http' }, false)).status, 403);
  assert.equal((await h.runtime.auth.locals.schedulingJobs.tick()).enabled, false);
});

test('verified password login, enforced admission, CSRF, own-booking authorization and signed confirmation', async t => {
  const h = await fixture(t), host = await h.login(0), guest = await h.login(1);
  const dashboard = await host.call('scheduling/dashboard'); assert.equal(dashboard.status, 200); assert.equal(dashboard.data.bookings.length, 1);
  assert.equal((await guest.call('scheduling/dashboard')).data.bookings.length, 0);
  assert.equal((await guest.call('scheduling/host-booking/' + h.seeded.bookingId)).status, 404);
  assert.equal((await host.call('scheduling/profile', {}, { Origin: 'https://outside.example' })).status, 403);
  assert.equal((await host.call('meetings', { title: 'CSRF rejected' }, { 'X-CSRF-Token': 'wrong' })).status, 403);
  const created = await host.call('meetings', { title: 'Admission must stay required', approvalRequired: false }); assert.equal(created.status, 201);
  const id = created.data.meeting.id;
  assert.equal((await host.call('meetings/' + id + '/state')).data.approvalRequired, true);
  assert.equal((await host.call('meetings/' + id + '/actions', { action: 'approval_off' })).status, 403);
  const waiting = await guest.call('meetings/' + id + '/token', { displayName: 'Fixture Guest' }); assert.equal(waiting.status, 202); assert.equal(waiting.data.token, undefined);
  assert.equal((await guest.call('meetings/' + id + '/actions', { action: 'end' })).status, 403);
  const pending = (await host.call('meetings/' + id + '/state')).data.pending;
  assert.equal((await host.call('meetings/' + id + '/actions', { action: 'admit', target: pending[0].accountId })).status, 200);
  assert.equal((await guest.call('meetings/' + id + '/token', { displayName: 'Fixture Guest' })).status, 200);
  const privateLink = JSON.parse(fs.readFileSync(path.join(h.config.directory, 'confirmation-link.private.json'))).joiningUrl, credential = new URL(privateLink).hash.slice(1);
  const form = await host.call('scheduling/form'), headers = { 'X-Scheduling-Token': form.data.formToken }, base = 'scheduling/booking/' + h.seeded.bookingId;
  assert.equal((await host.call(base + '/detail', { credential }, headers)).status, 200);
  assert.equal((await host.call(base + '/calendar', { credential }, headers)).status, 200);
  assert.equal((await host.call(base + '/detail', { credential: randomBytes(32).toString('base64url') }, headers)).status, 404);
  assert.equal((await host.call(base + '/code', { credential }, headers)).status, 503);
  assert.equal((await host.call(base + '/redeem', { credential, code: '000000' }, headers)).status, 403);
  assert.equal((await host.call('scheduling/google-calendar')).data.configured, false);
  assert.equal((await host.call('scheduling/google-calendar/connect', {})).status, 404);
  assert.equal((await host.call('scheduling/email-deliveries')).data.enabled, false);
});

test('five-user runtime retains login limits, rejects outsider sessions and expires signed links', async t => {
  const h = await fixture(t), c = h.client(); await c.call('config');
  let last;
  for (let i = 0; i < 11; i++) last = await c.call('email/login', { email: h.emails[0], password: 'Incorrect-Fixture-Password' });
  assert.equal(last.status, 429);
  const raw = openAuthDatabase(h.config.databasePath), token = randomBytes(32).toString('base64url');
  try {
    raw.prepare('INSERT INTO accounts(id,name,email,email_verified,created_at) VALUES (?,?,?,1,?)').run('outside-test', 'Outside fixture', 'outsider@example.test', Date.now());
    raw.prepare("INSERT INTO sessions(token_hash,account_id,csrf_token,auth_method,authenticated_at,expires_at) VALUES (?,?,?,'password',?,?)").run(createHash('sha256').update(token).digest('hex'), 'outside-test', randomBytes(32).toString('base64url'), Date.now(), Date.now() + 60000);
    assert.equal((await h.client().call('session', undefined, { Cookie: 'fiveuser_talk_session=' + token })).status, 403);
    assert.equal((await h.client().call('session', undefined, { Cookie: 'talk_session=' + token })).data.user, null);
    const privateLink = JSON.parse(fs.readFileSync(path.join(h.config.directory, 'confirmation-link.private.json'))).joiningUrl;
    raw.prepare('UPDATE scheduling_occurrences SET starts_at=?,ends_at=? WHERE id=(SELECT occurrence_id FROM scheduling_bookings WHERE id=?)').run(Date.now() - 3 * 3600000, Date.now() - 2 * 3600000, h.seeded.bookingId);
    const anon = h.client(), form = await anon.call('scheduling/form');
    assert.equal((await anon.call('scheduling/booking/' + h.seeded.bookingId + '/detail', { credential: new URL(privateLink).hash.slice(1) }, { 'X-Scheduling-Token': form.data.formToken })).status, 404);
    assert.equal(raw.prepare('SELECT COUNT(*) n FROM scheduling_email_attempts').get().n, 0);
  } finally { raw.close(); }
});

test('five verified fixture accounts authenticate separately and four must be admitted before receiving opaque media tickets', async t => {
  const h = await fixture(t, true), users = [];
  for (let i = 0; i < 5; i++) users.push(await h.login(i));
  const sessions = await Promise.all(users.map(c => c.call('session')));
  assert.equal(new Set(sessions.map(r => r.data.user.id)).size, 5);
  assert.equal(new Set(users.map(c => c.jar.get('fiveuser_talk_session'))).size, 5);
  const id = h.seeded.meetingId;
  for (let i = 1; i < 5; i++) { const r = await users[i].call('meetings/' + id + '/token', { displayName: 'Guest ' + i }); assert.equal(r.status, 202); assert.equal(r.data.token, undefined); }
  const state = (await users[0].call('meetings/' + id + '/state')).data; assert.equal(state.pending.length, 4);
  const tokens = [];
  for (const member of state.pending) assert.equal((await users[0].call('meetings/' + id + '/actions', { action: 'admit', target: member.accountId })).status, 200);
  for (let i = 1; i < 5; i++) { const r = await users[i].call('meetings/' + id + '/token', { displayName: 'Guest ' + i }); assert.equal(r.status, 200); assert.match(r.data.token, /^[-\w]{43}$/); tokens.push(r.data.token); }
  assert.equal(new Set(tokens).size, 4);
  assert.equal((await users[4].call('meetings/' + id + '/actions', { action: 'end' })).status, 403);
});
