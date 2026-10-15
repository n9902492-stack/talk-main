import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createAuthApp } from '../server/auth.mjs';
import { openAuthDatabase } from '../server/database.mjs';
import { createFirebaseTokenVerifier } from '../server/firebase-auth.mjs';

const ORIGIN = 'http://localhost:3001';
const PROJECT = 'talk-fc3dc';
const PHONE = '+919876543210';
const CLIENT = 'talk-phone-test.apps.googleusercontent.com';
const cookieHeader = (jar) => [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
const removeTestDirectory = (directory) => {
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !/^talk-phone-(?:persistence|migration)-/.test(path.basename(resolved))) throw new Error('Unexpected test cleanup path');
  rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
};

async function harness(options = {}) {
  let timestamp = Date.now();
  const delivered = [];
  const db = openAuthDatabase(options.databasePath || ':memory:');
  const app = createAuthApp({
    clientId: CLIENT, origins: [ORIGIN], database: db, now: () => timestamp,
    firebaseProjectId: PROJECT, phoneConfigured: true,
    verifyFirebaseToken: async (credential) => JSON.parse(credential),
    verifyCredential: async (credential) => JSON.parse(credential),
    mailer: { configured: true, sendVerification: async (mail) => { delivered.push(mail); } },
    ...options, database: db,
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const jar = options.jar || new Map();
  const request = async (route, init = {}) => {
    const headers = new Headers(init.headers);
    const isolated = headers.has('Cookie');
    if (!isolated && jar.size) headers.set('Cookie', cookieHeader(jar));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/${route}`, { ...init, headers });
    const cookies = response.headers.getSetCookie();
    if (!isolated) for (const cookie of cookies) {
      const [name, value] = cookie.split(';')[0].split('=');
      if (/Max-Age=0/i.test(cookie) || !value) jar.delete(name); else jar.set(name, value);
    }
    return { status: response.status, body: await response.json(), cookies, headers: response.headers };
  };
  const post = (route, body, csrfToken, extra = {}) => request(route, {
    method: 'POST', body: JSON.stringify(body || {}), ...extra,
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken || '', ...extra.headers },
  });
  const start = async (phoneNumber = PHONE, intent = 'signin', csrfToken) => post('phone/start', { phoneNumber, intent }, csrfToken || (await request('phone/config')).body.csrfToken);
  const credential = (overrides = {}) => JSON.stringify({
    uid: 'firebase-phone-person', sub: 'firebase-phone-person', aud: PROJECT,
    iss: `https://securetoken.google.com/${PROJECT}`, phone_number: PHONE,
    firebase: { sign_in_provider: 'phone' }, iat: Math.floor(timestamp / 1000),
    auth_time: Math.floor(timestamp / 1000), exp: Math.floor(timestamp / 1000) + 3600,
    ...overrides,
  });
  const verify = async (overrides = {}, extra) => post('phone/verify', { idToken: credential(overrides) }, (await request('phone/challenge')).body.csrfToken, extra);
  const google = async () => {
    const config = (await request('config')).body;
    const signed = await post('google', { credential: JSON.stringify({
      iss: 'https://accounts.google.com', aud: CLIENT, sub: 'google-person', name: 'Google Person',
      email: 'shared@example.com', email_verified: true, nonce: config.nonce,
      iat: Math.floor(timestamp / 1000), exp: Math.floor(timestamp / 1000) + 3600,
    }) }, config.csrfToken);
    return post('google/confirm', {}, signed.body.csrfToken);
  };
  const email = async () => {
    const config = (await request('config')).body;
    const signup = await post('email/signup', { name: 'Email Person', email: 'shared@example.com', password: 'test password for Talk' }, config.csrfToken);
    assert.equal(signup.status, 202);
    return post('email/verify', { code: delivered.at(-1).code }, signup.body.csrfToken);
  };
  let closed = false;
  const close = async () => {
    if (closed) return; closed = true;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    db.close();
  };
  return { db, jar, request, post, start, verify, credential, google, email, close, advance: (ms) => { timestamp += ms; }, time: () => timestamp };
}

test('phone sign-in uses a hashed browser challenge and creates the existing secure Talk session', async (t) => {
  const h = await harness({ secureCookies: true }); t.after(h.close);
  const config = await h.request('phone/config');
  assert.equal(config.body.configured, true);
  assert.equal(typeof config.body.csrfToken, 'string');
  assert.equal(config.headers.get('cache-control'), 'no-store');
  const start = await h.start();
  assert.equal(start.status, 202);
  assert.equal(start.body.challenge.phoneNumber, PHONE);
  assert.equal(start.body.challenge.intent, 'signin');
  assert.equal(Date.parse(start.body.challenge.resendAt) - h.time(), 60000);
  assert.equal(Date.parse(start.body.challenge.expiresAt) - h.time(), 600000);
  assert.deepEqual((await h.request('phone/challenge')).body, start.body);
  assert.match(start.cookies.filter((item) => item.startsWith('talk_phone_verification=')).at(-1), /HttpOnly.*Secure.*SameSite=Lax/);
  const pending = h.db.prepare('SELECT * FROM phone_challenges').get();
  assert.notEqual(pending.token_hash, h.jar.get('talk_phone_verification'));
  const rawCredential = h.credential({ email: 'shared@example.com', email_verified: true });
  const signed = await h.post('phone/verify', { idToken: rawCredential }, start.body.csrfToken);
  assert.equal(signed.status, 200);
  assert.equal(signed.body.user.provider, 'phone');
  assert.equal(signed.body.user.phoneNumber, PHONE);
  assert.equal(signed.body.user.hasPhone, true);
  assert.equal(signed.body.user.hasPassword, false);
  assert.equal(signed.body.user.email, '');
  assert.equal(signed.body.user.emailVerified, false);
  assert.equal(signed.body.requiresConfirmation, false);
  assert.match(signed.cookies.find((item) => item.startsWith('talk_session=')), /HttpOnly.*Secure.*SameSite=Lax/);
  assert.equal(h.db.prepare('SELECT auth_method FROM sessions').get().auth_method, 'phone');
  assert.equal(h.db.prepare('SELECT token_hash FROM phone_token_uses').get().token_hash, createHash('sha256').update(rawCredential).digest('hex'));
  assert.deepEqual((await h.request('session')).body, signed.body);
  assert.equal((await h.request('phone/challenge')).body.challenge, null);
  assert.equal((await h.post('logout', {}, signed.body.csrfToken)).status, 200);
  assert.equal((await h.request('session')).body.user, null);
});

test('phone endpoints require same origin, JSON, CSRF and browser-bound challenge', async (t) => {
  const h = await harness(); t.after(h.close);
  const config = (await h.request('phone/config')).body;
  for (const [extra, status] of [
    [{ headers: { Origin: 'https://attacker.example' } }, 403],
    [{ headers: { Origin: '' } }, 403],
    [{ headers: { 'Content-Type': 'text/plain' } }, 415],
    [{ headers: { 'X-CSRF-Token': 'wrong' } }, 403],
    [{ headers: { Cookie: '' } }, 403],
  ]) assert.equal((await h.post('phone/start', { phoneNumber: PHONE, intent: 'signin' }, config.csrfToken, extra)).status, status);
  const started = await h.start(); assert.equal(started.status, 202);
  for (const extra of [{ headers: { Cookie: '' } }, { headers: { 'X-CSRF-Token': config.csrfToken } }, { headers: { Origin: 'https://attacker.example' } }]) {
    assert.equal((await h.post('phone/verify', { idToken: h.credential() }, started.body.csrfToken, extra)).status, 403);
  }
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n, 0);
});

