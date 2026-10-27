import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { openAuthDatabase } from '../backend/src/database.mjs';
import { createAuthApp } from '../backend/src/auth.mjs';
import { prepareFiveUserVerification, createFiveUserVerificationMailer } from '../backend/src/five-user-verification.mjs';

async function fixture(t, { approved = true, fail = false } = {}) {
  const directory = fs.mkdtempSync(path.resolve('artifacts/qa/five-verify-private-')), databasePath = path.join(directory, 'talk.sqlite');
  const raw = openAuthDatabase(databasePath), allowedEmails = Array.from({ length: 5 }, (_, i) => `pending-fixture-${i}@example.test`);
  for (let i = 0; i < 3; i++) { raw.prepare('INSERT INTO accounts(id,name,email,email_verified,created_at) VALUES (?,?,?,1,?)').run('verified-' + i, 'Verified fixture', allowedEmails[i], Date.now()); raw.prepare("INSERT INTO identities(provider,provider_id,account_id,password_hash,verified_at) VALUES ('password',?,?,?,?)").run(allowedEmails[i], 'verified-' + i, 'unused-verified-fixture-hash', Date.now()); }
  const config = { directory, databasePath, allowedEmails, origin: 'https://fixture-verification.trycloudflare.com' }, launchId = '2f1b5e3f-7188-4241-8270-34c7d53f457f';
  const env = { SMTP_HOST: 'smtp.gmail.com', SMTP_PORT: '587', SMTP_USER: 'fixture-sender@example.test', SMTP_PASSWORD: 'fixture-password', SMTP_FROM: 'Talk <fixture-sender@example.test>', SCHEDULING_EMAIL_LINK_SECRET: randomBytes(32).toString('base64url') };
  const prepared = prepareFiveUserVerification({ config, launchId, env }); assert.equal(prepared.proposedEmailCount, 2); assert.equal(prepared.attemptsConsumed, 0);
  let now = Date.now(), sends = 0, factories = 0; const deliveries = [];
  const make = approved => createFiveUserVerificationMailer({ config, launchId, env, approved, now: () => now, createTransport(options) {
    factories++; assert.equal(options.requireTLS, true); assert.equal(options.tls.rejectUnauthorized, true); assert.equal(options.pool, false); assert.equal(options.maxRequeues, 0);
    return { async sendMail(message) { sends++; const code = /\n\n(\d{6})\n\n/.exec(message.text)?.[1]; assert.ok(code); deliveries.push({ to: message.to.address, code, messageId: message.messageId }); if (fail) { const e = Error('PRIVATE mock SMTP error'); e.code = 'ETIMEDOUT'; throw e; } return { accepted: [message.to.address], rejected: [], pending: [], response: '250 2.0.0 synthetic SMTP acknowledgment' }; }, close() {} };
  } });
  const adapter = make(approved), app = createAuthApp({ database: raw, origins: [config.origin], secureCookies: true, mailer: adapter, now: () => now });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const clients = () => { const jar = new Map(); let csrf; return { async call(route, body) { const r = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/` + route, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: [...jar].map(([k, v]) => k + '=' + v).join('; '), ...(body === undefined ? {} : { Origin: config.origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf || '' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); for (const cookie of r.headers.getSetCookie()) { const [k, v] = cookie.split(';')[0].split('='); jar.set(k, v); } const data = await r.json(); if (data.csrfToken) csrf = data.csrfToken; return { status: r.status, data }; } }; };
  const signup = async (c, index) => { await c.call('config'); return c.call('email/signup', { name: 'Unverified fixture', email: allowedEmails[index], password: 'Fixture-Password-Only-123' }); };
  const attempts = () => { const d = new DatabaseSync(path.join(directory, 'account-verification-guard.sqlite'), { readOnly: true }); try { return d.prepare('SELECT consumed,status,smtp_code FROM account_verification_attempts').all(); } finally { d.close(); } };
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await app.locals.closeAuthDatabase(); raw.close(); assert.ok(directory.startsWith(path.resolve('artifacts/qa') + path.sep)); fs.rmSync(directory, { recursive: true, force: true }); });
  return { adapter, raw, allowedEmails, config, env, launchId, clients, signup, deliveries, attempts, make, advance: ms => { now += ms; }, get factories() { return factories; }, get sends() { return sends; } };
}

test('offline verification proposal leaves SMTP and code generation disabled', async t => {
  const h = await fixture(t, { approved: false }), c = h.clients();
  assert.equal(h.adapter.configured, false); assert.equal((await h.signup(c, 3)).status, 503);
  assert.equal(h.factories, 0); assert.equal(h.sends, 0); assert.ok(h.attempts().every(r => r.consumed === 0));
  assert.equal(h.raw.prepare('SELECT COUNT(*) n FROM email_challenges').get().n, 0);
  assert.equal(h.raw.prepare('SELECT COUNT(*) n FROM accounts').get().n, 3);
});

test('two approved normal signups each receive at most one mocked email, then verify normally with delivery disabled', async t => {
  const h = await fixture(t), first = h.clients(), second = h.clients();
  assert.equal((await h.signup(first, 3)).status, 202);
  assert.equal(h.raw.prepare('SELECT email_verified FROM accounts WHERE email=?').get(h.allowedEmails[3]).email_verified, 0);
  assert.equal((await first.call('session')).data.user, null);
  assert.equal((await first.call('email/resend', {})).status, 429);
  assert.equal((await h.signup(second, 4)).status, 202);
  assert.equal(h.sends, 2); assert.equal(h.adapter.configured, false); assert.equal(new Set(h.deliveries.map(d => d.messageId)).size, 2);
  for (const [i, c] of [first, second].entries()) {
    await c.call('email/verification');
    const bad = h.deliveries[i].code === '000000' ? '111111' : '000000'; assert.equal((await c.call('email/verify', { code: bad })).status, 400);
    assert.equal((await c.call('email/verify', { code: h.deliveries[i].code })).status, 200);
    assert.equal((await c.call('email/verify', { code: h.deliveries[i].code })).status, 403);
  }
  assert.equal(h.raw.prepare('SELECT COUNT(*) n FROM accounts WHERE email_verified=1').get().n, 5);
  assert.ok(h.attempts().every(r => r.consumed === 1 && r.status === 'CONFIRMED_ACCEPTED' && r.smtp_code === 250));
  assert.equal((await h.signup(h.clients(), 3)).status, 503); assert.equal(h.sends, 2);
});

test('failed or ambiguous SMTP remains consumed across adapter restart and cannot retry', async t => {
  const h = await fixture(t, { fail: true }), c = h.clients(); assert.equal((await h.signup(c, 3)).status, 503);
  assert.equal(h.sends, 1); assert.equal(h.attempts().filter(r => r.consumed === 1 && r.status === 'FAILED_OR_UNKNOWN_NO_RETRY').length, 1);
  const restarted = h.make(true); assert.equal(restarted.configured, true); // Only the other recipient remains eligible.
  h.advance(61000); assert.equal((await h.signup(c, 3)).status, 503); assert.equal(h.sends, 1);
  assert.equal(h.raw.prepare('SELECT email_verified FROM accounts WHERE email=?').get(h.allowedEmails[3]).email_verified, 0);
});
