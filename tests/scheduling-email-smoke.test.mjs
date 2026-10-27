import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { prepareSchedulingEmailSmokeTest, dispatchPreparedSchedulingEmailSmokeTest,
  restorePreparedSchedulingEmailSmokeTest, schedulingEmailSmokeConfiguration } from '../backend/src/scheduling/email-smoke-test.mjs';

const options = () => ({ outputRoot: mkdtempSync(path.resolve('artifacts/qa/phase11-smoke-test-')),
  recipient: 'approved-recipient@example.test', sender: 'sender@example.test', baseUrl: 'https://talk.example.test',
  linkSecret: Buffer.alloc(32, 42).toString('base64url'), configurationIdentity: 'a'.repeat(64), now: Date.parse('2026-10-26T00:00:00Z') });
// Synthetic evidence only; no public route is probed by these mock tests.
const approval = prepared => ({ approved: true, recipient: prepared.review.recipient, fingerprint: prepared.review.requestFingerprint, joiningLinkVerified: true });

test('offline smoke preparation creates only one isolated synthetic booking and no active mail jobs', async () => {
  const prepared = await prepareSchedulingEmailSmokeTest(options());
  const db = new DatabaseSync(prepared.databasePath);
  try {
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM scheduling_bookings').get().n, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM scheduling_jobs WHERE status<>'cancelled'").get().n, 0);
    assert.equal(db.prepare('SELECT email FROM accounts').get().email.endsWith('@example.invalid'), true);
  } finally { db.close(); }
  const review = readFileSync(path.join(prepared.directory, 'review.json'), 'utf8');
  assert.equal(prepared.review.realEmailSent, false);
  assert.equal(prepared.review.attemptsConsumed, 0);
  assert.equal(prepared.review.emailsToSendAfterExplicitApproval, 1);
  assert.equal(prepared.review.bookingRouteReachability, 'UNVERIFIED_ISOLATED_DB_NOT_SERVED');
  assert.match(prepared.review.text, /PRIVATE_BOOKING_CREDENTIAL/);
  assert.doesNotMatch(review, /#[A-Za-z0-9_-]{43}/);
  assert.doesNotMatch(review, /SMTP_PASSWORD|signingSecretHash/);
  assert.match(prepared.review.html, /Talk/);
  assert.match(prepared.review.calendar, /BEGIN:VCALENDAR/);
});

test('one attempt requires exact approval, persists reservation and never automatically retries', async () => {
  const opts = options(), prepared = await prepareSchedulingEmailSmokeTest(opts);
  let calls = 0;
  const send = async () => { calls++; return { accepted: true }; };
  await assert.rejects(dispatchPreparedSchedulingEmailSmokeTest(prepared, { send }), /Explicit approval/);
  await assert.rejects(dispatchPreparedSchedulingEmailSmokeTest(prepared, { approval: { ...approval(prepared), recipient: 'wrong@example.test' }, send }), /Explicit approval/);
  await assert.rejects(dispatchPreparedSchedulingEmailSmokeTest(prepared, { approval: { ...approval(prepared), joiningLinkVerified: false }, configurationIdentity: opts.configurationIdentity, send }), /Explicit approval/);
  const result = await dispatchPreparedSchedulingEmailSmokeTest(prepared, { approval: approval(prepared), configurationIdentity: 'a'.repeat(64), send });
  assert.equal(result.smtpAccepted, true); assert.equal(calls, 1); assert.equal(result.inboxDelivery, 'UNVERIFIED');
  await assert.rejects(dispatchPreparedSchedulingEmailSmokeTest(prepared, { approval: approval(prepared), configurationIdentity: 'a'.repeat(64), send }), /single email attempt/);
  const afterRestart = await prepareSchedulingEmailSmokeTest(opts);
  assert.equal(afterRestart.review.attemptsConsumed, 1);
  await assert.rejects(dispatchPreparedSchedulingEmailSmokeTest(afterRestart, { approval: approval(afterRestart), configurationIdentity: 'a'.repeat(64), send }), /single email attempt/);
  assert.equal(calls, 1);
});

test('failed or uncertain SMTP consumes attempt and sanitized result omits provider error', async () => {
  const prepared = await prepareSchedulingEmailSmokeTest(options());
  let calls = 0;
  const send = async () => { calls++; throw new Error('sensitive-provider-detail'); };
  const result = await dispatchPreparedSchedulingEmailSmokeTest(prepared, { approval: approval(prepared), configurationIdentity: 'a'.repeat(64), send });
  assert.equal(result.attemptsConsumed, 1); assert.equal(result.smtpAccepted, false);
  const saved = readFileSync(path.join(prepared.directory, 'result.json'), 'utf8');
  assert.doesNotMatch(saved, /sensitive-provider-detail|approved-recipient|PRIVATE_BOOKING/);
  await assert.rejects(dispatchPreparedSchedulingEmailSmokeTest(prepared, { approval: approval(prepared), send }));
  assert.equal(calls, 1);
});

test('a newer prepared message invalidates older approval before reservation', async () => {
  const opts = options(), old = await prepareSchedulingEmailSmokeTest(opts), current = await prepareSchedulingEmailSmokeTest(opts);
  let calls = 0;
  const send = async () => { calls++; return { accepted: true }; };
  await assert.rejects(dispatchPreparedSchedulingEmailSmokeTest(old, { approval: approval(old), configurationIdentity: 'a'.repeat(64), send }), /review changed/);
  await dispatchPreparedSchedulingEmailSmokeTest(current, { approval: approval(current), configurationIdentity: 'a'.repeat(64), send });
  assert.equal(calls, 1);
});

test('multiple recipients and malformed sender are rejected without delivery', async () => {
  await assert.rejects(prepareSchedulingEmailSmokeTest({ ...options(), recipient: 'one@example.test,two@example.test' }), /one plain sender/);
  await assert.rejects(prepareSchedulingEmailSmokeTest({ ...options(), sender: 'Sender <sender@example.test>' }), /one plain sender/);
});

test('changed SMTP configuration cannot consume the approved request', async () => {
  const prepared = await prepareSchedulingEmailSmokeTest(options());
  let calls = 0;
  const send = async () => { calls++; return { accepted: true }; };
  await assert.rejects(dispatchPreparedSchedulingEmailSmokeTest(prepared, {
    approval: approval(prepared), configurationIdentity: 'b'.repeat(64), send,
  }), /Explicit approval/);
  assert.equal(calls, 0);
  const db = new DatabaseSync(prepared.ledgerPath);
  try { assert.equal(db.prepare('SELECT consumed FROM email_smoke_attempts').get().consumed, 0); }
  finally { db.close(); }
});

test('simultaneous approved dispatches reserve exactly one mocked send', async () => {
  const prepared = await prepareSchedulingEmailSmokeTest(options());
  let calls = 0;
  const send = async () => { calls++; await Promise.resolve(); return { accepted: true }; };
  const opts = { approval: approval(prepared), configurationIdentity: 'a'.repeat(64), send };
  const results = await Promise.allSettled([
    dispatchPreparedSchedulingEmailSmokeTest(prepared, opts), dispatchPreparedSchedulingEmailSmokeTest(prepared, opts),
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(calls, 1);
});

test('saved preparation restores in a fresh module instance without persisting joining credentials', async () => {
  const opts = options(), prepared = await prepareSchedulingEmailSmokeTest(opts);
  const fresh = await import(`../backend/src/scheduling/email-smoke-test.mjs?restart=${Date.now()}`);
  const restored = fresh.restorePreparedSchedulingEmailSmokeTest({ ...opts, directory: prepared.directory });
  assert.equal(restored.review.requestFingerprint, prepared.review.requestFingerprint);
  let calls = 0;
  const result = await fresh.dispatchPreparedSchedulingEmailSmokeTest(restored, {
    approval: approval(prepared), configurationIdentity: opts.configurationIdentity,
    send: async mail => { calls++; assert.match(mail.text, /#[A-Za-z0-9_-]{43}/); return { accepted: true }; },
  });
  assert.equal(result.smtpAccepted, true); assert.equal(calls, 1);
  const metadata = readFileSync(path.join(prepared.directory, 'metadata.json'), 'utf8');
  assert.doesNotMatch(metadata, /linkSecret|configurationIdentity|#[A-Za-z0-9_-]{43}/);
});

test('restoration rejects changed secrets, configuration, message content and application DB paths', async () => {
  const opts = options(), prepared = await prepareSchedulingEmailSmokeTest(opts);
  const input = { ...opts, directory: prepared.directory };
  assert.throws(() => restorePreparedSchedulingEmailSmokeTest({ ...input, linkSecret: Buffer.alloc(32, 9).toString('base64url') }), /reviewed message/);
  assert.throws(() => restorePreparedSchedulingEmailSmokeTest({ ...input, configurationIdentity: 'b'.repeat(64) }), /reviewed message/);
  assert.throws(() => restorePreparedSchedulingEmailSmokeTest({ ...input, directory: path.resolve('data') }), /artifacts\/qa/);
  await assert.rejects(prepareSchedulingEmailSmokeTest({ ...opts, outputRoot: path.resolve('data') }), /artifacts\/qa/);
  const db = new DatabaseSync(prepared.databasePath);
  try { db.prepare("UPDATE scheduling_events SET title='Changed synthetic test body'").run(); }
  finally { db.close(); }
  assert.throws(() => restorePreparedSchedulingEmailSmokeTest(input), /reviewed message/);
});

test('offline SMTP validation accepts the existing named sender convention without activating anything', () => {
  const env = { SMTP_HOST: 'smtp.gmail.com', SMTP_PORT: '587', SMTP_USER: 'sender@example.test',
    SMTP_PASSWORD: 'fixture-only-password', SMTP_FROM: 'Talk <sender@example.test>',
    SCHEDULING_PUBLIC_URL: 'https://talk.example.test', SCHEDULING_EMAIL_LINK_SECRET: Buffer.alloc(32, 42).toString('base64url'),
    SCHEDULING_EMAIL_ENABLED: 'false', WHITEBOARD_CLOUD_AI_ENABLED: 'false', WHITEBOARD_CLOUD_AI_OPERATOR_APPROVED: 'false' };
  const original = JSON.stringify(env), config = schedulingEmailSmokeConfiguration(env);
  assert.equal(config.sender, 'sender@example.test'); assert.match(config.configurationIdentity, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(env), original);
  assert.throws(() => schedulingEmailSmokeConfiguration({ ...env, SMTP_PORT: '465' }), /SMTP configuration/);
  assert.throws(() => schedulingEmailSmokeConfiguration({ ...env, SCHEDULING_EMAIL_ENABLED: 'true' }), /remain disabled/);
  assert.throws(() => schedulingEmailSmokeConfiguration({ ...env, WHITEBOARD_CLOUD_AI_ENABLED: 'true' }), /remain disabled/);
});