test('invalid number formats and missing Firebase configuration fail without account creation', async (t) => {
  const h = await harness(); t.after(h.close);
  for (const phone of ['9876543210', '+91000000000000000', '+0123456789', '+91 9876543210', 'not-a-phone']) assert.equal((await h.start(phone)).status, 400);
  const off = await harness({ phoneConfigured: false }); t.after(off.close);
  assert.equal((await off.request('phone/config')).body.configured, false);
  assert.equal((await off.start()).status, 503);
  assert.equal(off.db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n, 0);
});

test('signature verifier failures and custom, stale, mismatched or invalid Firebase claims cannot create sessions', async (t) => {
  const invalid = [
    { aud: 'another-project' }, { iss: 'https://accounts.google.com' }, { uid: 'different-subject' },
    { sub: '', uid: '' }, { phone_number: '+919876543211' }, { firebase: { sign_in_provider: 'custom' } },
    { firebase: { sign_in_provider: 'google.com' } }, { uid: null },
    (h) => ({ exp: Math.floor(h.time() / 1000) }),
    (h) => ({ iat: Math.floor(h.time() / 1000) + 60 }),
    (h) => ({ auth_time: Math.floor(h.time() / 1000) + 60 }),
    (h) => ({ auth_time: Math.floor(h.time() / 1000) - 301 }),
    (h) => ({ auth_time: Math.floor(h.time() / 1000) - 6 }),
  ];
  for (const overrides of invalid) {
    const h = await harness();
    try {
      assert.equal((await h.start()).status, 202);
      assert.equal((await h.verify(typeof overrides === 'function' ? overrides(h) : overrides)).status, 401);
      assert.equal((await h.request('session')).body.user, null);
      assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n, 0);
    } finally { await h.close(); }
  }
  const h = await harness({ verifyFirebaseToken: async () => { throw new Error('signature rejected'); } }); t.after(h.close);
  await h.start();
  assert.equal((await h.verify()).status, 401);
});

