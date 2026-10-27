import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { TokenVerifier } from 'livekit-server-sdk';
import { createAuthApp } from '../backend/src/auth.mjs';
import { createMeetingService } from '../backend/src/meetings.mjs';

const origin = 'http://localhost:3001';
const apiKey = 'talk-meeting-test';
const apiSecret = 'isolated-meeting-test-secret-32-characters';
const configured = { NODE_ENV: 'production', LIVEKIT_URL: 'wss://meetings.example.test', LIVEKIT_API_KEY: apiKey, LIVEKIT_API_SECRET: apiSecret, MEETING_SIGNAL_URL: 'wss://talk.example.test/api/auth/meeting-signal' };
const verifier = new TokenVerifier(apiKey, apiSecret);

async function harness({ meetings = createMeetingService(configured), hosting = false } = {}) {
  let now = Date.now();
  const trustedOrigin = hosting ? 'https://talk.example.test' : origin;
  const app = createAuthApp({ clientId: 'meeting-test.apps.googleusercontent.com', origins: [trustedOrigin],
    secureCookies: hosting, cookieMode: hosting ? 'hosting' : 'native', cookieSecret: hosting ? Buffer.alloc(32, 9).toString('base64url') : undefined,
    verifyCredential: async credential => JSON.parse(credential), now: () => now, meetings,
    emailConfigured: true, sendVerification: async () => {} });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const cookies = new Map();
  async function request(route, { method = 'GET', body, csrf, headers = {} } = {}) {
    const response = await fetch(base + '/api/auth/' + route, { method,
      headers: { Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; '),
        ...(method === 'POST' ? { Origin: trustedOrigin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf || '' } : {}), ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    for (const cookie of response.headers.getSetCookie()) {
      const [key, ...value] = cookie.split(';')[0].split('=');
      if (/Max-Age=0/i.test(cookie)) cookies.delete(key); else cookies.set(key, value.join('='));
    }
    return { status: response.status, body: await response.json(), headers: response.headers };
  }
  async function signIn(confirm = true) {
    const config = (await request('config')).body;
    const seconds = Math.floor(now / 1000);
    const signed = await request('google', { method: 'POST', csrf: config.csrfToken,
      body: { credential: JSON.stringify({ iss: 'https://accounts.google.com', aud: 'meeting-test.apps.googleusercontent.com', sub: 'meeting-test-member',
        name: 'Meeting Member', email: 'meeting@example.test', email_verified: true, nonce: config.nonce, iat: seconds, exp: seconds + 3600 }) } });
    assert.equal(signed.status, 200);
    if (confirm) {
      assert.equal((await request('google/confirm', { method: 'POST', csrf: signed.body.csrfToken, body: {} })).status, 200);
      const created = await request('meetings/talk-workshop/create', { method: 'POST', csrf: signed.body.csrfToken, body: { approvalRequired: false } });
      assert.ok([201, 409].includes(created.status));
    }
    return signed.body.csrfToken;
  }
  return { request, signIn, cookieNames: () => [...cookies.keys()], expire: () => { now += 9 * 60 * 60 * 1000; }, async close() {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); app.locals.closeAuthDatabase();
  } };
}
const join = (h, csrf, body = { displayName: 'Test Member' }, room = 'talk-workshop', headers) => h.request(`meetings/${room}/token`, { method: 'POST', csrf, body, headers });

test('meeting credentials validate server URL, key length, TLS and production isolation', () => {
  assert.equal(createMeetingService(configured).configured, true);
  for (const changes of [{ LIVEKIT_URL: 'https://example.test' }, { LIVEKIT_URL: 'ws://localhost:7880' },
    { LIVEKIT_URL: 'wss://name:secret@example.test' }, { LIVEKIT_URL: 'wss://example.test/?token=private' }, { LIVEKIT_API_SECRET: 'short' }]) {
    assert.equal(createMeetingService({ ...configured, ...changes }).configured, false);
  }
  assert.equal(createMeetingService({ NODE_ENV: 'production' }).configured, false);
  assert.equal(createMeetingService({ ...configured, NODE_ENV: 'development', LIVEKIT_URL: 'ws://127.0.0.1:7880' }).configured, true);
});

test('meeting access requires a verified confirmed Talk session; client identities and room names do not authorize access', async t => {
  const h = await harness(); t.after(() => h.close());
  assert.equal((await h.request('meetings/talk-workshop')).status, 401);
  assert.equal((await join(h, 'anything')).status, 401);
  const csrf = await h.signIn(false);
  assert.equal((await h.request('meetings/talk-workshop')).status, 403);
  assert.equal((await join(h, csrf)).status, 403);
  await h.request('google/confirm', { method: 'POST', csrf, body: {} });
  const details = await h.request('meetings/talk-workshop');
  assert.equal(details.status, 200); assert.equal(details.body.configured, true);
  assert.equal(details.body.meeting.title, 'Social Media Marketing Workshop');
  assert.equal(details.body.csrfToken, csrf);
  assert.match(details.headers.get('Cache-Control'), /no-store/);
  assert.equal((await join(h, csrf, { displayName: 'Member', room: 'private-room', identity: 'admin' }, 'private-room')).status, 404);
  assert.equal((await h.request('meetings/other-room')).status, 404);
});

test('backend keeps signed room-scoped JWTs private and issues revocable account-bound admission tickets', async t => {
  const h = await harness(); t.after(() => h.close()); const csrf = await h.signIn();
  const response = await join(h, csrf, { displayName: '  Meeting Member  ', identity: 'admin', room: 'attacker-room', canPublishData: true });
  assert.equal(response.status, 200); assert.equal(response.body.serverUrl, configured.MEETING_SIGNAL_URL);
  assert.match(response.body.token, /^[\w-]{43}$/); assert.equal(response.body.token.includes('.'), false);
  const result = { body: await createMeetingService(configured).issueToken('fixture-account', 'Meeting Member') };
  const claims = await verifier.verify(result.body.token);
  assert.equal(claims.name, 'Meeting Member'); assert.match(claims.sub, /^talk_[a-f0-9]{24}_[a-f0-9-]{36}$/);
  assert.equal(claims.sub, result.body.identity); assert.equal(claims.video.room, 'talk-workshop');
  assert.equal(claims.video.roomJoin, true); assert.equal(claims.video.canSubscribe, true);
  assert.equal(claims.video.canPublish, true); assert.equal(claims.video.canPublishData, true);
  assert.deepEqual([...claims.video.canPublishSources].sort(), ['camera', 'microphone', 'screen_share', 'screen_share_audio'].sort());
  for (const grant of ['roomAdmin', 'roomCreate', 'roomList', 'roomRecord', 'canUpdateOwnMetadata']) assert.equal(claims.video[grant], false);
  assert.equal(claims.exp - claims.nbf, 300);
  assert.equal(JSON.stringify(result.body).includes(apiSecret), false);
  const second = await join(h, csrf); assert.notEqual(second.body.identity, response.body.identity);
  await assert.rejects(() => verifier.verify(result.body.token.slice(0, -5) + 'false'));
});

test('meeting token endpoint rejects invalid CSRF/origin/content, invalid names, expired sessions and disabled service', async t => {
  const h = await harness(); t.after(() => h.close()); const csrf = await h.signIn();
  assert.equal((await join(h, 'wrong')).status, 403);
  assert.equal((await join(h, csrf, undefined, undefined, { Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await join(h, csrf, undefined, undefined, { 'Content-Type': 'text/plain' })).status, 415);
  for (const name of ['', '   ', 'x'.repeat(81), 'bad\nname', null]) assert.equal((await join(h, csrf, { displayName: name })).status, 400);
  h.expire(); assert.equal((await join(h, csrf)).status, 401);
  const disabled = await harness({ meetings: createMeetingService({ NODE_ENV: 'production' }) }); t.after(() => disabled.close());
  const disabledCsrf = await disabled.signIn(); assert.equal((await join(disabled, disabledCsrf)).status, 503);
});

test('unverified email signup cannot mint meeting access tokens', async t => {
  const h = await harness(); t.after(() => h.close()); const config = (await h.request('config')).body;
  assert.equal((await h.request('email/signup', { method: 'POST', csrf: config.csrfToken, body: { name: 'Unverified', email: 'unverified@example.test', password: 'not-a-real-password-123' } })).status, 202);
  assert.equal((await join(h, config.csrfToken)).status, 401);
});

test('meeting authorization uses the existing encrypted Firebase Hosting session cookie', async t => {
  const h = await harness({ hosting: true }); t.after(() => h.close()); const csrf = await h.signIn();
  assert.deepEqual(h.cookieNames(), ['__session']);
  const details = await h.request('meetings/talk-workshop'); assert.equal(details.status, 200);
  assert.equal(details.body.csrfToken, csrf);
  const response = await join(h, csrf); assert.equal(response.status, 200);
  assert.match(response.body.token, /^[\w-]{43}$/);
  assert.deepEqual(h.cookieNames(), ['__session']);
  await h.request('logout', { method: 'POST', csrf, body: {} });
  assert.equal((await join(h, csrf)).status, 401);
});

test('meeting token issuance is rate limited per account and IP using existing durable limits', async t => {
  const h = await harness(); t.after(() => h.close()); const csrf = await h.signIn();
  for (let index = 0; index < 20; index++) assert.equal((await join(h, csrf)).status, 200);
  const limited = await join(h, csrf); assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('Retry-After')) > 0);
});
