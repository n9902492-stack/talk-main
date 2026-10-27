import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { SignalResponse } from '@livekit/protocol';
import { TokenVerifier } from 'livekit-server-sdk';
import { WebSocket, WebSocketServer } from 'ws';
import { createMeetingService } from '../backend/src/meetings.mjs';
import { buildTunnelTestConfig, createTunnelTestApp, loadTunnelTestEnvironment, prepareTunnelTestDatabase } from '../backend/src/tunnel-test.mjs';

const publicOrigin = 'https://talk-preflight.trycloudflare.com';
const fixtureKey = 'talk-tunnel-isolated-key';
const fixtureSecret = 'talk-tunnel-isolated-secret-at-least-32-chars';
const allowedEmails = Array.from({ length: 5 }, (_, i) => `teammate-${i + 1}@example.test`);
const fixtureEnv = { LIVEKIT_URL: 'wss://fixture.livekit.cloud', LIVEKIT_API_KEY: fixtureKey, LIVEKIT_API_SECRET: fixtureSecret,
  TUNNEL_TEST_EMAILS: allowedEmails.join(',') };
const projectCleanup = new Map();

function disposableProject(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'talk-tunnel-test-'));
  mkdirSync(path.join(root, 'frontend/dist/assets'), { recursive: true });
  writeFileSync(path.join(root, 'frontend/dist/index.html'), '<!doctype html><title>Talk isolated fixture</title><div id="root"></div>');
  writeFileSync(path.join(root, 'frontend/dist/assets/app.js'), 'console.log("Talk fixture")');
  writeFileSync(path.join(root, '.env.local'), 'AUTH_DATABASE_PATH=data/private-production.sqlite\nSMTP_USER=private-do-not-load\n');
  writeFileSync(path.join(root, '.env.tunnel-test.local'), `LIVEKIT_URL=wss://fixture.livekit.cloud\nLIVEKIT_API_KEY=${fixtureKey}\nLIVEKIT_API_SECRET=${fixtureSecret}\n`);
  t.after(async () => { await projectCleanup.get(root)?.(); projectCleanup.delete(root); rmSync(root, { recursive: true, force: true }); });
  return root;
}

function testMeetingService(origin = publicOrigin) {
  const service = createMeetingService({ NODE_ENV: 'development', LIVEKIT_URL: 'wss://fixture.livekit.cloud',
    LIVEKIT_API_KEY: fixtureKey, LIVEKIT_API_SECRET: fixtureSecret,
    MEETING_SIGNAL_URL: origin.replace(/^http/, 'ws') + '/api/auth/meeting-signal' });
  // These tests deliberately never contact LiveKit Cloud or send real media.
  service.admin = { listParticipants: async () => [], sendData: async () => {}, removeParticipant: async () => {}, deleteRoom: async () => {} };
  return service;
}

function browser(base, origin = publicOrigin) {
  const cookies = new Map();
  let csrf = '';
  async function request(route, { method = 'GET', body, headers = {} } = {}) {
    const response = await new Promise((resolve, reject) => {
      const req = httpRequest(base + route, { method, headers: {
      Host: new URL(origin).host, ...(origin.startsWith('https:') ? { 'X-Forwarded-Proto': 'https', 'CF-Connecting-IP': '198.51.100.42' } : {}),
      Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; '),
      ...(body === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }), ...headers,
      } }, res => { let text = ''; res.setEncoding('utf8'); res.on('data', chunk => { text += chunk; });
        res.once('end', () => resolve({ status: res.statusCode, text, cookies: res.headers['set-cookie'] || [], headers: new Headers(Object.entries(res.headers).filter(([, value]) => !Array.isArray(value))) })); });
      req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
    });
    for (const cookie of response.cookies) {
      const [key, ...parts] = cookie.split(';')[0].split('=');
      if (/Max-Age=0(?:;|$)/i.test(cookie)) cookies.delete(key); else cookies.set(key, parts.join('='));
    }
    const text = response.text;
    let json; try { json = JSON.parse(text); } catch {}
    if (json?.csrfToken) csrf = json.csrfToken;
    return { status: response.status, body: json, text, headers: response.headers, cookies: response.cookies };
  }
  return { request, post: (route, body = {}, headers = {}) => request(route, { method: 'POST', body, headers }),
    csrf: () => csrf, cookies, setCsrf: value => { csrf = value; } };
}

