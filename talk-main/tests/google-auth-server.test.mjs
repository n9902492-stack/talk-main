import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import { OAuth2Client } from 'google-auth-library';
import { createAuthApp } from '../server/auth.mjs';

const CLIENT_ID = 'talk-test.apps.googleusercontent.com';
const ORIGIN = 'http://localhost:3001';

function payload(nonce, overrides = {}) {
  const seconds = Math.floor(Date.now() / 1000);
  return {
    iss: 'https://accounts.google.com', aud: CLIENT_ID,
    sub: '1234567890', email: 'person@example.com', email_verified: true,
    name: 'Talk Person', picture: 'https://lh3.googleusercontent.com/a/test-photo',
    nonce, iat: seconds, exp: seconds + 3600, ...overrides,
  };
}

async function harness(options = {}) {
  const app = createAuthApp({
    clientId: CLIENT_ID, origins: [ORIGIN],
    verifyCredential: async (credential) => JSON.parse(credential),
    ...options,
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const jar = new Map();
  async function request(route, options = {}) {
    const headers = new Headers(options.headers);
    if (!headers.has('Cookie') && jar.size) headers.set('Cookie', [...jar].map(([key, value]) => `${key}=${value}`).join('; '));
    const response = await fetch(`${base}/api/auth/${route}`, { ...options, headers });
    const cookies = response.headers.getSetCookie();
    for (const cookie of cookies) {
      const [name, ...value] = cookie.split(';')[0].split('=');
      if (/Max-Age=0/i.test(cookie) || !value.join('=')) jar.delete(name);
      else jar.set(name, value.join('='));
    }
    return { status: response.status, body: await response.json(), cookies, headers: response.headers };
  }
  const config = () => request('config');
  const google = (challenge, credential = JSON.stringify(payload(challenge.nonce)), options = {}) => request('google', {
    method: 'POST', body: JSON.stringify({ credential }),
    ...options,
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json', 'X-CSRF-Token': challenge.csrfToken, ...options.headers },
  });
  const logout = (csrfToken, options = {}) => request('logout', {
    method: 'POST', body: '{}', ...options,
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken, ...options.headers },
  });
  const close = async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    app.locals.closeAuthDatabase();
  };
  return { request, config, google, logout, jar, close };
}

test('unconfigured service remains explicit and does not accept credentials', async (t) => {
  const h = await harness({ clientId: undefined });
  t.after(h.close);
  const { body, cookies, headers } = await h.config();
  assert.equal(body.configured, false);
  assert.equal(body.clientId, undefined);
  assert.match(body.csrfToken, /^[A-Za-z0-9_-]{43}$/);
  assert.match(body.nonce, /^[A-Za-z0-9_-]{43}$/);
  assert.match(cookies[0], /HttpOnly/);
  assert.match(cookies[0], /SameSite=Lax/);
  assert.match(headers.get('Cache-Control'), /no-store/);
  assert.equal((await h.google(body)).status, 503);
  assert.equal((await h.request('session')).body.user, null);
  assert.equal((await h.request('unknown')).status, 404);
});

test('configuration reuses the browser challenge and enforces CSRF and exact origin', async (t) => {
  const h = await harness();
  t.after(h.close);
  const challenge = (await h.config()).body;
  assert.deepEqual((await h.config()).body, challenge);
  const noCookie = await h.google(challenge, undefined, { headers: { Cookie: '' } });
  assert.equal(noCookie.status, 403);
  assert.equal((await h.google(challenge, undefined, { headers: { 'X-CSRF-Token': 'invalid' } })).status, 403);
  assert.equal((await h.google(challenge, undefined, { headers: { Origin: 'https://attacker.example' } })).status, 403);
  assert.equal((await h.google(challenge, undefined, { headers: { Origin: 'http://localhost:3001.attacker.example' } })).status, 403);
  assert.equal((await h.google(challenge, undefined, { headers: { Origin: '' } })).status, 403);
  assert.equal((await h.google(challenge, undefined, { headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await h.request('session')).body.user, null);
});

test('verified credential creates an opaque HttpOnly session, persists across reads and signs out', async (t) => {
  const h = await harness({ secureCookies: true });
  t.after(h.close);
  const challenge = (await h.config()).body;
  const credential = JSON.stringify(payload(challenge.nonce));
  const result = await h.google(challenge, credential);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.user, { id: '1234567890', name: 'Talk Person', email: 'person@example.com', picture: 'https://lh3.googleusercontent.com/a/test-photo', provider: 'google', hasPassword: false, emailVerified: true, hasPhone: false });
  assert.equal(h.jar.has('talk_auth_challenge'), false);
  assert.match(h.jar.get('talk_session'), /^[A-Za-z0-9_-]{43}$/);
  const cookie = result.cookies.find((value) => value.startsWith('talk_session='));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Max-Age=28800/);
  assert.ok(!JSON.stringify(result.body).includes(credential));
  assert.deepEqual((await h.request('session')).body, result.body);
  assert.equal((await h.logout('wrong')).status, 403);
  assert.equal((await h.logout(result.body.csrfToken, { headers: { Origin: 'https://attacker.example' } })).status, 403);
  assert.deepEqual((await h.logout(result.body.csrfToken)).body, { user: null, csrfToken: null });
  assert.equal(h.jar.has('talk_session'), false);
  assert.deepEqual((await h.request('session')).body, { user: null, csrfToken: null });
});

