import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createAuthApp } from '../backend/src/auth.mjs';
import { openAuthDatabase } from '../backend/src/database.mjs';

const ORIGIN = 'http://localhost:3001';
const CLIENT_ID = 'talk-confirmation-test.apps.googleusercontent.com';
const EMAIL = 'confirmation@example.com';
const PASSWORD = 'local test password only';
const cookieHeader = (jar) => [...jar].map(([name, value]) => `${name}=${value}`).join('; ');

async function harness(options = {}) {
  let timestamp = Date.now();
  let sequence = 100;
  const delivered = [];
  const db = openAuthDatabase(options.databasePath || ':memory:');
  const app = createAuthApp({
    clientId: CLIENT_ID, origins: [ORIGIN], database: db,
    now: () => timestamp,
    verifyCredential: async (credential) => JSON.parse(credential),
    generateCode: () => String(++sequence).padStart(6, '0'),
    mailer: { configured: true, sendVerification: async (mail) => { delivered.push(mail); } },
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/auth/`;
  const jar = options.jar || new Map();
  const request = async (route, init = {}) => {
    const headers = new Headers(init.headers);
    const isolatedCookie = headers.has('Cookie');
    if (!isolatedCookie && jar.size) headers.set('Cookie', cookieHeader(jar));
    const response = await fetch(base + route, { ...init, headers });
    const cookies = response.headers.getSetCookie();
    if (!isolatedCookie) for (const cookie of cookies) {
      const [name, value] = cookie.split(';')[0].split('=');
      if (/Max-Age=0/i.test(cookie) || !value) jar.delete(name);
      else jar.set(name, value);
    }
    return { status: response.status, body: await response.json(), cookies, headers: response.headers };
  };
  const config = async () => (await request('config')).body;
  const post = async (route, body, csrfToken, extra = {}) => request(route, {
    method: 'POST', body: JSON.stringify(body || {}), ...extra,
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken || '', ...extra.headers },
  });
  const google = async (overrides = {}) => {
    const challenge = await config();
    const seconds = Math.floor(timestamp / 1000);
    return post('google', { credential: JSON.stringify({
      iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: 'google-confirmation-person',
      email: EMAIL, email_verified: true, name: 'Verified Google Person',
      picture: 'https://lh3.googleusercontent.com/a/test-photo', nonce: challenge.nonce,
      iat: seconds, exp: seconds + 3600, ...overrides,
    }) }, challenge.csrfToken);
  };
  const confirm = (csrfToken, extra) => post('google/confirm', {}, csrfToken, extra);
  const signup = async () => post('email/signup', { name: 'Email Person', email: EMAIL, password: PASSWORD }, (await config()).csrfToken);
  const verify = async (code = delivered.at(-1)?.code) => post('email/verify', { code }, (await request('email/verification')).body.csrfToken);
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    db.close();
  };
  return { db, delivered, jar, request, config, post, google, confirm, signup, verify, close, advance: (ms) => { timestamp += ms; } };
}

test('verified Google sign-in creates a pending session and Talk continuation is idempotent', async (t) => {
  const h = await harness(); t.after(h.close);
  const google = await h.google();
  assert.equal(google.status, 200);
  assert.equal(google.body.requiresConfirmation, true);
  assert.equal(google.body.user.name, 'Verified Google Person');
  assert.equal(google.body.user.email, EMAIL);
  assert.equal(google.body.user.provider, 'google');
  assert.equal(google.body.user.emailVerified, true);
  assert.equal(google.body.user.hasPassword, false);
  assert.match(google.cookies.find((cookie) => cookie.startsWith('talk_session=')), /HttpOnly/);
  assert.equal(h.db.prepare('SELECT requires_confirmation FROM sessions').get().requires_confirmation, 1);
  assert.deepEqual((await h.request('session')).body, google.body);
  const originalCookie = h.jar.get('talk_session');
  const confirmed = await h.confirm(google.body.csrfToken);
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.requiresConfirmation, false);
  assert.deepEqual(confirmed.body.user, google.body.user);
  assert.equal(confirmed.body.csrfToken, google.body.csrfToken);
  assert.equal(h.jar.get('talk_session'), originalCookie);
  assert.equal(h.db.prepare('SELECT requires_confirmation FROM sessions').get().requires_confirmation, 0);
  assert.deepEqual((await h.confirm(google.body.csrfToken)).body, confirmed.body);
  assert.deepEqual((await h.request('session')).body, confirmed.body);
});

test('confirmation requires a live Google session, session CSRF, exact origin and JSON', async (t) => {
  const h = await harness(); t.after(h.close);
  const publicChallenge = await h.config();
  assert.equal((await h.confirm(publicChallenge.csrfToken)).status, 403);
  const google = await h.google();
  for (const [extra, status] of [
    [{ headers: { Cookie: '' } }, 403],
    [{ headers: { Cookie: `talk_session=${'x'.repeat(43)}` } }, 403],
    [{ headers: { 'X-CSRF-Token': 'wrong' } }, 403],
    [{ headers: { 'X-CSRF-Token': publicChallenge.csrfToken } }, 403],
    [{ headers: { Origin: 'https://attacker.example' } }, 403],
    [{ headers: { Origin: 'http://localhost:3001.attacker.example' } }, 403],
    [{ headers: { Origin: '' } }, 403],
    [{ headers: { 'Content-Type': 'text/plain' } }, 415],
  ]) {
    assert.equal((await h.confirm(google.body.csrfToken, extra)).status, status);
    assert.equal(h.db.prepare('SELECT requires_confirmation FROM sessions').get().requires_confirmation, 1);
  }
  const malformed = await h.request('google/confirm', { method: 'POST', body: '{', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', 'X-CSRF-Token': google.body.csrfToken } });
  assert.equal(malformed.status, 400);
  assert.equal(h.db.prepare('SELECT requires_confirmation FROM sessions').get().requires_confirmation, 1);
  h.advance(8 * 60 * 60 * 1000);
  assert.equal((await h.confirm(google.body.csrfToken)).status, 403);
  assert.deepEqual((await h.request('session')).body, { user: null, csrfToken: null });
});

test('Cancel revokes the pending cookie and old credentials cannot confirm or resume it', async (t) => {
  const h = await harness(); t.after(h.close);
  const google = await h.google();
  const oldCookie = cookieHeader(h.jar);
  const cancelled = await h.post('logout', {}, google.body.csrfToken);
  assert.equal(cancelled.status, 200);
  assert.deepEqual(cancelled.body, { user: null, csrfToken: null });
  assert.equal(h.jar.has('talk_session'), false);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
  assert.equal((await h.confirm(google.body.csrfToken, { headers: { Cookie: oldCookie } })).status, 403);
  assert.deepEqual((await h.request('session', { headers: { Cookie: oldCookie } })).body, { user: null, csrfToken: null });
});

test('email verification and password login remain confirmed and do not accept Google continuation', async (t) => {
  const h = await harness(); t.after(h.close);
  const signup = await h.signup(); assert.equal(signup.status, 202);
  const verified = await h.verify(); assert.equal(verified.status, 200);
  assert.equal(verified.body.user.provider, 'email');
  assert.equal(verified.body.requiresConfirmation, false);
  assert.equal((await h.confirm(verified.body.csrfToken)).status, 403);
  assert.deepEqual((await h.request('session')).body, verified.body);
  const login = await h.post('email/login', { email: EMAIL, password: PASSWORD }, (await h.config()).csrfToken);
  assert.equal(login.status, 200);
  assert.equal(login.body.requiresConfirmation, false);
  assert.equal(login.body.user.id, verified.body.user.id);
  assert.equal(h.db.prepare('SELECT requires_confirmation FROM sessions').get().requires_confirmation, 0);
});

test('Google account linking is blocked until confirmation, including verification and resend', async (t) => {
  const h = await harness(); t.after(h.close);
  const google = await h.google();
  assert.equal((await h.post('email/link/start', { password: PASSWORD }, google.body.csrfToken)).status, 403);
  assert.equal(h.delivered.length, 0);
  await h.confirm(google.body.csrfToken);
  const linking = await h.post('email/link/start', { password: PASSWORD }, google.body.csrfToken);
  assert.equal(linking.status, 202);
  const oldCode = h.delivered.at(-1).code;
  // A bound email challenge cannot bypass a pending Google session either.
  h.db.prepare('UPDATE sessions SET requires_confirmation=1').run();
  assert.equal((await h.verify()).status, 403);
  assert.equal(h.db.prepare('SELECT attempts FROM email_challenges').get().attempts, 0);
  h.advance(60000);
  assert.equal((await h.post('email/resend', {}, linking.body.csrfToken)).status, 403);
  assert.equal(h.delivered.length, 1);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM identities WHERE provider=\'password\'').get().n, 0);
  await h.confirm(google.body.csrfToken);
  assert.equal((await h.post('email/resend', {}, linking.body.csrfToken)).status, 202);
  assert.equal((await h.verify(oldCode)).status, 400);
  const linked = await h.verify(); assert.equal(linked.status, 200);
  assert.equal(linked.body.user.id, google.body.user.id);
  assert.equal(linked.body.user.hasPassword, true);
  assert.equal(linked.body.requiresConfirmation, false);
});

test('equal Google and password emails remain independent before and after confirmation', async (t) => {
  const h = await harness(); t.after(h.close);
  await h.signup(); const email = await h.verify();
  const google = await h.google();
  assert.notEqual(google.body.user.id, email.body.user.id);
  assert.equal(google.body.user.hasPassword, false);
  const confirmed = await h.confirm(google.body.csrfToken);
  assert.notEqual(confirmed.body.user.id, email.body.user.id);
  assert.equal(confirmed.body.user.hasPassword, false);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n, 2);
});

test('pending Google continuation survives restart and confirmed state persists on the next restart', async (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'talk-google-confirmation-'));
  const databasePath = path.join(directory, 'auth.sqlite');
  let h = await harness({ databasePath });
  t.after(async () => { await h.close(); assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir())); rmSync(directory, { recursive: true, force: true }); });
  const google = await h.google(); const jar = new Map(h.jar); await h.close();
  h = await harness({ databasePath, jar });
  assert.deepEqual((await h.request('session')).body, google.body);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, 3);
  const confirmed = await h.confirm(google.body.csrfToken); assert.equal(confirmed.status, 200);
  const confirmedJar = new Map(h.jar); await h.close();
  h = await harness({ databasePath, jar: confirmedJar });
  assert.deepEqual((await h.request('session')).body, confirmed.body);
});

test('migration keeps old active sessions confirmed and rejects invalid confirmation flags', async (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'talk-google-migration-'));
  const databasePath = path.join(directory, 'auth.sqlite');
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(readFileSync(new URL('../backend/src/migrations/001_auth.sql', import.meta.url), 'utf8'));
  legacy.exec('CREATE TABLE schema_migrations(version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  legacy.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES (?,?)').run('001_auth.sql', Date.now());
  const sessionToken = 'a'.repeat(43);
  const tokenHash = createHash('sha256').update(sessionToken).digest('hex');
  legacy.prepare('INSERT INTO accounts(id,name,email,email_verified,created_at) VALUES (?,?,?,?,?)').run('old-google', 'Existing Person', EMAIL, 1, Date.now());
  legacy.prepare('INSERT INTO identities(provider,provider_id,account_id,verified_at) VALUES (?,?,?,?)').run('google', 'old-google', 'old-google', Date.now());
  legacy.prepare('INSERT INTO sessions(token_hash,account_id,csrf_token,auth_method,authenticated_at,expires_at) VALUES (?,?,?,?,?,?)').run(tokenHash, 'old-google', 'b'.repeat(43), 'google', Date.now(), Date.now() + 600000);
  legacy.close();
  const h = await harness({ databasePath, jar: new Map([['talk_session', sessionToken]]) });
  t.after(async () => { await h.close(); assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir())); rmSync(directory, { recursive: true, force: true }); });
  const session = await h.request('session');
  assert.equal(session.body.user.name, 'Existing Person');
  assert.equal(session.body.requiresConfirmation, false);
  assert.equal(h.db.prepare('SELECT requires_confirmation FROM sessions').get().requires_confirmation, 0);
  assert.throws(() => h.db.prepare('UPDATE sessions SET requires_confirmation=2').run(), /CHECK constraint failed/);
});

test('parallel Talk continuation requests are idempotent and create no new account or session', async (t) => {
  const h = await harness(); t.after(h.close);
  const google = await h.google(); const cookie = cookieHeader(h.jar);
  const results = await Promise.all([h.confirm(google.body.csrfToken, { headers: { Cookie: cookie } }), h.confirm(google.body.csrfToken, { headers: { Cookie: cookie } })]);
  assert.deepEqual(results.map((result) => result.status), [200, 200]);
  for (const result of results) assert.equal(result.body.requiresConfirmation, false);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n, 1);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 1);
});