async function websocketStatus(url, origin, host = new URL(publicOrigin).host) {
  const socket = new WebSocket(url, { origin, headers: { Host: host, 'X-Forwarded-Proto': 'https' }, handshakeTimeout: 2500 });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.terminate(); reject(new Error('WebSocket preflight did not reject promptly')); }, 3000);
    socket.once('unexpected-response', (_request, response) => { clearTimeout(timer); response.resume(); socket.terminate(); resolve(response.statusCode); });
    socket.once('open', () => { clearTimeout(timer); socket.terminate(); resolve(101); });
    socket.on('error', () => {});
  });
}

async function harness(t, { origin = publicOrigin } = {}) {
  const root = disposableProject(t);
  const privateEnvBefore = readFileSync(path.join(root, '.env.local'));
  const testEnvBefore = readFileSync(path.join(root, '.env.tunnel-test.local'));
  const config = buildTunnelTestConfig(fixtureEnv, { root, origin });
  prepareTunnelTestDatabase(config);
  const delivered = new Map();
  const meetings = testMeetingService(origin);
  const runtime = createTunnelTestApp(config, { meetings, mailer: { configured: true, sendVerification: async mail => { delivered.set(mail.to, mail.code); } } });
  const server = runtime.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  runtime.attach(server);
  const base = `http://127.0.0.1:${server.address().port}`;
  let closed = false;
  const close = async () => {
    if (closed) return; closed = true;
    await runtime.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  };
  projectCleanup.set(root, close);
  t.after(close);
  async function account(index) {
    const email = allowedEmails[index], password = randomBytes(24).toString('base64url');
    const b = browser(base, origin);
    assert.equal((await b.request('/api/auth/config')).status, 200);
    const signup = await b.post('/api/auth/email/signup', { name: `Teammate ${index + 1}`, email, password });
    assert.equal(signup.status, 202);
    assert.equal((await b.request('/api/auth/session')).body.user, null);
    assert.equal((await b.post('/api/auth/email/verify', { code: delivered.get(email) })).status, 200);
    assert.equal((await b.post('/api/auth/logout')).status, 200);
    await b.request('/api/auth/config');
    const login = await b.post('/api/auth/email/login', { email, password });
    assert.equal(login.status, 200);
    return { ...b, id: login.body.user.id, login, email, password };
  }
  return { root, config, runtime, server, base, delivered, meetings, close, account,
    privateFilesUnchanged() {
      assert.deepEqual(readFileSync(path.join(root, '.env.local')), privateEnvBefore);
      assert.deepEqual(readFileSync(path.join(root, '.env.tunnel-test.local')), testEnvBefore);
    } };
}

test('temporary configuration fixes loopback port, storage isolation and explicit Cloud credentials without consuming unrelated environment', t => {
  const root = disposableProject(t);
  const config = buildTunnelTestConfig({ ...fixtureEnv, AUTH_DATABASE_PATH: 'data/private-production.sqlite', DATABASE_URL: 'postgres://must-not-be-used',
    RECORDING_PROVIDER: 'browser', TRANSCRIPTION_PROVIDER: 'paid', NODE_ENV: 'production', FIREBASE_PROJECT_ID: 'must-not-be-used', GOOGLE_CLIENT_ID: 'must-not-be-used' }, { root });
  assert.equal(config.origin, 'http://127.0.0.1:3002');
  assert.equal(config.publicMode, false);
  assert.equal(config.secureCookies, false);
  assert.equal(config.databasePath, path.join(root, 'data/tunnel-test/talk.sqlite'));
  assert.equal(config.frontendPath, path.join(root, 'frontend/dist'));
  assert.deepEqual(config.allowedEmails, allowedEmails);
  const https = buildTunnelTestConfig(fixtureEnv, { root, origin: publicOrigin });
  assert.equal(https.secureCookies, true); assert.equal(https.publicMode, true);
  assert.deepEqual(https.origins, [publicOrigin]);
  for (const origin of ['http://0.0.0.0:3002', 'http://external.example', 'https://attacker.example', 'https://one.trycloudflare.com/path', 'https://user:pass@one.trycloudflare.com', 'https://one.trycloudflare.com/?token=x']) {
    assert.throws(() => buildTunnelTestConfig(fixtureEnv, { root, origin }));
  }
  for (const bad of [{ LIVEKIT_API_SECRET: 'short' }, { LIVEKIT_API_KEY: 'YOUR_API_KEY' }, { LIVEKIT_URL: 'ws://localhost:7880' }, { LIVEKIT_URL: 'wss://attacker.example' }]) {
    assert.throws(() => buildTunnelTestConfig({ ...fixtureEnv, ...bad }, { root }));
  }
  assert.throws(() => buildTunnelTestConfig({ ...fixtureEnv, TUNNEL_TEST_EMAILS: '' }, { root, origin: publicOrigin }));
  assert.equal(buildTunnelTestConfig({ ...fixtureEnv, TUNNEL_TEST_EMAILS: allowedEmails[0] }, { root, origin: publicOrigin }).allowedEmails.length, 1);
  assert.throws(() => buildTunnelTestConfig({ ...fixtureEnv, TUNNEL_TEST_EMAILS: [...allowedEmails, 'sixth@example.test'].join(',') }, { root, origin: publicOrigin }));
  assert.throws(() => buildTunnelTestConfig({ ...fixtureEnv, TUNNEL_TEST_EMAILS: [allowedEmails[0], allowedEmails[0]].join(',') }, { root, origin: publicOrigin }));
});

