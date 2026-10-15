import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import express from 'express';
import pg from 'pg';
import { createAuthApp } from '../server/auth.mjs';
import { openAuthDatabase } from '../server/database.mjs';
import { openPostgresDatabase, parameterize, postgresConfig, migratePostgres } from '../server/postgres-database.mjs';
import { importSqlite } from '../server/import-sqlite.mjs';
import { hostingCookies } from '../server/hosting-cookies.mjs';
import { clientIpResolver } from '../server/client-ip.mjs';
import { productionConfig } from '../server/production-config.mjs';

const origin = 'https://talk-fc3dc.web.app';
const project = 'talk-production-fixture';
const secret = randomBytes(32).toString('base64url');
const clientId = 'talk-production-fixture.apps.googleusercontent.com';
const jarHeader = jar => [...jar].map(([key, value]) => `${key}=${value}`).join('; ');

async function fixture(database, options = {}) {
  if (database.kind === 'postgres') {
    const prepare = database.prepare;
    database.prepare = sql => {
      const statement = prepare(sql);
      return Object.fromEntries(Object.entries(statement).map(([name, method]) => [name, async (...args) => {
        try { return await method(...args); }
        catch (error) { if (/^[0-9A-Z]{5}$/.test(error.code || '')) console.error(`Fixture PostgreSQL category: ${error.code}`); throw error; }
      }]));
    };
  }
  let time = Date.now(); const delivered = [];
  const app = createAuthApp({ database, clientId, origins: [origin], secureCookies: true,
    cookieMode: 'hosting', cookieSecret: secret, now: () => time,
    firebaseProjectId: project, phoneConfigured: true, verifyFirebaseToken: async value => JSON.parse(value),
    verifyCredential: async value => JSON.parse(value),
    mailer: { configured: true, sendVerification: async mail => { delivered.push(mail); } }, ...options,
  });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const jar = new Map();
  const request = async (route, init = {}, alternateJar = jar) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/${route}`, {
      ...init, headers: { Cookie: jarHeader(alternateJar), ...init.headers },
    });
    const cookies = response.headers.getSetCookie();
    for (const cookie of cookies) {
      const [name, value] = cookie.split(';')[0].split('=');
      assert.equal(name, '__session', 'Hosting must receive only its supported cookie');
      assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=Lax/); assert.match(cookie, /Path=\/api\/auth/);
      if (!value || /Expires=Thu, 01 Jan 1970/i.test(cookie)) alternateJar.delete(name);
      else alternateJar.set(name, value);
    }
    return { status: response.status, body: await response.json(), cookies };
  };
  const config = async () => (await request('config')).body;
  const post = (route, body, csrf, alternateJar) => request(route, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf || '' }, body: JSON.stringify(body),
  }, alternateJar);
  const logout = async () => { const session = (await request('session')).body; return post('logout', {}, session.csrfToken); };
  return {
    request, post, jar, config, logout, delivered, advance: amount => { time += amount; }, now: () => time,
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); },
  };
}

test('proxy IPs stop at the first untrusted hop and client-supplied prefixes cannot choose a bucket', () => {
  const req = { socket: { remoteAddress: '169.254.1.2' }, headers: { 'x-forwarded-for': '198.51.100.7, 203.0.113.4' } };
  assert.equal(clientIpResolver('169.254.0.0/16')(req), '203.0.113.4');
  req.headers['x-forwarded-for'] = '192.0.2.12, 203.0.113.4';
  assert.equal(clientIpResolver('169.254.0.0/16')(req), '203.0.113.4');
  assert.equal(clientIpResolver()(req), '169.254.1.2');
  assert.throws(() => clientIpResolver('0.0.0.0/0'));
});

test('production config fails closed for local SQLite, missing secrets, HTTP origins and Firebase emulators', () => {
  const env = { APP_URL: origin, AUTH_DB_DRIVER: 'postgres', AUTH_COOKIE_MODE: 'hosting', AUTH_COOKIE_SECRET: secret,
    GOOGLE_CLIENT_ID: clientId, FIREBASE_PROJECT_ID: project, SMTP_HOST: 'smtp.gmail.com', SMTP_PORT: '587',
    SMTP_USER: 'fixture@example.com', SMTP_PASSWORD: 'fixture-only', SMTP_FROM: 'fixture@example.com', TRUSTED_PROXY_CIDRS: '169.254.0.0/16' };
  assert.equal(productionConfig(env).secureCookies, true);
  assert.throws(() => productionConfig({ ...env, AUTH_DB_DRIVER: 'sqlite' }));
  assert.throws(() => productionConfig({ ...env, APP_URL: 'http://talk.example' }));
  assert.throws(() => productionConfig({ ...env, FIREBASE_AUTH_EMULATOR_HOST: 'localhost:9099' }));
  assert.throws(() => hostingCookies({ secret: '', origin }));
  assert.throws(() => postgresConfig({ PGHOST: 'db.example.com', PGDATABASE: 'fixture', PGUSER: 'fixture', PGPASSWORD: 'fixture' }));
  assert.equal(parameterize("SELECT '?' AS literal, a FROM accounts WHERE id=? AND name='it''s ?' AND email=?"), "SELECT '?' AS literal, a FROM accounts WHERE id=$1 AND name='it''s ?' AND email=$2");
});

test('Hosting cookie envelope protects sessions, independent challenge expiry and key rotation', async t => {
  const db = openAuthDatabase(); const h = await fixture(db); t.after(async () => { await h.close(); db.close(); });
  const c = await h.config();
  assert.equal(h.jar.size, 1); assert.match(h.jar.get('__session'), /^v1\./);
  assert(!h.jar.get('__session').includes(c.csrfToken));
  assert.equal((await h.post('email/signup', { name: 'Fixture', email: 'envelope@example.com', password: 'fixture-password-value' }, c.csrfToken)).status, 202);
  let pending = (await h.request('email/verification')).body;
  assert.equal((await h.request('session')).body.user, null);
  assert.equal((await h.post('email/verify', { code: h.delivered.at(-1).code }, pending.csrfToken)).status, 200);
  const authenticated = new Map(h.jar);
  const corrupt = new Map(h.jar); const value = corrupt.get('__session');
  corrupt.set('__session', value.slice(0, 25) + (value[25] === 'A' ? 'B' : 'A') + value.slice(26));
  assert.equal((await h.request('session', {}, corrupt)).body.user, null);
  const foreign = await fixture(db, { origins: ['https://different.example'] });
  try { assert.equal((await foreign.request('session', {}, new Map(authenticated))).body.user, null); } finally { await foreign.close(); }
  const rotated = await fixture(db, { cookieSecret: randomBytes(32).toString('base64url'), previousCookieSecret: secret });
  try { assert((await rotated.request('session', {}, new Map(authenticated))).body.user); } finally { await rotated.close(); }
  assert.equal((await h.logout()).status, 200);
  assert.equal((await h.request('session', {}, authenticated)).body.user, null, 'replaying an old encrypted cookie cannot restore a revoked server session');
  h.jar.set('talk_session', randomBytes(32).toString('base64url'));
  assert.equal((await h.request('session')).body.user, null, 'native cookies cannot bypass Hosting mode');
  h.jar.delete('talk_session');
  const next = await h.config();
  await h.post('email/signup', { name: 'Expiry Fixture', email: 'envelope-expiry@example.com', password: 'expiry-fixture-password' }, next.csrfToken);
  h.advance(600001);
  assert((await h.request('email/verification')).body.verification, 'the email challenge survives expiry of the separate Google challenge');
  assert.notEqual((await h.config()).nonce, next.nonce);
});

const pgEnabled = process.env.TALK_POSTGRES_TEST === '1' && process.env.PGHOST === '127.0.0.1' && process.env.PGDATABASE === 'talk_auth_test';
test('real PostgreSQL production flow: migrations, encrypted Hosting cookie, email OTP, Google, phone, concurrency, restart and import', { skip: !pgEnabled }, async t => {
  let db = await openPostgresDatabase(process.env, { migrate: true });
  let h = await fixture(db);
  t.after(async () => { await h.close(); await db.close(); });
  const sql = (query, ...params) => db.withContext(() => db.prepare(query).get(...params));
  const signup = async email => h.post('email/signup', { name: 'PG Fixture', email, password: 'pg-fixture-password' }, (await h.config()).csrfToken);
  await t.test('unverified password login is blocked and five wrong codes exhaust a code', async () => {
    assert.equal((await signup('attempts@example.com')).status, 202);
    const p = (await h.request('email/verification')).body;
    assert.equal((await h.post('email/login', { email: p.verification.email, password: 'pg-fixture-password' }, (await h.config()).csrfToken)).status, 202);
    let wrong = h.delivered.at(-1).code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) assert.equal((await h.post('email/verify', { code: wrong }, p.csrfToken)).status, i === 4 ? 429 : 400);
    assert.equal((await h.request('session')).body.user, null);
  });
  await t.test('expiry, resend cooldown and generation invalidation are enforced in PostgreSQL', async () => {
    h.advance(60001); await signup('expiry@example.com');
    const p = (await h.request('email/verification')).body;
    assert.equal((await h.post('email/resend', {}, p.csrfToken)).status, 429);
    const old = h.delivered.at(-1).code;
    h.advance(60001); assert.equal((await h.post('email/resend', {}, p.csrfToken)).status, 202);
    if (old !== h.delivered.at(-1).code) assert.equal((await h.post('email/verify', { code: old }, p.csrfToken)).status, 400);
    h.advance(300001); assert.equal((await h.post('email/verify', { code: h.delivered.at(-1).code }, p.csrfToken)).status, 410);
  });
  let accountId;
  await t.test('concurrent email verification creates exactly one durable session', async () => {
    assert.equal((await signup('persist@example.com')).status, 202);
    const p = (await h.request('email/verification')).body;
    const proof = { code: h.delivered.at(-1).code };
    const results = await Promise.all([h.post('email/verify', proof, p.csrfToken), h.post('email/verify', proof, p.csrfToken)]);
    assert.equal(results.filter(result => result.status === 200).length, 1);
    accountId = results.find(result => result.status === 200).body.user.id;
    assert.equal((await sql('SELECT COUNT(*) AS n FROM sessions')).n, 1);
    assert.equal((await sql("SELECT COUNT(*) AS n FROM identities WHERE provider='password' AND provider_id=?", 'persist@example.com')).n, 1);
  });
  await t.test('sessions and identities survive closing the application and reopening the database pool', async () => {
    const saved = new Map(h.jar); await h.close(); await db.close();
    db = await openPostgresDatabase(process.env, { migrate: true }); h = await fixture(db);
    for (const [key, value] of saved) h.jar.set(key, value);
    assert.equal((await h.request('session')).body.user.id, accountId);
    assert.equal((await h.logout()).status, 200);
    assert.equal((await h.request('session', {}, saved)).body.user, null);
    const login = await h.post('email/login', { email: 'persist@example.com', password: 'pg-fixture-password' }, (await h.config()).csrfToken);
    assert.equal(login.status, 200); assert.equal(login.body.user.id, accountId); await h.logout();
  });
  await t.test('Google keeps its confirmation step and never automatically merges with a password account', async () => {
    const c = await h.config(); const seconds = Math.floor(h.now() / 1000);
    const result = await h.post('google', { credential: JSON.stringify({ iss: 'https://accounts.google.com', aud: clientId, sub: 'pg-google-fixture', email: 'persist@example.com', email_verified: true, name: 'PG Google', nonce: c.nonce, iat: seconds, exp: seconds + 3600 }) }, c.csrfToken);
    assert.equal(result.status, 200); assert.equal(result.body.requiresConfirmation, true); assert.notEqual(result.body.user.id, accountId);
    assert.equal((await h.post('google/confirm', {}, result.body.csrfToken)).body.requiresConfirmation, false);
    await h.logout();
  });
  let phoneAccount;
  const phone = '+919000000005';
  const phoneStart = async () => h.post('phone/start', { phoneNumber: phone, intent: 'signin' }, (await h.request('phone/config')).body.csrfToken);
  const phoneToken = () => { const seconds = Math.floor(h.now() / 1000); return JSON.stringify({ uid: 'pg-phone-fixture', sub: 'pg-phone-fixture', aud: project, iss: `https://securetoken.google.com/${project}`, phone_number: phone, iat: seconds, auth_time: seconds, exp: seconds + 3600, firebase: { sign_in_provider: 'phone' } }); };
  await t.test('Firebase proof exchange, concurrent consumption and returning phone login use the same account', async () => {
    assert.equal((await phoneStart()).status, 202);
    const p = (await h.request('phone/challenge')).body;
    const results = await Promise.all([h.post('phone/verify', { idToken: phoneToken() }, p.csrfToken), h.post('phone/verify', { idToken: phoneToken() }, p.csrfToken)]);
    assert.equal(results.filter(item => item.status === 200).length, 1);
    phoneAccount = results.find(item => item.status === 200).body.user.id;
    await h.logout(); h.advance(60001); await phoneStart();
    const next = (await h.request('phone/challenge')).body;
    const result = await h.post('phone/verify', { idToken: phoneToken() }, next.csrfToken);
    assert.equal(result.status, 200); assert.equal(result.body.user.id, phoneAccount); assert.equal(result.body.user.emailVerified, false);
    await h.logout();
  });
  await t.test('resending invalidates the previous browser challenge and rate limits persist in the database', async () => {
    h.advance(60001); await phoneStart(); const stale = new Map(h.jar); const old = (await h.request('phone/challenge')).body;
    assert.equal((await phoneStart()).status, 429); h.advance(60001); assert.equal((await phoneStart()).status, 202);
    assert.equal((await h.post('phone/verify', { idToken: phoneToken() }, old.csrfToken, stale)).status, 403);
    assert((await sql('SELECT COUNT(*) AS n FROM rate_limits')).n > 0);
  });
  await t.test('SQLite import preserves hashes and IDs, rejects a nonempty target and commits no partial rows', async () => {
    const admin = new pg.Pool(postgresConfig(process.env)); admin.on('error', () => {});
    const importName = 'talk_auth_import_fixture';
    const source = openAuthDatabase();
    source.prepare('INSERT INTO accounts VALUES (?,?,?,?,?,?)').run('import-person', 'Import Fixture', 'import@example.com', null, 1, Date.now());
    source.prepare("INSERT INTO identities(provider,provider_id,account_id,password_hash,verified_at) VALUES ('password',?,?,?,?)").run('import@example.com', 'import-person', 'hashed-fixture-value', Date.now());
    let target;
    try {
      await admin.query(`CREATE DATABASE ${importName}`);
      target = new pg.Pool(postgresConfig({ ...process.env, PGDATABASE: importName })); target.on('error', () => {});
      await migratePostgres(target); await migratePostgres(target);
      await importSqlite(source, target);
      assert.equal((await target.query("SELECT password_hash FROM identities WHERE account_id='import-person'")).rows[0].password_hash, 'hashed-fixture-value');
      await assert.rejects(importSqlite(source, target));
      assert.equal(Number((await target.query('SELECT COUNT(*) AS n FROM accounts')).rows[0].n), 1);
    } finally { source.close(); await target?.end(); await admin.end(); }
  });
});