test('phone proof attempts are limited and expired challenges cannot be completed', async (t) => {
  const h = await harness(); t.after(h.close);
  await h.start();
  for (let i = 0; i < 5; i++) assert.equal((await h.verify({ aud: 'wrong-project' })).status, 401);
  assert.equal((await h.verify()).status, 429);
  h.advance(60000);
  assert.equal((await h.start()).status, 202);
  h.advance(600000);
  assert.equal((await h.verify()).status, 410);
  assert.equal((await h.request('session')).body.user, null);
});

test('resend cooldown is enforced across browser challenges; resend and change-number invalidate old cookies', async (t) => {
  const h = await harness(); t.after(h.close);
  const first = await h.start();
  const oldCookie = cookieHeader(h.jar);
  const cooldown = await h.start();
  assert.equal(cooldown.status, 429);
  assert.equal(cooldown.body.retryAfter, 60);
  h.advance(60000);
  const replacement = await h.start(); assert.equal(replacement.status, 202);
  assert.notEqual(replacement.body.csrfToken, first.body.csrfToken);
  assert.equal((await h.post('phone/verify', { idToken: h.credential() }, first.body.csrfToken, { headers: { Cookie: oldCookie } })).status, 403);
  const cancelled = await h.post('phone/cancel', {}, replacement.body.csrfToken);
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.challenge, null);
  assert.equal((await h.request('phone/challenge')).body.challenge, null);
  assert.equal((await h.post('phone/verify', { idToken: h.credential() }, replacement.body.csrfToken)).status, 403);
  assert.equal((await h.start('+919876543211')).status, 202);
});

test('per-number and per-IP delivery limits persist despite spoofed forwarding headers', async (t) => {
  const h = await harness(); t.after(h.close);
  for (let i = 0; i < 5; i++) { assert.equal((await h.start()).status, 202); h.advance(60000); }
  assert.equal((await h.start()).status, 429);
  const ip = await harness(); t.after(ip.close);
  for (let i = 0; i < 30; i++) assert.equal((await ip.start(`+91987654${String(1000 + i)}`)).status, 202);
  const config = (await ip.request('phone/config')).body;
  const limited = await ip.post('phone/start', { phoneNumber: '+919876548888', intent: 'signin' }, config.csrfToken, { headers: { 'X-Forwarded-For': '192.0.2.100' } });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error, 'rate_limited');
});

test('returning Firebase UID signs into the same account; replaying a consumed token is rejected', async (t) => {
  const h = await harness(); t.after(h.close);
  const start = await h.start();
  const originalToken = h.credential();
  const first = await h.post('phone/verify', { idToken: originalToken }, start.body.csrfToken);
  assert.equal(first.status, 200);
  await h.post('logout', {}, first.body.csrfToken);
  h.advance(60000);
  const next = await h.start(); assert.equal(next.status, 202);
  const replay = JSON.parse(originalToken);
  // A second browser can start within the accepted clock skew, but not reuse
  // the exact Firebase token that already created a Talk session.
  h.db.prepare('UPDATE phone_challenges SET created_at=? WHERE consumed_at IS NULL').run(replay.auth_time * 1000);
  assert.equal((await h.post('phone/verify', { idToken: originalToken }, next.body.csrfToken)).body.error, 'phone_credential_used');
  const second = await h.verify();
  assert.equal(second.status, 200);
  assert.equal(second.body.user.id, first.body.user.id);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n, 1);
});

