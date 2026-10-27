import {sqliteMigrationCount} from './helpers/migration-count.mjs';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createAuthApp } from '../backend/src/auth.mjs';
import { openAuthDatabase } from '../backend/src/database.mjs';

const ORIGIN = 'http://localhost:3001';
const CLIENT_ID = 'talk-test.apps.googleusercontent.com';
const EMAIL = 'person@example.com';
const PASSWORD = 'correct horse talk battery';
const shaCookie = (jar) => [...jar].map(([key, value]) => `${key}=${value}`).join('; ');

async function harness(options = {}) {
  let timestamp = Date.now();
  let sequence = 100;
  const delivered = [];
  const db = options.database || openAuthDatabase(options.databasePath || ':memory:');
  const app = createAuthApp({ clientId: CLIENT_ID, origins: [ORIGIN], database: db,
    now: () => timestamp, generateCode: () => String(++sequence).padStart(6, '0'),
    mailer: { configured: true, sendVerification: async (mail) => { delivered.push(mail); } },
    verifyCredential: async (credential) => JSON.parse(credential), ...options,
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/auth/`;
  const jar = options.jar || new Map();
  const request = async (route, init = {}) => {
    const headers = new Headers(init.headers);
    const isolatedCookie = headers.has('Cookie');
    if (!headers.has('Cookie') && jar.size) headers.set('Cookie', shaCookie(jar));
    const response = await fetch(base + route, { ...init, headers });
    const cookies = response.headers.getSetCookie();
    for (const cookie of cookies) {
      if (isolatedCookie) continue;
      const [name, value] = cookie.split(';')[0].split('=');
      if (/Max-Age=0/i.test(cookie) || !value) jar.delete(name);
      else jar.set(name, value);
    }
    return { status: response.status, body: await response.json(), cookies, headers: response.headers };
  };
  const config = async () => (await request('config')).body;
  const pending = async () => (await request('email/verification')).body;
  const post = async (route, body = {}, csrfToken, extra = {}) => request(route, {
    method: 'POST', body: JSON.stringify(body), ...extra,
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken || (await config()).csrfToken, ...extra.headers },
  });
  const signup = (fields = {}) => post('email/signup', { name: 'Talk Person', email: EMAIL, password: PASSWORD, ...fields });
  const login = (fields = {}) => post('email/login', { email: EMAIL, password: PASSWORD, ...fields });
  const verify = async (code = delivered.at(-1)?.code, extra = {}) => post('email/verify', { code }, (await pending()).csrfToken, extra);
  const resend = async () => post('email/resend', {}, (await pending()).csrfToken);
  const google = async (overrides = {}) => {
    const challenge = await config();
    const seconds = Math.floor(timestamp / 1000);
    const payload = { iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: 'google-person', email: EMAIL, email_verified: true, name: 'Google Person', nonce: challenge.nonce, iat: seconds, exp: seconds + 3600, ...overrides };
    const signedIn = await post('google', { credential: JSON.stringify(payload) }, challenge.csrfToken);
    return signedIn.status === 200 ? post('google/confirm', {}, signedIn.body.csrfToken) : signedIn;
  };
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    if (!options.database) db.close();
  };
  return { db, jar, delivered, request, config, pending, post, signup, login, verify, resend, google, close, advance: (ms) => { timestamp += ms; }, time: () => timestamp };
}

test('signup stores salted hashes, verifies mailbox once, rotates HttpOnly sessions and enables login', async (t) => {
  const h = await harness({ secureCookies: true }); t.after(h.close);
  const signup = await h.signup({ email: `  ${EMAIL.toUpperCase()}  ` });
  assert.equal(signup.status, 202);
  assert.equal(signup.body.verification.email, EMAIL);
  assert.equal(Date.parse(signup.body.verification.expiresAt) - h.time(), 300000);
  assert.equal(h.delivered[0].expiresAt.getTime() - h.time(), 300000);
  assert.match(signup.body.message, /5 minutes/);
  assert.equal(Date.parse(signup.body.verification.resendAt) - h.time(), 60000);
  assert.equal((await h.request('session')).body.user, null);
  const identity = h.db.prepare("SELECT * FROM identities WHERE provider='password'").get();
  const challenge = h.db.prepare('SELECT * FROM email_challenges').get();
  assert.match(identity.password_hash, /^scrypt\$32768\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{64}$/);
  assert.match(challenge.code_hash, /^scrypt\$32768\$8\$1\$/);
  assert.equal(identity.verified_at, null);
  assert.equal(h.db.prepare('SELECT email_verified FROM accounts').get().email_verified, 0);
  const serialized = JSON.stringify({ identity, challenge });
  assert.equal(serialized.includes(PASSWORD), false);
  assert.equal(serialized.includes(h.delivered[0].code), false);
  assert.equal(challenge.token_hash.includes(h.jar.get('talk_email_verification')), false);
  const csrf = signup.body.csrfToken;
  const code = h.delivered[0].code;
  const invalid = await h.post('email/verify', { code }, 'wrong');
  assert.equal(invalid.status, 403);
  assert.equal(h.db.prepare('SELECT attempts FROM email_challenges').get().attempts, 0);
  const result = await h.verify();
  assert.equal(result.status, 200);
  assert.equal(result.body.user.provider, 'email');
  assert.equal(result.body.user.emailVerified, true);
  assert.equal(result.body.user.hasPassword, true);
  assert.equal(result.body.user.name, 'Talk Person');
  const cookie = result.cookies.find((value) => value.startsWith('talk_session='));
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Lax/); assert.match(cookie, /Secure/); assert.match(cookie, /Path=\/api\/auth/);
  assert.equal(h.db.prepare('SELECT token_hash FROM sessions').get().token_hash.includes(h.jar.get('talk_session')), false);
  assert.deepEqual((await h.request('session')).body, result.body);
  assert.equal((await h.post('email/verify', { code }, csrf)).status, 403);
  assert.equal(h.db.prepare('SELECT code_hash FROM email_challenges').get().code_hash, null);
  const oldCookie = shaCookie(h.jar);
  const login = await h.login();
  assert.equal(login.status, 200); assert.equal(login.body.user.id, result.body.user.id);
  assert.equal((await h.request('session', { headers: { Cookie: oldCookie } })).body.user, null);
  assert.equal((await h.post('logout', {}, login.body.csrfToken)).status, 200);
  assert.equal((await h.request('session')).body.user, null);
});

test('validation, same-origin JSON and CSRF protections apply before SMTP or password persistence', async (t) => {
  const h = await harness(); t.after(h.close);
  for (const fields of [{ name: ' ' }, { email: 'bad' }, { email: 'a@-example.com' }, { email: 'a..b@example.com' }, { email: 'a<@example.com' }, { email: 'a"@example.com' }, { password: 'short' }, { password: 'x'.repeat(129) }]) assert.equal((await h.signup(fields)).status, 400);
  const config = await h.config();
  for (const extra of [{ headers: { Origin: 'https://attacker.example' } }, { headers: { 'X-CSRF-Token': 'bad' } }, { headers: { Cookie: '' } }, { headers: { 'Content-Type': 'text/plain' } }]) {
    const response = await h.post('email/signup', { name: 'Talk', email: EMAIL, password: PASSWORD }, config.csrfToken, extra);
    assert.ok([403, 415].includes(response.status));
  }
  assert.equal(h.delivered.length, 0); assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n, 0);
  const missing = await harness({ mailer: { configured: false } }); t.after(missing.close);
  assert.equal((await missing.config()).emailConfigured, false);
  assert.equal((await missing.signup()).status, 503);
  assert.equal(missing.db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n, 0);
});

test('unverified login requires the correct password, can resume a pending flow and expired codes cannot authenticate', async (t) => {
  const h = await harness(); t.after(h.close);
  await h.signup();
  assert.equal((await h.login({ password: 'another password' })).status, 401);
  const resumed = await h.login(); assert.equal(resumed.status, 202); assert.equal(h.delivered.length, 1);
  assert.equal((await h.request('session')).body.user, null);
  const oldCode = h.delivered[0].code;
  h.advance(300000);
  assert.equal((await h.verify(oldCode)).status, 410);
  assert.equal(h.db.prepare('SELECT email_verified FROM accounts').get().email_verified, 0);
  const login = await h.login(); assert.equal(login.status, 202); assert.equal(h.delivered.length, 2);
  assert.equal((await h.verify(oldCode)).status, 400);
  assert.equal((await h.verify()).status, 200);
});

test('an email code remains valid up to the last millisecond of its five-minute lifetime', async (t) => {
  const h = await harness(); t.after(h.close);
  await h.signup();
  h.advance(299999);
  assert.equal((await h.verify()).status, 200);
});

test('persisted ten-minute codes are capped to five minutes even when verification is posted directly', async (t) => {
  const h = await harness(); t.after(h.close);
  const signup = await h.signup();
  const issuedAt = h.time();
  // Simulate a code persisted by the previous runtime without changing its hash.
  h.db.prepare('UPDATE email_challenges SET expires_at=?').run(issuedAt + 600000);
  h.advance(300000);
  const result = await h.post('email/verify', { code: h.delivered[0].code }, signup.body.csrfToken);
  assert.equal(result.status, 410);
  assert.equal(result.body.error, 'code_expired');
  assert.equal(h.db.prepare('SELECT expires_at FROM email_challenges').get().expires_at, issuedAt + 300000);
  assert.equal((await h.request('session')).body.user, null);
  assert.equal(h.db.prepare('SELECT email_verified FROM accounts').get().email_verified, 0);
});

test('legacy resent codes are capped from the current generation send time instead of the original signup time', async (t) => {
  const h = await harness(); t.after(h.close);
  await h.signup();
  h.advance(120000);
  await h.resend();
  const resentAt = h.time();
  h.db.prepare('UPDATE email_challenges SET expires_at=?').run(resentAt + 600000);
  const pending = await h.pending();
  assert.equal(Date.parse(pending.verification.expiresAt), resentAt + 300000);
  h.advance(299999);
  assert.equal((await h.verify()).status, 200);
});

test('five incorrect attempts exhaust a code; correct fifth attempt is allowed', async (t) => {
  const h = await harness(); t.after(h.close);
  await h.signup();
  assert.equal((await h.verify('12')).status, 400);
  assert.equal(h.db.prepare('SELECT attempts FROM email_challenges').get().attempts, 0);
  for (let i = 0; i < 4; i += 1) {
    const result = await h.verify('999999'); assert.equal(result.status, 400); assert.equal(result.body.attemptsRemaining, 4 - i);
  }
  const exhausted = await h.verify('999999'); assert.equal(exhausted.status, 429); assert.equal(exhausted.body.error, 'attempt_limit');
  assert.equal((await h.verify()).status, 429); assert.equal((await h.request('session')).body.user, null);
  h.advance(60000); await h.resend();
  for (let i = 0; i < 4; i += 1) assert.equal((await h.verify('999999')).status, 400);
  assert.equal((await h.verify()).status, 200);
});

test('resend enforces cooldown, invalidates the old generation and parallel resends send only one new code', async (t) => {
  const h = await harness(); t.after(h.close);
  await h.signup(); const oldCode = h.delivered[0].code;
  const early = await h.resend(); assert.equal(early.status, 429); assert.equal(early.body.retryAfter, 60); assert.equal(early.headers.get('Retry-After'), '60');
  h.advance(60000);
  const results = await Promise.all([h.resend(), h.resend()]);
  assert.deepEqual(results.map((r) => r.status).sort(), [202, 429]); assert.equal(h.delivered.length, 2);
  assert.equal(Date.parse(results.find((r) => r.status === 202).body.verification.expiresAt) - h.time(), 300000);
  assert.equal(h.delivered[1].expiresAt.getTime() - h.time(), 300000);
  assert.equal((await h.verify(oldCode)).status, 400);
  assert.equal((await h.verify()).status, 200);
});

test('a repeated signup cannot overwrite a password until mailbox proof; verified accounts cannot be overwritten', async (t) => {
  const h = await harness(); t.after(h.close);
  await h.signup(); const firstCookie = shaCookie(h.jar); const firstCsrf = (await h.pending()).csrfToken; const firstCode = h.delivered[0].code;
  const firstHash = h.db.prepare("SELECT password_hash FROM identities WHERE provider='password'").get().password_hash;
  h.advance(60000); await h.signup({ password: 'replacement password', name: 'New Person' });
  assert.equal(h.db.prepare("SELECT password_hash FROM identities WHERE provider='password'").get().password_hash, firstHash);
  assert.equal((await h.post('email/verify', { code: firstCode }, firstCsrf, { headers: { Cookie: firstCookie } })).status, 403);
  const verified = await h.verify(); assert.equal(verified.status, 200); assert.equal(verified.body.user.name, 'New Person');
  assert.equal((await h.login()).status, 401);
  assert.equal((await h.login({ password: 'replacement password' })).status, 200);
  h.advance(60000); const duplicate = await h.signup({ password: 'malicious replacement' });
  assert.equal(duplicate.status, 202); assert.equal(duplicate.body.verification.purpose, 'signup');
  assert.equal((await h.verify()).status, 409);
  assert.equal((await h.login({ password: 'malicious replacement' })).status, 401);
  assert.equal((await h.login({ password: 'replacement password' })).status, 200);
});

test('unknown and incorrect credentials share responses; delivery failure never exposes transport details or authenticates', async (t) => {
  let failDelivery = false;
  const deliveries = [];
  const h = await harness({ mailer: { configured: true, sendVerification: async (mail) => { deliveries.push(mail); if (failDelivery) throw new Error('sensitive smtp credential and transport detail'); } } }); t.after(h.close);
  await h.signup();
  const wrong = await h.login({ password: 'incorrect password' }); const unknown = await h.login({ email: 'unknown@example.com' });
  assert.equal(wrong.status, 401); assert.equal(unknown.status, 401); assert.deepEqual(wrong.body, unknown.body);
  assert.equal((await h.verify(deliveries[0].code)).status, 200);
  await h.post('logout', {}, (await h.request('session')).body.csrfToken);
  h.advance(60000); failDelivery = true;
  const existing = await h.signup(); const absent = await h.signup({ email: 'new@example.com' });
  assert.equal(existing.status, 503); assert.equal(absent.status, 503);
  assert.equal(existing.body.error, absent.body.error); assert.equal(existing.body.message, absent.body.message);
  assert.equal(existing.body.verification.purpose, absent.body.verification.purpose);
  assert.equal(JSON.stringify(existing.body).includes('sensitive'), false);
  assert.equal(absent.body.verification.deliveryState, 'failed');
  assert.equal((await h.pending()).verification.deliveryState, 'failed');
  assert.equal((await h.verify(deliveries.at(-1).code)).status, 409);
  assert.equal((await h.request('session')).body.user, null);
});

test('email delivery and login rates persist and clients cannot bypass IP limits with forwarding headers', async (t) => {
  const h = await harness(); t.after(h.close);
  await h.signup();
  for (let i = 0; i < 4; i += 1) { h.advance(60000); assert.equal((await h.resend()).status, 202); }
  h.advance(60000); const capped = await h.resend(); assert.equal(capped.status, 429); assert.equal(capped.body.error, 'rate_limited');
  const firstCode = h.delivered.at(-1).code;
  assert.equal((await h.verify(firstCode)).status, 200);
  for (let i = 0; i < 10; i += 1) assert.equal((await h.login({ password: 'wrong password' })).status, 401);
  assert.equal((await h.login()).status, 429);
  const challenge = await h.config();
  for (let i = 0; i < 30; i += 1) await h.post('email/login', { email: `unknown${i}@example.com`, password: PASSWORD }, challenge.csrfToken, { headers: { 'X-Forwarded-For': `192.0.2.${i}` } });
  const ipCap = await h.post('email/login', { email: 'one-more@example.com', password: PASSWORD }, challenge.csrfToken, { headers: { 'X-Forwarded-For': '203.0.113.99' } });
  assert.equal(ipCap.status, 429);
});

test('verification and sessions survive database reopen; migrations are idempotent and logout revokes persisted sessions', async (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'talk-auth-test-')); const filename = path.join(directory, 'auth.sqlite');
  let h = await harness({ databasePath: filename });
  t.after(async () => { await h.close(); assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir())); rmSync(directory, { recursive: true, force: true }); });
  await h.signup(); const jar = new Map(h.jar); const code = h.delivered[0].code; await h.close();
  h = await harness({ databasePath: filename, jar });
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n,sqliteMigrationCount);
  const verified = await h.verify(code); assert.equal(verified.status, 200); const sessionJar = new Map(h.jar); const userId = verified.body.user.id; await h.close();
  h = await harness({ databasePath: filename, jar: sessionJar }); t.after(h.close);
  const session = await h.request('session'); assert.equal(session.body.user.id, userId);
  assert.equal((await h.post('logout', {}, session.body.csrfToken)).status, 200);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
});

test('parallel valid verification requests consume the code once and create exactly one session', async (t) => {
  const h = await harness(); t.after(h.close);
  const signup = await h.signup(); const cookie = shaCookie(h.jar); const code = h.delivered[0].code;
  const requests = await Promise.all([h.post('email/verify', { code }, signup.body.csrfToken, { headers: { Cookie: cookie } }), h.post('email/verify', { code }, signup.body.csrfToken, { headers: { Cookie: cookie } })]);
  assert.deepEqual(requests.map((r) => r.status).sort(), [200, 409]);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 1);
});

test('parallel signups to one mailbox honor the shared cooldown after asynchronous password hashing', async (t) => {
  const h = await harness(); t.after(h.close);
  const csrf = (await h.config()).csrfToken; const cookie = shaCookie(h.jar);
  const fields = { name: 'Talk Person', email: EMAIL, password: PASSWORD };
  const results = await Promise.all([h.post('email/signup', fields, csrf, { headers: { Cookie: cookie } }), h.post('email/signup', fields, csrf, { headers: { Cookie: cookie } })]);
  assert.deepEqual(results.map((r) => r.status).sort(), [202, 429]);
  assert.equal(h.delivered.length, 1);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n, 1);
});

test('equal Google and password emails create separate accounts; no automatic linking or account merging occurs', async (t) => {
  const h = await harness(); t.after(h.close);
  await h.signup(); const password = await h.verify();
  const google = await h.google(); assert.equal(google.status, 200); assert.notEqual(google.body.user.id, password.body.user.id);
  assert.equal(google.body.user.hasPassword, false); assert.equal(google.body.user.provider, 'google');
  h.advance(60000); const link = await h.post('email/link/start', { password: 'linked password', email: 'attacker@example.com' }, google.body.csrfToken);
  assert.equal(link.status, 202); assert.equal(link.body.verification.email, EMAIL);
  assert.equal((await h.verify()).status, 409);
  assert.equal((await h.login()).body.user.id, password.body.user.id);
  assert.equal((await h.login({ password: 'linked password' })).status, 401);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n, 2);
});

test('Google linking requires a recent bound Google session and mailbox code, then both methods access the same account', async (t) => {
  const h = await harness(); t.after(h.close);
  const challenge = await h.config(); assert.equal((await h.post('email/link/start', { password: PASSWORD }, challenge.csrfToken)).status, 403);
  const google = await h.google();
  assert.equal((await h.post('email/link/start', { password: PASSWORD }, 'bad')).status, 403);
  const link = await h.post('email/link/start', { password: PASSWORD }, google.body.csrfToken);
  assert.equal(link.status, 202); assert.equal(link.body.verification.purpose, 'link');
  const code = h.delivered[0].code;
  assert.equal((await h.verify(code, { headers: { Cookie: `talk_email_verification=${h.jar.get('talk_email_verification')}` } })).status, 403);
  const linked = await h.verify(code); assert.equal(linked.status, 200); assert.equal(linked.body.user.id, google.body.user.id); assert.equal(linked.body.user.hasPassword, true);
  const passwordLogin = await h.login(); assert.equal(passwordLogin.status, 200); assert.equal(passwordLogin.body.user.id, google.body.user.id); assert.equal(passwordLogin.body.user.provider, 'email');
  assert.equal((await h.request('session')).body.user.provider, 'email');
  assert.equal((await h.post('email/link/start', { password: PASSWORD }, passwordLogin.body.csrfToken)).status, 403);
  const second = await h.google({ sub: 'another-google', email: 'another@example.com' }); h.advance(600000);
  assert.equal((await h.post('email/link/start', { password: PASSWORD }, second.body.csrfToken)).status, 403);
});

test('Google challenge and recent account-linking windows stay ten minutes independently of email codes', async (t) => {
  const h = await harness(); t.after(h.close);
  await h.config();
  assert.equal(h.db.prepare('SELECT expires_at FROM google_challenges').get().expires_at - h.time(), 600000);
  const google = await h.google();
  h.advance(540000);
  const link = await h.post('email/link/start', { password: PASSWORD }, google.body.csrfToken);
  assert.equal(link.status, 202);
  assert.equal(Date.parse(link.body.verification.expiresAt) - h.time(), 300000);
  assert.equal((await h.verify()).status, 200);
});

test('changing email invalidates the browser code and email verification cannot be used after logout', async (t) => {
  const h = await harness(); t.after(h.close);
  const signup = await h.signup(); const oldCookie = shaCookie(h.jar); const code = h.delivered[0].code;
  assert.equal((await h.post('email/change', {}, signup.body.csrfToken)).status, 200);
  assert.equal((await h.pending()).verification, null);
  assert.equal((await h.post('email/verify', { code }, signup.body.csrfToken, { headers: { Cookie: oldCookie } })).status, 403);
  h.advance(60000); const google = await h.google();
  await h.post('email/link/start', { password: PASSWORD }, google.body.csrfToken);
  const pending = await h.pending(); const pendingCookie = shaCookie(h.jar);
  await h.post('logout', {}, google.body.csrfToken);
  assert.equal((await h.post('email/verify', { code: h.delivered.at(-1).code }, pending.csrfToken, { headers: { Cookie: pendingCookie } })).status, 403);
});