test('Google identity validation rejects forged, stale and incorrectly bound credentials', async (t) => {
  const h = await harness();
  t.after(h.close);
  const challenge = (await h.config()).body;
  const invalid = [
    'forged-token',
    payload(challenge.nonce, { nonce: 'another-browser-challenge' }),
    payload(challenge.nonce, { email_verified: false }),
    payload(challenge.nonce, { email_verified: 'true' }),
    payload(challenge.nonce, { aud: 'another.apps.googleusercontent.com' }),
    payload(challenge.nonce, { azp: 'another.apps.googleusercontent.com' }),
    payload(challenge.nonce, { iss: 'https://attacker.example' }),
    payload(challenge.nonce, { exp: Math.floor(Date.now() / 1000) - 1 }),
    payload(challenge.nonce, { iat: Math.floor(Date.now() / 1000) + 1000 }),
    payload(challenge.nonce, { sub: '' }),
    payload(challenge.nonce, { email: 'invalid-email' }),
  ];
  for (const identity of invalid) {
    const result = await h.google(challenge, typeof identity === 'string' ? identity : JSON.stringify(identity));
    assert.equal(result.status, 401, `accepted invalid identity: ${JSON.stringify(identity)}`);
    assert.equal((await h.request('session')).body.user, null);
  }
  assert.equal((await h.google(challenge, '')).status, 400);
  assert.equal((await h.google(challenge, 'x'.repeat(10001))).status, 400);
  assert.equal((await h.google(challenge, 'x'.repeat(13000))).status, 413);
  assert.equal((await h.request('google', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: '{' })).status, 400);
});

test('credentials cannot be replayed and sign-in rotates the previous session', async (t) => {
  const h = await harness();
  t.after(h.close);
  const challenge = (await h.config()).body;
  const credential = JSON.stringify(payload(challenge.nonce));
  assert.equal((await h.google(challenge, credential)).status, 200);
  const previousCookie = `talk_session=${h.jar.get('talk_session')}`;
  assert.equal((await h.google(challenge, credential)).status, 403);
  const secondChallenge = (await h.config()).body;
  assert.notEqual(secondChallenge.nonce, challenge.nonce);
  assert.equal((await h.google(secondChallenge, credential)).status, 401);
  assert.equal((await h.google(secondChallenge)).status, 200);
  assert.notEqual(`talk_session=${h.jar.get('talk_session')}`, previousCookie);
  const stale = await h.request('session', { headers: { Cookie: previousCookie } });
  assert.equal(stale.body.user, null);
});

test('simultaneous credential replay creates exactly one authenticated session', async (t) => {
  let pendingResolve;
  let entered = 0;
  const barrier = new Promise((resolve) => { pendingResolve = resolve; });
  const h = await harness({ verifyCredential: async (credential) => {
    entered += 1;
    if (entered === 2) pendingResolve();
    await barrier;
    return JSON.parse(credential);
  } });
  t.after(h.close);
  const challenge = (await h.config()).body;
  const cookie = `talk_auth_challenge=${h.jar.get('talk_auth_challenge')}`;
  const results = await Promise.all([h.google(challenge, undefined, { headers: { Cookie: cookie } }), h.google(challenge, undefined, { headers: { Cookie: cookie } })]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 403]);
});

test('challenges and server sessions expire without trusting stale browser cookies', async (t) => {
  let timestamp = Date.now();
  const h = await harness({ now: () => timestamp });
  t.after(h.close);
  const expired = (await h.config()).body;
  timestamp += 10 * 60 * 1000 + 1;
  assert.equal((await h.google(expired)).status, 403);
  const current = (await h.config()).body;
  const identity = payload(current.nonce, { iat: Math.floor(timestamp / 1000), exp: Math.floor(timestamp / 1000) + 3600 });
  assert.equal((await h.google(current, JSON.stringify(identity))).status, 200);
  timestamp += 8 * 60 * 60 * 1000 + 1;
  assert.deepEqual((await h.request('session')).body, { user: null, csrfToken: null });
});

test('profile fields are bounded and picture URLs must belong to Google HTTPS hosts', async (t) => {
  const h = await harness();
  t.after(h.close);
  for (const picture of ['http://lh3.googleusercontent.com/photo', 'https://googleusercontent.com.attacker.example/photo', 'javascript:alert(1)', 'https://user@lh3.googleusercontent.com/photo']) {
    const challenge = (await h.config()).body;
    const identity = payload(challenge.nonce, { picture, name: `  Talk\n Person ${'x'.repeat(100)} ` });
    const result = await h.google(challenge, JSON.stringify(identity));
    assert.equal(result.status, 200);
    assert.equal(result.body.user.picture, undefined);
    assert.ok(result.body.user.name.length <= 80);
    assert.ok(!result.body.user.name.includes('\n'));
  }
});

test('Google verifier checks real RSA signatures and rejects tampered ID tokens', async (t) => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const verifier = new OAuth2Client();
  const certificates = { 'test-key': publicKey.export({ type: 'spki', format: 'pem' }) };
  const h = await harness({ verifyCredential: async (credential, { audience }) => {
    const ticket = await verifier.verifySignedJwtWithCertsAsync(credential, certificates, audience, ['accounts.google.com', 'https://accounts.google.com']);
    return ticket.getPayload();
  } });
  t.after(h.close);
  const challenge = (await h.config()).body;
  const encodedHeader = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key', typ: 'JWT' })).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload(challenge.nonce))).toString('base64url');
  const signedPart = `${encodedHeader}.${encodedPayload}`;
  const signature = sign('RSA-SHA256', Buffer.from(signedPart), privateKey);
  const credential = `${signedPart}.${signature.toString('base64url')}`;
  const tampered = Buffer.from(signature);
  tampered[0] ^= 1;
  assert.equal((await h.google(challenge, `${signedPart}.${tampered.toString('base64url')}`)).status, 401);
  assert.equal((await h.google(challenge, credential)).status, 200);
});