test('concurrent proof submissions consume one challenge and issue exactly one session', async (t) => {
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  let ready;
  let entered = 0;
  const bothVerifying = new Promise((resolve) => { ready = resolve; });
  const h = await harness({ verifyFirebaseToken: async (value) => { if (++entered === 2) ready(); await wait; return JSON.parse(value); } }); t.after(h.close);
  const start = await h.start();
  const extra = { headers: { Cookie: cookieHeader(h.jar) } };
  const requests = [h.post('phone/verify', { idToken: h.credential() }, start.body.csrfToken, extra), h.post('phone/verify', { idToken: h.credential() }, start.body.csrfToken, extra)];
  await bothVerifying; release();
  const statuses = (await Promise.all(requests)).map((item) => item.status).sort();
  assert.deepEqual(statuses, [200, 409]);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n, 1);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 1);
});

test('Google and password accounts are never implicitly linked from Firebase email claims', async (t) => {
  const h = await harness(); t.after(h.close);
  const google = await h.google(); assert.equal(google.status, 200);
  assert.equal((await h.start()).status, 409);
  await h.post('logout', {}, google.body.csrfToken);
  const email = await h.email(); assert.equal(email.status, 200);
  await h.post('logout', {}, email.body.csrfToken);
  await h.start();
  const phone = await h.verify({ email: 'shared@example.com', email_verified: true }); assert.equal(phone.status, 200);
  assert.notEqual(phone.body.user.id, google.body.user.id);
  assert.notEqual(phone.body.user.id, email.body.user.id);
  assert.equal(phone.body.user.email, '');
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n, 3);
});

test('explicit linking requires a confirmed recent session and keeps the correct existing account', async (t) => {
  const h = await harness(); t.after(h.close);
  const google = await h.google(); assert.equal(google.status, 200);
  h.db.prepare('UPDATE sessions SET requires_confirmation=1').run();
  assert.equal((await h.start(PHONE, 'link', google.body.csrfToken)).status, 403);
  h.db.prepare('UPDATE sessions SET requires_confirmation=0').run();
  const linking = await h.start(PHONE, 'link', google.body.csrfToken); assert.equal(linking.status, 202);
  const linked = await h.verify(); assert.equal(linked.status, 200);
  assert.equal(linked.body.user.id, google.body.user.id);
  assert.equal(linked.body.user.provider, 'phone');
  assert.equal(linked.body.user.emailVerified, true);
  assert.equal(linked.body.user.email, 'shared@example.com');
  assert.equal(linked.body.user.hasPhone, true);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n, 1);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM identities').get().n, 2);
  await h.post('logout', {}, linked.body.csrfToken);
  const again = await h.google();
  h.advance(10 * 60 * 1000);
  assert.equal((await h.start('+919876543211', 'link', again.body.csrfToken)).status, 403);
});

test('link verification cannot survive logout/session rotation and number/UID conflicts never merge accounts', async (t) => {
  const h = await harness(); t.after(h.close);
  const google = await h.google();
  const linking = await h.start(PHONE, 'link', google.body.csrfToken);
  const oldCookies = cookieHeader(h.jar);
  await h.post('logout', {}, google.body.csrfToken);
  assert.equal((await h.post('phone/verify', { idToken: h.credential() }, linking.body.csrfToken, { headers: { Cookie: oldCookies } })).status, 403);
  h.advance(60000);
  await h.start(); const first = await h.verify(); assert.equal(first.status, 200);
  await h.post('logout', {}, first.body.csrfToken);
  h.advance(60000); await h.start();
  const conflict = await h.verify({ uid: 'different-firebase-person', sub: 'different-firebase-person' });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error, 'phone_account_conflict');
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n, 2);
  h.advance(60000);
  const signedGoogle = await h.google();
  await h.start(PHONE, 'link', signedGoogle.body.csrfToken);
  assert.equal((await h.verify()).body.error, 'phone_account_conflict');
  assert.equal(h.db.prepare('SELECT account_id FROM phone_profiles').get().account_id, first.body.user.id);
});