test('private environment loader selects only test LiveKit and SMTP settings without changing files or process.env', t => {
  const root = disposableProject(t);
  const privateFile = path.join(root, '.env.local'), testFile = path.join(root, '.env.tunnel-test.local');
  writeFileSync(path.join(root, '.env'), 'SMTP_HOST=smtp.fixture.test\nSMTP_PORT=587\nSMTP_USER=fallback@example.test\nSMTP_PASSWORD=fixture-password\nSMTP_FROM=fallback@example.test\nAUTH_DATABASE_PATH=do-not-import.sqlite\n');
  writeFileSync(privateFile, 'SMTP_USER=local@example.test\nFIREBASE_PROJECT_ID=must-not-import\nGOOGLE_CLIENT_ID=must-not-import\nRECORDING_PROVIDER=browser\n');
  writeFileSync(testFile, `${readFileSync(testFile, 'utf8')}TUNNEL_TEST_EMAILS=${allowedEmails[0]}\nAUTH_DATABASE_PATH=must-not-import.sqlite\nSMTP_PASSWORD=must-not-override-existing\n`);
  const before = { process: { ...process.env }, local: readFileSync(privateFile), test: readFileSync(testFile) };
  const loaded = loadTunnelTestEnvironment(root);
  assert.equal(loaded.LIVEKIT_API_KEY, fixtureKey); assert.equal(loaded.LIVEKIT_API_SECRET, fixtureSecret);
  assert.equal(loaded.SMTP_USER, 'local@example.test'); assert.equal(loaded.SMTP_PASSWORD, 'fixture-password');
  assert.equal(loaded.SMTP_HOST, 'smtp.fixture.test'); assert.equal(loaded.SMTP_PORT, '587');
  assert.equal(loaded.TUNNEL_TEST_EMAILS, allowedEmails[0]);
  for (const key of ['AUTH_DATABASE_PATH', 'FIREBASE_PROJECT_ID', 'GOOGLE_CLIENT_ID', 'RECORDING_PROVIDER']) assert.equal(loaded[key], undefined);
  assert.deepEqual({ ...process.env }, before.process); assert.deepEqual(readFileSync(privateFile), before.local); assert.deepEqual(readFileSync(testFile), before.test);
  writeFileSync(testFile, `${before.test}LIVEKIT_API_SECRET=duplicate\n`);
  assert.throws(() => loadTunnelTestEnvironment(root));
});

test('temporary database refuses an existing unmarked database and retains the private project environment', t => {
  const root = disposableProject(t);
  const config = buildTunnelTestConfig(fixtureEnv, { root });
  mkdirSync(path.dirname(config.databasePath), { recursive: true });
  writeFileSync(config.databasePath, 'unmarked database must not be migrated');
  assert.throws(() => prepareTunnelTestDatabase(config));
  assert.equal(readFileSync(config.databasePath, 'utf8'), 'unmarked database must not be migrated');
});