test('phone sessions and identity associations survive database reopen', async (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'talk-phone-persistence-'));
  const databasePath = path.join(directory, 'auth.sqlite');
  const first = await harness({ databasePath });
  await first.start(); const signed = await first.verify(); assert.equal(signed.status, 200);
  const jar = new Map(first.jar); await first.close();
  const reopened = await harness({ databasePath, jar });
  t.after(async () => { await reopened.close(); removeTestDirectory(directory); });
  assert.deepEqual((await reopened.request('session')).body, signed.body);
  assert.equal(reopened.db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, 3);
  assert.deepEqual(reopened.db.prepare('PRAGMA foreign_key_check').all(), []);
  await reopened.post('logout', {}, signed.body.csrfToken);
  assert.equal((await reopened.request('session')).body.user, null);
});

test('migration preserves old Google/password hashes, sessions and confirmation flags', async (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'talk-phone-migration-'));
  const filename = path.join(directory, 'auth.sqlite');
  const legacy = new DatabaseSync(filename);
  legacy.exec(readFileSync(new URL('../server/migrations/001_auth.sql', import.meta.url), 'utf8'));
  legacy.exec(readFileSync(new URL('../server/migrations/002_google_confirmation.sql', import.meta.url), 'utf8'));
  legacy.exec('CREATE TABLE schema_migrations(version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  for (const version of ['001_auth.sql', '002_google_confirmation.sql']) legacy.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(version, Date.now());
  legacy.prepare('INSERT INTO accounts VALUES (?,?,?,?,?,?)').run('legacy', 'Legacy Person', 'legacy@example.com', null, 1, Date.now());
  legacy.prepare('INSERT INTO identities VALUES (?,?,?,?,?)').run('google', 'google-legacy-sub', 'legacy', null, Date.now());
  legacy.prepare('INSERT INTO identities VALUES (?,?,?,?,?)').run('password', 'legacy@example.com', 'legacy', 'unchanged-password-hash', Date.now());
  legacy.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?,?)').run('session-hash', 'legacy', 'csrf-token', 'google', Date.now(), Date.now() + 3600000, 1);
  legacy.close();
  const db = openAuthDatabase(filename); t.after(() => { db.close(); removeTestDirectory(directory); });
  assert.equal(db.prepare("SELECT password_hash FROM identities WHERE provider='password'").get().password_hash, 'unchanged-password-hash');
  assert.equal(db.prepare('SELECT requires_confirmation FROM sessions').get().requires_confirmation, 1);
  assert.equal(db.prepare("SELECT provider_id FROM identities WHERE provider='google'").get().provider_id, 'google-legacy-sub');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  db.prepare('INSERT INTO identities(provider,provider_id,account_id) VALUES (?,?,?)').run('phone', 'new-phone-uid', 'legacy');
  db.prepare('UPDATE sessions SET auth_method=?').run('phone');
  assert.equal(db.prepare('SELECT auth_method FROM sessions').get().auth_method, 'phone');
});

test('production Admin verifier rejects unsigned/custom token formats and refuses emulator credentials', async () => {
  const previous = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  try {
    delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
    assert.equal(createFirebaseTokenVerifier('').configured, false);
    const verifier = createFirebaseTokenVerifier(PROJECT);
    assert.equal(verifier.configured, true);
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${encode({ alg: 'none' })}.${encode({ aud: PROJECT, sub: 'untrusted', firebase: { sign_in_provider: 'phone' } })}.`;
    await assert.rejects(verifier.verifyIdToken(unsigned));
    await assert.rejects(verifier.verifyIdToken('not-a-valid-Firebase-token'));
    process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
    assert.equal(createFirebaseTokenVerifier(PROJECT).configured, false);
    await assert.rejects(verifier.verifyIdToken(unsigned));
  } finally {
    if (previous === undefined) delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
    else process.env.FIREBASE_AUTH_EMULATOR_HOST = previous;
  }
});

test('successful phone sign-in consumes stale Google and email verification challenges', async (t) => {
  const h = await harness(); t.after(h.close);
  const config = (await h.request('config')).body;
  const email = await h.post('email/signup', { name: 'Pending email', email: 'pending@example.com', password: 'test password for Talk' }, config.csrfToken);
  assert.equal(email.status, 202);
  assert.notEqual((await h.request('email/verification')).body.verification, null);
  await h.start();
  const phone = await h.verify(); assert.equal(phone.status, 200);
  assert.equal((await h.request('email/verification')).body.verification, null);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM google_challenges').get().n, 0);
  assert.equal((await h.post('google', { credential: 'a previously prepared Google credential' }, config.csrfToken)).status, 403);
});