test('built frontend routes work, private paths and unused APIs are unavailable, and expected Host/HTTPS are enforced', async t => {
  const h = await harness(t);
  const b = browser(h.base);
  for (const route of ['/', '/sign-in', '/sign-up', '/dashboard', '/meeting', '/meeting-history/m-00000000-0000-0000-0000-000000000000']) {
    const response = await b.request(route);
    assert.equal(response.status, 200, route); assert.match(response.text, /Talk isolated fixture/);
  }
  assert.equal((await b.request('/assets/app.js')).status, 200);
  for (const route of ['/.env.local', '/.env.tunnel-test.local', '/.git/config', '/backend/src/auth.mjs', '/frontend/src/App.tsx', '/data/tunnel-test/talk.sqlite', '/@vite/client', '/node_modules/vite/package.json', '/api/admin', '/api/auth/recordings/private/playback', '/api/auth/recordings/private/transcript', '/api/auth/recordings/private/transcript.pdf', '/api/auth/meetings/private/whiteboard', '/api/auth/meetings/private/whiteboard/export/svg', '/api/auth/meetings/private/whiteboard/images/private', '/api/auth/meetings/private/whiteboard/ai/capabilities', '/api/auth/meetings/private/whiteboard/ai/jobs/private']) {
    const response = await b.request(route);
    assert.notEqual(response.status, 200, route); assert.doesNotMatch(response.text, /private-do-not-load|scrypt\$|LIVEKIT_API_SECRET/);
  }
  assert.notEqual((await b.request('/api/auth/config', { headers: { Host: 'attacker.example' } })).status, 200);
  assert.notEqual((await b.request('/api/auth/config', { headers: { 'X-Forwarded-Proto': 'http' } })).status, 200);
  assert.equal((await b.request('/api/auth/phone/config')).body.configured, false);
  assert.equal((await b.request('/api/auth/config')).body.whiteboardConfigured, false);
  for (const route of ['/api/auth/phone/start', '/api/auth/phone/verify', '/api/auth/google', '/api/auth/meetings/anything/recordings/request', '/api/auth/recordings/private/retry-transcript', '/api/auth/meetings/private/whiteboard/open', '/api/auth/meetings/private/whiteboard/operations', '/api/auth/meetings/private/whiteboard/ai/generate', '/api/auth/meetings/private/whiteboard/ai/jobs/private/apply']) {
    assert.notEqual((await b.post(route, {})).status, 200, route);
    assert.notEqual((await b.post(route, {})).status, 202, route);
  }
  h.privateFilesUnchanged();
});

test('email/password test accounts authenticate through existing verification with Secure cookies and strict origin/CSRF checks', async t => {
  const h = await harness(t);
  const host = await h.account(0);
  const session = host.login.cookies.find(cookie => cookie.startsWith('talk_session='));
  assert.match(session, /HttpOnly/); assert.match(session, /Secure/); assert.match(session, /SameSite=Lax/); assert.match(session, /Path=\/api\/auth/);
  assert.equal((await host.request('/api/auth/session')).body.user.email, allowedEmails[0]);
  assert.equal((await host.post('/api/auth/meetings', { title: 'Isolated test' }, { Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await host.post('/api/auth/meetings', { title: 'Isolated test' }, { 'X-CSRF-Token': 'wrong' })).status, 403);
  assert.equal((await host.post('/api/auth/meetings', { title: 'Isolated test' }, { 'Content-Type': 'text/plain' })).status, 415);
  const outsider = browser(h.base); await outsider.request('/api/auth/config');
  const signup = await outsider.post('/api/auth/email/signup', { name: 'Outsider', email: 'outsider@example.test', password: randomBytes(24).toString('hex') });
  assert.notEqual(signup.status, 202); assert.equal(h.delivered.has('outsider@example.test'), false);
  assert.notEqual((await outsider.post('/api/auth/email/login', { email: 'outsider@example.test', password: randomBytes(24).toString('hex') })).status, 200);
  h.privateFilesUnchanged();
});

test('five verified email accounts use two isolated meetings with waiting-room admission and opaque account-bound tickets', async t => {
  const h = await harness(t);
  const users = [];
  for (let index = 0; index < 5; index++) users.push(await h.account(index));
  assert.equal(new Set(users.map(user => user.password)).size, 5);
  const a = await users[0].post('/api/auth/meetings', { title: 'Team test A', approvalRequired: true });
  const b = await users[3].post('/api/auth/meetings', { title: 'Team test B', approvalRequired: true });
  assert.equal(a.status, 201); assert.equal(b.status, 201); assert.notEqual(a.body.meeting.id, b.body.meeting.id);
  const meetingIds = [a.body.meeting.id, a.body.meeting.id, a.body.meeting.id, b.body.meeting.id, b.body.meeting.id];
  const tickets = [];
  for (let index = 0; index < users.length; index++) {
    const joined = await users[index].post(`/api/auth/meetings/${meetingIds[index]}/token`, { displayName: `Teammate ${index + 1}` });
    if (index === 0 || index === 3) assert.equal(joined.status, 200);
    else {
      assert.equal(joined.status, 202); assert.equal(joined.body.joinState, 'waiting'); assert.equal(joined.body.token, undefined);
      const pending = await users[index].request(`/api/auth/meetings/${meetingIds[index]}/state`);
      assert.deepEqual(pending.body.members, []); assert.deepEqual(pending.body.pending, []);
      const owner = index < 3 ? users[0] : users[3];
      assert.equal((await owner.post(`/api/auth/meetings/${meetingIds[index]}/actions`, { action: 'admit', target: users[index].id })).status, 200);
    }
    const admitted = await users[index].post(`/api/auth/meetings/${meetingIds[index]}/token`, { displayName: `Teammate ${index + 1}`, room: 'not-authorized', identity: 'host' });
    assert.equal(admitted.status, 200); assert.match(admitted.body.token, /^[\w-]{43}$/);
    assert.equal(admitted.body.serverUrl, publicOrigin.replace(/^http/, 'ws') + '/api/auth/meeting-signal');
    assert.equal(admitted.body.token.includes('.'), false); tickets.push(admitted.body.token);
  }
  assert.equal(new Set(tickets).size, 5);
  assert.equal((await users[1].post(`/api/auth/meetings/${a.body.meeting.id}/actions`, { action: 'end' })).status, 403);
  assert.equal((await users[0].post(`/api/auth/meetings/${b.body.meeting.id}/actions`, { action: 'lock' })).status, 403);
  const recording = await users[0].request(`/api/auth/meetings/${a.body.meeting.id}/recording-state`);
  assert.equal(recording.status, 200); assert.equal(recording.body.provider.configured, false);
  assert.equal((await users[0].post(`/api/auth/meetings/${a.body.meeting.id}/recordings/request`, { mode: 'audio', language: 'en' })).status >= 400, true);
  assert.equal((await users[0].post(`/api/auth/meetings/${a.body.meeting.id}/actions`, { action: 'end' })).status, 200);
  assert.equal((await users[3].request(`/api/auth/meetings/${b.body.meeting.id}/state`)).body.status, 'active');
  h.privateFilesUnchanged();
});

test('WebSocket upgrade rejects hostile origins, missing/invalid tickets and developer endpoints without opening Cloud connections', async t => {
  const h = await harness(t);
  const ws = h.base.replace(/^http/, 'ws');
  assert.equal(await websocketStatus(`${ws}/api/auth/meeting-signal/rtc?access_token=invalid`, publicOrigin), 403);
  assert.equal(await websocketStatus(`${ws}/api/auth/meeting-signal/rtc`, 'https://attacker.example'), 403);
  assert.equal(await websocketStatus(`${ws}/api/auth/meeting-signal/rtc/v1?access_token=invalid`, publicOrigin, 'attacker.example'), 403);
  assert.notEqual(await websocketStatus(`${ws}/@vite/client`, publicOrigin), 101);
});

test('Cloudflare client address determines durable rate limits and a supplied X-Forwarded-For cannot choose another bucket', async t => {
  const h = await harness(t);
  const b = browser(h.base); await b.request('/api/auth/config');
  const failed = await b.post('/api/auth/email/login', { email: allowedEmails[0], password: randomBytes(24).toString('hex') },
    { 'X-Forwarded-For': '203.0.113.99', Forwarded: 'for=203.0.113.99;proto=https', 'X-Forwarded-Host': 'attacker.example' });
  assert.equal(failed.status, 401);
  const db = new DatabaseSync(h.config.databasePath, { readOnly: true });
  try {
    const rows = db.prepare("SELECT bucket,count FROM rate_limits WHERE bucket LIKE 'login:ip:%'").all();
    assert.deepEqual(rows, [{ bucket: `login:ip:${createHash('sha256').update('198.51.100.42').digest('hex')}`, count: 1 }].map(value => Object.assign(Object.create(null), value)));
  } finally { db.close(); }
  assert.equal((await b.request('/api/auth/config', { headers: { 'CF-Connecting-IP': 'not-an-ip' } })).status, 403);
});

test('authorized local signaling bridge forwards frames and hides signed LiveKit tokens behind opaque Talk tickets', async t => {
  const h = await harness(t);
  const upstream = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(upstream, 'listening');
  t.after(() => new Promise(resolve => { for (const socket of upstream.clients) socket.terminate(); upstream.close(resolve); }));
  h.meetings.upstreamUrl = `ws://127.0.0.1:${upstream.address().port}`;
  const host = await h.account(0);
  const created = await host.post('/api/auth/meetings', { title: 'Local signaling fixture', approvalRequired: true });
  assert.equal(created.status, 201);
  const joined = await host.post(`/api/auth/meetings/${created.body.meeting.id}/token`, { displayName: 'Fixture host' });
  assert.equal(joined.status, 200);
  const connected = once(upstream, 'connection');
  const client = new WebSocket(h.base.replace(/^http/, 'ws') + '/api/auth/meeting-signal/rtc?access_token=' + joined.body.token,
    { origin: publicOrigin, headers: { Host: new URL(publicOrigin).host, 'X-Forwarded-Proto': 'https' }, handshakeTimeout: 2500 });
  client.on('error', () => {}); t.after(() => client.terminate());
  const [source, request] = await connected;
  const signed = new URL(request.url, 'http://localhost').searchParams.get('access_token');
  assert.notEqual(signed, joined.body.token); assert.equal(signed.split('.').length, 3);
  const claims = await new TokenVerifier(fixtureKey, fixtureSecret).verify(signed);
  assert.equal(claims.video.roomJoin, true); assert.match(claims.video.room, /^talk-[\da-f-]{36}$/); assert.equal(claims.video.roomAdmin, false);
  const received = once(client, 'message');
  source.send(new SignalResponse({ message: { case: 'refreshToken', value: 'fixture-private-upstream-token' } }).toBinary());
  const [bytes] = await received;
  assert.equal(SignalResponse.fromBinary(new Uint8Array(bytes)).message.value, joined.body.token);
  const forwarded = once(source, 'message'); client.send('fixture-client-frame');
  assert.equal((await forwarded)[0].toString(), 'fixture-client-frame');
  client.terminate(); source.terminate();
  // This checks the actual gateway transport with a local SFU fixture, not real
  // LiveKit Cloud media, ICE/TURN, a public tunnel, or remote device connectivity.
});

test('restarting with a smaller tester allowlist revokes excluded sessions, pending verification and meeting tickets', async t => {
  const h = await harness(t);
  const removed = await h.account(0);
  const created = await removed.post('/api/auth/meetings', { title: 'Persisted ownership fixture', approvalRequired: true });
  const joined = await removed.post(`/api/auth/meetings/${created.body.meeting.id}/token`, { displayName: 'Removed tester' });
  assert.equal(joined.status, 200);
  const pending = browser(h.base); await pending.request('/api/auth/config');
  assert.equal((await pending.post('/api/auth/email/signup', { name: 'Pending removed tester', email: allowedEmails[2], password: randomBytes(24).toString('base64url') })).status, 202);
  const oldPendingCode = h.delivered.get(allowedEmails[2]), oldPendingCsrf = pending.csrf();
  const oldCookies = [...removed.cookies], oldPendingCookies = [...pending.cookies];
  await h.close();
  const config = buildTunnelTestConfig({ ...fixtureEnv, TUNNEL_TEST_EMAILS: allowedEmails[1] }, { root: h.root, origin: publicOrigin });
  const runtime = createTunnelTestApp(config, { meetings: testMeetingService(), mailer: { configured: true, sendVerification: async () => {} } });
  const server = runtime.app.listen(0, '127.0.0.1'); await once(server, 'listening'); runtime.attach(server);
  const close = async () => { await runtime.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };
  projectCleanup.set(h.root, close);
  const base = `http://127.0.0.1:${server.address().port}`;
  const oldUser = browser(base); for (const [key, value] of oldCookies) oldUser.cookies.set(key, value);
  assert.equal((await oldUser.request('/api/auth/session')).body.user, null);
  assert.equal((await oldUser.post(`/api/auth/meetings/${created.body.meeting.id}/token`, { displayName: 'Removed tester' })).status, 401);
  const oldPending = browser(base); for (const [key, value] of oldPendingCookies) oldPending.cookies.set(key, value); oldPending.setCsrf(oldPendingCsrf);
  assert.notEqual((await oldPending.post('/api/auth/email/verify', { code: oldPendingCode })).status, 200);
  assert.equal(await websocketStatus(base.replace(/^http/, 'ws') + '/api/auth/meeting-signal/rtc?access_token=' + joined.body.token, publicOrigin), 403);
  const db = new DatabaseSync(config.databasePath, { readOnly: true });
  try {
    assert.equal(db.prepare('SELECT owner_account_id FROM talk_meetings WHERE id=?').get(created.body.meeting.id).owner_account_id, removed.id);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM accounts WHERE id=?').get(removed.id).n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE account_id=?').get(removed.id).n, 0);
  } finally { db.close(); }
  h.privateFilesUnchanged();
});
